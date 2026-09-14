# Development Log

Chronological record of decisions and progress. Newest entries at the top.

---

## 2026-09-15 00:02 KST — Phase A3/A5: Organizer event ownership

Added ownership so organizers manage only their own events. Additive; reschedule/registration logic unchanged. No git commit.

### Schema (migration `20260914..._event_organizer`)
- Added **nullable** `Event.organizerId` (FK → `User`) + `User.events` back-relation + `@@index([organizerId])`. Nullable for backward compat with pre-ownership events.

### Ownership enforcement
- **`EventOwnerGuard`** (`src/auth/guards/event-owner.guard.ts`): loads the event by the route param (`:eventId` or `:id`), returns `404` if missing, `403` if `event.organizerId !== req.user.userId`. Runs after `JwtAuthGuard` + `RolesGuard(ORGANIZER)`. Injects the global `PrismaService`; no service signatures changed.
- **Create** (`POST /api/events`, req. 2): ORGANIZER-only; `create(dto, organizerId)` stamps the event with the creator's id.
- **Owner-only routes** (reqs. 4, 5): `PATCH /api/events/:id`, **`DELETE /api/events/:id`** (new), `GET /api/events/:eventId/registrations`, `GET /api/events/:eventId/stats`, and `POST /api/events/:eventId/check-in` all now require `JwtAuthGuard + RolesGuard(ORGANIZER) + EventOwnerGuard` → a different organizer gets `403`.
- **`GET /api/organizer/events`** (new, `OrganizerEventsController`, req. 3): returns only the caller's events.
- **Public reads preserved** (req. 6): `GET /api/events` and `GET /api/events/:id` remain unauthenticated.
- **Reschedule preserved** (req. 8): `EventsService.update` is untouched; owner PATCH of `startsAt` still records `EVENT_RESCHEDULED` emails (asserted in the test).
- **Delete** cascades to registrations/tickets/emails via existing `onDelete: Cascade`.

### Tests (req. 7)
`npm test` → **14 suites, 75 tests, all passing**. New `event-ownership.integration.spec.ts` (HTTP + real Postgres, self-cleaning, 7 cases): create stamps owner; `/organizer/events` scoping (owner sees it, other organizer doesn't); public participant reads still 200; update — unauth 401 / participant 403 / non-owner 403 / owner 200 with `EVENT_RESCHEDULED` email recorded; registrations list + stats restricted to owner (403 vs 200); check-in restricted to owner (403 vs 200); delete — non-owner 403, owner 200 (row gone). Updated `events.service.spec.ts` `mockEvent` for the new `organizerId` field.
- `npm run build` → exit 0.

### Migration risk (flagged earlier, now live)
Pre-ownership events (e.g. the earlier demo event) have `organizerId = NULL`, so no organizer can manage them via the owner-guarded routes (they'd 403). A production rollout would seed an organizer + backfill; for this assignment, new events created through the authenticated flow are owned correctly and demo leftovers can be ignored/wiped.

---

## 2026-09-14 23:53 KST — Phase A4: Account-linked registrations

Connected event registrations to authenticated participant accounts. Additive — the concurrency/waitlist/ticket/promotion core is unchanged. No git commit.

### Schema (migration `20260914144949_registration_user_link`)
- Added **nullable** `Registration.userId` (FK → `User`) + `User.registrations` back-relation + `@@index([userId])`. Nullable preserves compatibility with pre-account rows. **`Registration.email` and `@@unique([eventId, email])` are untouched**, so the `FOR UPDATE` transaction, FIFO waitlist, and promotion logic are fully preserved (req. 5).

### Registration by authenticated identity (reqs. 2, 3)
- `POST /api/events/:eventId/registrations` now requires `JwtAuthGuard + RolesGuard + @Roles(PARTICIPANT)`. Email **and** userId are taken from the JWT; **any body email is ignored** — a participant cannot register another person's email.
- Service change is minimal and additive: `register(eventId, email, userId?)` — `userId` threaded into the create/revive helpers (and backfilled onto a revived row). The 3-arg call is backward compatible; existing service-level concurrency tests (2-arg) are unaffected. `@@unique([eventId, email])` still guarantees one active registration per participant per event (req. 4).

### Cancellation by owner (reqs. 7, 8)
- Reused `POST /api/events/:eventId/registrations/cancel` in authenticated form: `@Roles(PARTICIPANT)`, email from the JWT → a participant can cancel **only their own** registration. Someone with no registration gets `404` and never affects another participant. Auto-promotion on cancel is unchanged.

### New endpoint (req. 6)
- `GET /api/me/registrations` (`MeController`, PARTICIPANT-guarded) → the caller's registrations, newest first, each with `{ status, waitlistPos, checkedInAt, createdAt, ticketCode, event: { id, title, description, startsAt, capacity } }`. Matches by `userId OR email` so legacy rows are included.

### Tests (req. 9)
`npm test` → **13 suites, 68 tests, all passing**. New `registration-auth.integration.spec.ts` (HTTP + real Postgres, self-cleaning, 8 cases): register requires auth (401); organizer registering as participant → 403; **body email ignored** — row stored under the JWT email with a non-null `userId`, and no row created for the attacker email; idempotent repeat; `/me/registrations` returns only the caller's rows (with event+ticket) and is empty for another user; `/me` requires auth (401); cancel affects only the caller (p2 → 404, p1 → 200 CANCELLED); cancel requires auth (401). All prior concurrency/waitlist tests still green.
- `npm run build` → exit 0.

### Notes
- The old body-email DTOs (`create-registration.dto.ts`, `cancel-registration.dto.ts`) are now unused (identity comes from the JWT); left in place to avoid unrelated churn.
- Organizer-only lockdown of the registrations *list* / stats / check-in and event *ownership* remain for the next phase (A3/A5).

---

## 2026-09-14 23:44 KST — Phase A1–A2: User accounts, JWT auth & role guards

Implemented email+password accounts with JWT and protected organizer-only routes. Additive only — the registration/waitlist concurrency core is untouched. No git commit.

### Schema (migration `20260914143614_user_accounts`)
- New `enum Role { PARTICIPANT, ORGANIZER }` and `User` model (`id, email @unique, passwordHash, role @default(PARTICIPANT), createdAt, updatedAt`). Purely additive — no change to `Event`/`Registration`/`Ticket`/`EmailLog`, so `@@unique([eventId, email])` and the `FOR UPDATE` transaction are preserved (req. 10). Migration applied non-interactively (no data-loss warning).

### AuthModule
- **Endpoints:** `POST /api/auth/register`, `POST /api/auth/login` (200), `GET /api/auth/me` (JWT-guarded).
- **Password hashing:** `bcrypt` (10 salt rounds). Password hash is never returned (a `toPublic` helper strips it).
- **JWT:** `@nestjs/jwt` issues a token `{ sub, email, role }`; `passport-jwt` `JwtStrategy` validates the bearer token → `req.user`. Secret + expiry from `JWT_SECRET` / `JWT_EXPIRES_IN` env (added to `.env` + `.env.example`).
- **Guards/decorators:** `JwtAuthGuard` (401 if no/invalid token), `RolesGuard` + `@Roles(...)` (403 if wrong role), `@CurrentUser()` param decorator. Applied guards, not a global guard, to avoid touching existing public/participant routes.
- **Protected organizer-only routes:** `POST /api/events` and `PATCH /api/events/:id` now require `JwtAuthGuard + RolesGuard + @Roles(ORGANIZER)`. Event browsing (GET) and participant registration remain public for now (ownership + participant identity are later phases).

### Decision — ORGANIZER self-registration
Allowed in this **demo** build (the register endpoint accepts `role`). Documented in code that in production organizer accounts would be admin/invite-only; participants would self-register as PARTICIPANT by default.

### Dependency fix (important)
The latest `@nestjs/jwt@12` and `@nestjs/passport@12` are **ESM-only** (`type: module`), which crashes our CommonJS backend on Node 20.17 at `require` time (and breaks ts-jest). Pinned both to the **v11 (CommonJS)** line matching NestJS 11 — build, tests, and runtime boot all confirmed working after the change.

### Tests performed
`npm test` → **12 suites, 60 tests, all passing**. New `auth.integration.spec.ts` (HTTP via supertest + real Postgres, self-cleaning, 10 cases): account creation (token returned, no password hash), duplicate email → 409, organizer registration, login success, invalid password → 401, `/me` with token → 200, `/me` without token → 401, and organizer-only `POST /events`: unauthenticated → 401, PARTICIPANT → 403, ORGANIZER → 201.
- `npm run build` → exit 0.
- Verified the built app **boots at runtime** with auth routes mapped (`/api/auth/register|login|me`) — confirms the ESM→CJS fix.

### Assumptions
- No global auth guard yet; only organizer create/edit are locked down (per the prompt's "protect organizer-only routes"). Event ownership, participant JWT identity on register/cancel, and `/me/registrations` remain for later phases.

---

## 2026-09-14 23:32 KST — Design proposal: User accounts & roles (no implementation)

Inspected the existing backend + frontend and drafted the *smallest coherent* extension for participant/organizer accounts. **No code changed.** Full proposal appended to `docs/ARCHITECTURE.md` (section "Extension: User Accounts & Roles"). Summary:

### What exists today
- No `User` model, no auth. A participant is just an `email` string on `Registration`; events have no owner. Concurrency/waitlist/ticket/email/reminder/WebSocket logic is complete and tested (48 backend tests green) and is keyed on `(eventId, email)`.

### Key design decision (safety)
The load-bearing core is keyed on `(eventId, email)`, so accounts are layered **around** it, not through it. Proposed changes are **purely additive**:
- New `User` (email unique, `passwordHash`, `role` PARTICIPANT|ORGANIZER), JWT auth (`@nestjs/jwt` + `passport-jwt`), `bcrypt`.
- **Nullable** `Event.organizerId` and **nullable** `Registration.userId`. `Registration.email` and `@@unique([eventId, email])` are **untouched** → the FOR-UPDATE registration/cancel transaction and all concurrency guarantees are preserved. No existing service signature changes; guards + JWT-derived identity are added at the controller layer only.

### Access rules
Global `JwtAuthGuard` (+ `@Public()`), `RolesGuard` (+ `@Roles()`), and an event-ownership check in organizer methods. Participants act only on their own JWT identity (register/cancel ignore body email).

### API changes (additive)
New `AuthModule` (`/auth/register`, `/auth/login`, `/auth/me`); new `DELETE /events/:id`, `GET /organizer/events`, `GET /me/registrations`; existing routes gain role/ownership guards.

### Migration risks (flagged)
Legacy events have `organizerId=NULL` → recommend seeding an organizer + backfilling in the migration (else they become uneditable). Register/cancel behavior changes to JWT identity (intended). `JWT_SECRET` env required. Nullable FKs keep the migration non-destructive.

### Phasing
9 additive commits (A1 schema/migration → A2 auth → A3–A5 backend guards role-by-role → A6–A8 frontend auth/participant/organizer → A9 tests+docs); the concurrency-critical transaction is never edited.

---

## 2026-09-14 22:58 KST — Phase 13: Organizer check-in screen (/check-in/:eventId)

Implemented the manual ticket-code check-in screen (no QR scanning). No git commit.

### What was implemented
- **Large, centered, monospace ticket-code input**, auto-focused on mount, submitting to `POST /api/events/:eventId/check-in` via `useCheckIn` (`api/checkin.ts`).
- **Result handling** — mapped by HTTP status (see API client change below):
  - success (200) → "Participant checked in successfully." (+ participant email)
  - already used (409, message contains "already checked in") → "This ticket has already been checked in."
  - invalid ticket (404) → "Invalid ticket code."
  - cancelled / not eligible (409 other) → shows the API's message verbatim (e.g. "Participant is not registered (status: CANCELLED)").
- **Fast repeat entry:** on success the input is **cleared and refocused**, so the operator can immediately type the next ticket.
- **Live counters** "Checked In: X" and "Registered: Y" from `useEventStats`, kept **synchronized over Socket.IO** via the shared `useEventRealtime(eventId)` hook — each successful check-in triggers a backend `event.stats.updated` broadcast (Phase 7) that updates the counters here and on any other open screen.

### API client change
- `apiFetch` now throws a typed **`ApiError`** carrying the HTTP `status` (previously a plain `Error` with only a message). This lets the check-in screen distinguish 404 vs 409 precisely. `ErrorMessage` still reads `.message`, so existing pages are unaffected.
- *tsconfig note:* the frontend uses `erasableSyntaxOnly`, which forbids TS constructor parameter properties — wrote `ApiError` with an explicit field + assignment instead.

### Checks
- `npm run typecheck` → clean.
- `npm run lint` (oxlint) → **0 warnings, 0 errors** (22 files).
- `npm run build` → success.

This completes the participant + organizer UI (event list, registration, dashboard, check-in) on top of the full backend.

---

## 2026-09-14 22:53 KST — Phase 12: Organizer dashboard with live stats (/organizer/events/:eventId)

Implemented the organizer dashboard: REST for initial data, Socket.IO for live updates. No git commit.

### What was implemented
- **Summary cards** — Capacity, Registered, Waitlisted, Checked In (from `GET /api/events/:id/stats`).
- **Registered table** — email, registration time, checked-in status (timestamp badge or "Not checked in").
- **Waitlist table** — position (`waitlistPos`), email, joined-waitlist time (from `GET /api/events/:id/registrations`).
- New hooks: `useEventStats` (`api/dashboard.ts`), `useEventRegistrations` + `ParticipantDto` (`api/registrations.ts`).
- **Realtime hook `useEventRealtime(eventId)`** (`realtime/useEventRealtime.ts`):
  - Subscribes to the `event:{eventId}` room and listens for `event.stats.updated`.
  - On each event: `setQueryData` updates the stats cards instantly from the snapshot, and invalidates the registrations query so the tables refetch from REST.
  - **Reconnect-safe:** on the socket `connect` event (initial + every reconnect) it re-subscribes to the room and invalidates BOTH queries → refetches current state from REST rather than assuming no events were missed.
  - **Cleanup:** removes the `event.stats.updated` and `connect` listeners and unsubscribes from the room on unmount.

### Multi-tab behavior
Each open tab has its own socket connection joined to the same room, so a single backend broadcast reaches all of them. Any state change the backend emits after — a registration, cancellation, waitlist promotion, or check-in (all wired to broadcast in Phase 7) — updates every open dashboard tab. No client-side capacity logic; the backend snapshot is authoritative.

### Checks
- `npm run typecheck` → clean.
- `npm run lint` (oxlint) → **0 warnings, 0 errors** (21 files).
- `npm run build` → success.
- Live two-tab behavior not exercised in an automated run here; the backend side is covered by Phase 7's two-client e2e test, and the client wiring (subscribe / snapshot-apply / reconnect-refetch / unmount-cleanup) is implemented per requirements.

---

## 2026-09-14 22:49 KST — Phase 11: Participant registration page (/events/:eventId)

Implemented the participant-facing registration UI. No git commit.

### What was implemented
- **`useRegister(eventId)`** — TanStack Query `useMutation` → `POST /api/events/:eventId/registrations` with `{ email }`, typed `RegistrationResult` (`api/registrations.ts`).
- **`RegistrationForm`** component + wired into `EventDetailPage`, which already shows **title, description, date/time, and capacity** (from `useEvent`).
- **Result states driven entirely by the backend response** (no capacity logic on the client):
  - `REGISTERED` → success message, status, and the **ticket code**.
  - `WAITLISTED` → "event is currently full" + "added to the waitlist" (+ position when present).
  - other statuses → shows the returned status generically.
- **Loading / disabled:** submit button shows "Registering…" and both input and button are `disabled` while `mutation.isPending`.
- **Validation errors:** minimal client-side check (required + email format) shown inline; the button doesn't submit an obviously-invalid email.
- **Network / backend errors:** any thrown error from `apiFetch` (non-2xx with backend `message`, e.g. a 400 `email must be an email`, or a network failure) is surfaced via the shared `ErrorMessage` component.

### Note on "duplicate registration"
The backend is **idempotent** for duplicates (Phase 3): re-registering the same email returns the *existing* registration with `200`, not an error. So the UI simply re-displays the current status (REGISTERED/WAITLISTED) — there is no duplicate "error" to show, which is the correct source-of-truth behavior. Genuine errors (validation, 404, network) are still shown clearly via `ErrorMessage`. The frontend reproduces **none** of the capacity/waitlist/duplicate decision logic.

### Checks
- `npm run typecheck` → clean.
- `npm run lint` (oxlint) → **0 warnings, 0 errors** (19 files).
- `npm run build` → success.

---

## 2026-09-14 22:45 KST — Phase 10: Frontend foundation (routing, API client, providers)

Built the frontend skeleton on top of the Phase 0 scaffold (React + TS + Vite + TanStack Query + Socket.IO client already present). Added React Router; realtime behavior intentionally left as infrastructure only. No git commit.

### What was implemented
- **React Router v7** wired in `main.tsx` (`BrowserRouter`) with routes in `App.tsx` under a shared `Layout`:
  - `/` → `HomePage` (lists events)
  - `/events/:eventId` → `EventDetailPage`
  - `/organizer/events/:eventId` → `OrganizerDashboardPage`
  - `/check-in/:eventId` → `CheckInPage`
  - `*` → `NotFoundPage`
- **Reusable API client** (`api/client.ts`, from Phase 0): `apiFetch<T>` wrapper; **backend URL from `VITE_API_URL`** (Socket.IO from `VITE_SOCKET_URL`). Added `api/events.ts` (TanStack Query hooks `useEvents`/`useEvent` + `eventKeys`) and shared `types.ts`.
- **Common components:** `Layout` (header/nav + `Outlet` + footer), `Loading` (spinner + message), `ErrorMessage` (message + optional retry).
- **TanStack Query** configured (shared `QueryClient`, `QueryClientProvider` + devtools in `main.tsx`).
- **Socket.IO infrastructure** (`realtime/socket.ts`): singleton `getSocket`, `subscribeToEvent`/`unsubscribeFromEvent`, `onStatsUpdated(handler)`. Aligned message names to the backend gateway (`subscribe`/`unsubscribe`, `event.stats.updated`) — the previous Phase-0 stub used stale `join`/`leave`. Not yet wired into any page (per this phase's scope).
- **Styling:** hand-written CSS (`index.css`) — clean, professional, no UI framework. Home lists events as cards with Details / Dashboard / Check-in links; detail/organizer/check-in pages fetch the event and show a labelled placeholder for the feature landing in a later phase.
- **`.env.example`** present (`VITE_API_URL`, `VITE_SOCKET_URL`).

### Checks
- `npm run typecheck` (`tsc -b`) → clean.
- `npm run lint` (oxlint) → **0 warnings, 0 errors** across 17 files.
- `npm run build` (`tsc -b` + vite) → success.
- *Gotcha:* oxlint hit the same npm optional-native-binding bug as rolldown in Phase 0 (`@oxlint/binding-darwin-arm64` not auto-installed on Node 20.17); installed it manually. Upgrading Node clears this class of issue.

### Docs
- README updated with a **frontend getting-started** section (env vars, scripts, route table).

### Notes
- Registration form, live dashboard stats, and the check-in form are deliberately deferred to later phases; the pages render placeholders and already consume the API client + common components.

---

## 2026-09-14 22:37 KST — Phase 8: Event reminder background job

Added a cron job that sends each REGISTERED participant exactly one `EVENT_REMINDER` ~24h before their event, reusing the Phase 6 email outbox for exactly-once delivery. No git commit.

### What was implemented
- **`ScheduleModule.forRoot()`** enabled in `AppModule`; new **`SchedulerModule`** with `ReminderService`.
- **`ReminderService`** with `@Cron(EVERY_MINUTE)` → `processReminders(now = new Date())`:
  - Finds events with `startsAt` in `(now, now + 24h]` (the reminder window).
  - For each, records `EVENT_REMINDER` for every **currently REGISTERED** participant (WAITLISTED/CANCELLED excluded, reqs. 2–3), inside a per-event transaction.
  - `now` is an injectable parameter for deterministic tests.
- **Dev-only trigger:** `POST /api/dev/reminders/run` (`DevReminderController`) runs the job on demand and returns `{ eventsInWindow, remindersSent }`; 404 when `NODE_ENV=production` (req. 9).

### Exactly-once / persistence strategy (reqs. 4–8)
- No in-memory flags. Uniqueness is enforced by the email **`deduplicationKey`** `event-reminder:{eventId}:{registrationId}`, persisted in the `EmailLog` table (req. 5). `EmailService.recordInTx` uses `createMany({ skipDuplicates: true })`, so:
  - re-running the job (overlapping ticks, manual + cron) inserts nothing the second time (reqs. 6–7),
  - a **backend restart** cannot resend — the state is in Postgres, not the process (req. 6),
  - a participant registering later but still in-window still gets their single reminder.
- Chose **not** to gate on `Event.reminderSentAt`, since a coarse per-event flag would wrongly suppress reminders for participants who register after the first tick. Per-participant dedup is the authoritative guard.

### Reminder window / scheduling assumptions
- Window = event starts within the next **24h**. Job cadence = every minute (acceptable per the assignment). Documented in README.

### Tests performed
`npm test` → **10 suites, 48 tests, all passing** (~5s). New `reminder.integration.spec.ts` (real Postgres, 5), self-cleaning:
- normal reminder → one per REGISTERED participant in-window.
- WAITLISTED + CANCELLED excluded → only the REGISTERED one reminded.
- repeated job runs (×3) → still exactly one reminder each (idempotent).
- event outside the 24h window → no reminders.
- **simulated backend restart** (fresh `ReminderService`/`EmailService` instances) → no resend; still exactly one.
- `npm run build` → exit 0; DB self-cleaned to 0 rows.

### Assumptions
- Reminders reuse the mock outbox (no real delivery); the `EmailLog` row is the artifact.
- Running the same job concurrently on multiple instances is still safe (unique key), though not required here.

---

## 2026-09-14 22:30 KST — Phase 6: Mock email notification system

Added a mock email system (no real provider) that records would-be emails to PostgreSQL as an idempotent outbox. No git commit.

### Schema (migration `20260914140000_email_notifications`)
Reshaped `EmailLog` to the required fields: `id, recipient, eventId, registrationId, type, deduplicationKey, payload (jsonb), sentAt`, with **`deduplicationKey @unique`** (global unique, req. 5) and indexes on `eventId`/`registrationId`. New `EmailType` enum: `REGISTRATION_TICKET`, `WAITLIST_PROMOTED`, `EVENT_REMINDER`, `EVENT_RESCHEDULED`. Added `Event.emailLogs` relation; cascade-deletes with event/registration.
- *Migration note:* `prisma migrate dev` refuses to run non-interactively when an enum change carries a data-loss warning. Since the table was empty, generated the SQL with `prisma migrate diff` and applied it via `prisma migrate deploy` (recorded in migration history).

### EmailService & transaction strategy (req. 9)
- **Transactional outbox.** `EmailService.recordInTx(tx, records)` inserts email rows **inside the same transaction** as the business operation that triggers them. The email record therefore exists **iff** the state change commits — no phantom emails on rollback, no lost emails on success (atomic and consistent).
- **Idempotency via `createMany({ skipDuplicates: true })`** on the unique `deduplicationKey`. This never throws on a conflict — important because a thrown error inside a Prisma interactive transaction aborts the whole transaction, so a try/catch-on-P2002 approach would be unsafe here. It returns the count of rows actually inserted (0 on a pure retry).
- A real provider would move the network send to an after-commit worker dispatching unsent outbox rows; here "delivery" is just a log line, and the row itself is the artifact (inspectable via the dev endpoint).

### Notifications wired
- **REGISTRATION_TICKET** — in `RegistrationsService.register`, inside the registration tx, when a participant becomes REGISTERED. Key `registration-ticket:{registrationId}`.
- **WAITLIST_PROMOTED** — in `promoteHead`, inside the cancel tx, when a waitlister is promoted. Key `waitlist-promoted:{registrationId}`.
- **EVENT_RESCHEDULED** — in `EventsService.update`, which now wraps the event update + notifications in one transaction; on a `startsAt` change, records one email per currently REGISTERED participant. Key `event-rescheduled:{eventId}:{registrationId}:{newStartsAtISO}` — includes the new date so a retry of the same change is deduped while a *different* later reschedule sends afresh.
- (EVENT_REMINDER type exists for the future reminder scheduler; not wired yet.)

### Dev-only endpoint (req. 7)
- `GET /api/dev/emails` (`DevEmailsController`) lists the outbox newest-first, wrapped with `_warning: "DEVELOPMENT-ONLY endpoint ..."`. Returns **404 when `NODE_ENV=production`**, so it's hidden in prod.

### Tests performed
`npm test` → **9 suites, 43 tests, all passing** (~5.4s):
- **`email.idempotency.integration.spec.ts`** (real Postgres, 4): retried registration → exactly one REGISTRATION_TICKET; promotion → one WAITLIST_PROMOTED to the right recipient; reschedule → one EVENT_RESCHEDULED per registered participant, unchanged date → no new email, different date → a second email; direct `recordInTx` → returns 1 then 0 for a duplicate key, one row persists.
- **`dev-emails.controller.spec.ts`** (unit, 2): dev returns outbox + warning; production → 404.
- **`events.service.spec.ts`** updated: asserts EVENT_RESCHEDULED recorded on date change (with the composite dedupe key) and none when unchanged.
- All prior suites still green (service constructors updated to inject a real `EmailService` in integration tests).
- `npm run build` → exit 0; DB self-cleaned to 0 rows.

### Assumptions
- Dedupe keys follow the assignment's suggested formats; keying by `registrationId` means re-registering after a cancel reuses the ticket and does not re-send a ticket email.
- No real delivery — the outbox row is the demonstrable artifact.

---

## 2026-09-14 22:15 KST — Phase 7: Realtime organizer stats (Socket.IO)

Added live stats broadcasting so the organizer dashboard updates without refresh and across multiple tabs. (Phase 6 / email deferred.) No git commit.

### What was implemented
- **`RealtimeModule`** with:
  - **`EventsGateway`** (Socket.IO `@WebSocketGateway`, CORS `origin: true`): `subscribe` / `unsubscribe` message handlers join/leave the per-event room `event:{eventId}`; `emitStatsUpdated()` broadcasts `event.stats.updated` to that room.
  - **`RealtimeStatsService`**: computes the snapshot via `DashboardService.getStats` and broadcasts it. Called **after** the DB transaction commits; failures are caught/logged so a broadcast problem can never fail the REST request.
- **Broadcast wired into every state change** (req. 3): `RegistrationsService.register` (REGISTERED + WAITLISTED), `RegistrationsService.cancel` (cancellation + auto-promotion; skipped on no-op repeat cancel), and `CheckInService.checkIn` (checked-in count).
- **Payload contains only aggregate counts** — `{ eventId, capacity, registered, waitlisted, checkedIn }` — no participant PII (req. 5).
- **Rooms** use the `event:{eventId}` convention (req. 1); multiple tabs subscribed to the same event all receive the same update (req. 4).
- **Reconnect-safe by design** (req. 7): broadcasts are fire-and-forget notifications; the frontend is expected to re-fetch `GET /api/events/:eventId/stats` over REST on (re)connect and treat that snapshot as authoritative, applying subsequent events as deltas. Documented in README.

### Notable gotcha (fixed)
- A `@SubscribeMessage` handler that returns a `{ event, data }`-shaped object is interpreted by NestJS as a **`WsResponse` and emitted**, so the client's ack callback never fires (the e2e test hung on subscribe). Fixed by returning a plain ack object `{ status: 'subscribed', eventId }` (no `event` key).

### Tests performed
`npm test` → **7 suites, 36 tests, all passing** (~4.9s):
- **`events.gateway.spec.ts`** (unit, 4): room-name convention, subscribe→join, unsubscribe→leave, and `emitStatsUpdated` sends the correct payload with exactly the 5 aggregate keys (asserts no PII leak).
- **`realtime.integration.spec.ts`** (e2e, 1): boots the full Nest app on an ephemeral port, connects **two** socket.io clients, subscribes both to one event, performs a real registration, and asserts **both** receive an identical `event.stats.updated` (`registered: 1`) with no `email`/PII fields. Self-cleaning; uses real Postgres.
- All prior suites still green (existing integration specs updated to inject a realtime stub).
- `npm run build` → exit 0.

### Docs
- **`README.md`** created at repo root documenting REST endpoints and the full **WebSocket API** (rooms, `subscribe`/`unsubscribe`, `event.stats.updated` payload, client example, reconnect strategy) — satisfies req. 9.

### Assumptions
- Gateway CORS reflects the request origin (`origin: true`) — no auth in scope.
- The Socket.IO server shares the REST origin/port (default `5050`).

---

## 2026-09-14 21:57 KST — Phase 5: Ticket check-in & event stats

Added `POST /api/events/:eventId/check-in` and `GET /api/events/:eventId/stats`. No git commit.

### How duplicate check-in is prevented
- **A single database-level conditional UPDATE — not application memory.** The write is:
  `UPDATE "Registration" SET "checkedInAt" = now() WHERE id = $id AND status = 'REGISTERED' AND "checkedInAt" IS NULL`, issued via Prisma `updateMany`, and the affected-row count is inspected.
- A single `UPDATE ... WHERE` is atomic in Postgres and takes a row lock for its duration. With two concurrent check-ins of the same ticket, the first matches the `checkedInAt IS NULL` predicate and sets the timestamp; the second **blocks on the row lock**, then re-evaluates the predicate against the now-committed row, no longer matches, and affects **0 rows** → treated as already-checked-in → `409`. Exactly one succeeds (req. 8), and correctness does not depend on any in-process flag or lock.
- There is also a cheap pre-check that returns `409` immediately for an obvious repeat, but the atomic guard above is the authoritative protection; both concurrent racers ultimately resolve to one 200 + one 409.

### Behaviour / status codes
- Ticket must belong to the event (req. 1) — mismatch → `404`.
- Only a currently `REGISTERED` participant may check in (req. 2) — otherwise `409` (`ConflictException`) with the offending status; e.g. a cancelled participant's retained ticket cannot be used.
- Ticket may be checked in exactly once (req. 3), storing `checkedInAt` (req. 4).
- First valid check-in → `200` (controller `@HttpCode(200)`, req. 5); repeat → `409` (req. 6); unknown ticket → `404` (req. 7).
- Response: `{ ticketCode, status: 'CHECKED_IN', checkedInAt, participant: { id, email } }`.

### Stats endpoint (req. 9)
- New `DashboardModule`: `GET /api/events/:eventId/stats` → `{ capacity, registered, waitlisted, checkedIn }`. `checkedIn` = `REGISTERED` rows with `checkedInAt IS NOT NULL`. Reuses `EventsService.findOne` for existence (404) + capacity. (Phase 7 will broadcast these live over Socket.IO.)

### Modules
- `check-in/` (`CheckInModule`, controller, service, dto) and `dashboard/` (`DashboardModule`, controller, service), both wired into `AppModule`.

### Tests performed — all against REAL Postgres (no mocked transactions)
`npm test` → **5 suites, 31 tests, all passing** (~5.3s). New `check-in.integration.spec.ts` (7 cases), self-cleaning (verified 0 leftover rows):
- successful check-in → `CHECKED_IN`, `checkedInAt` persisted.
- duplicate check-in → `ConflictException` (409).
- invalid/unknown ticket → `NotFoundException` (404).
- ticket belonging to a different event → `NotFoundException` (404).
- cancelled participant → `ConflictException` (409).
- **two concurrent check-ins of the same ticket → exactly one fulfilled, one rejected**; `checkedInAt` set once.
- stats → `{ capacity: 2, registered: 2, waitlisted: 1, checkedIn: 1 }`.
- `npm run build` → exit 0.

### Assumptions
- A cancelled participant keeps their ticket row (history, from Phase 4); check-in guards on `status` so it can't be redeemed.
- No auth — the check-in screen is trusted (staff/demo context).

---

## 2026-09-14 21:51 KST — Phase 4: Cancellation & automatic waitlist promotion

Added `POST /api/events/:eventId/registrations/cancel`. History is preserved — rows flip to `CANCELLED`, never deleted. No git commit.

### Transactional behavior (the core requirement)
- **One transaction, one lock, atomic cancel→promote.** `cancel()` opens `prisma.$transaction`, takes the **same** `SELECT id FROM "Event" WHERE id = $eventId FOR UPDATE` lock that registration uses, then within that single transaction: flips the target row to `CANCELLED`, and — only if the cancelled row was `REGISTERED` — promotes the earliest `WAITLISTED` participant (`ORDER BY waitlistPos ASC` head) to `REGISTERED` and mints its ticket. All committed together or not at all.
- Because cancels and registrations share the same event-row lock, they are **fully serialized per event**. This makes the three forbidden states impossible:
  - *capacity exceeded* — a promotion only ever runs in the same serialized critical section that just freed exactly one seat;
  - *one spot to two waitlisters* — concurrent cancels can't both promote the same head; the second cancel re-reads the waitlist after the first commits;
  - *broken FIFO* — the head is always the lowest `waitlistPos`.
- **Idempotent repeat cancel (req. 5):** a row already `CANCELLED` returns `{ cancelled: false, alreadyCancelled: true, promoted: null }` and triggers no further promotion.
- **Waitlisted cancel (req. 4):** marks the row `CANCELLED` with no promotion; remaining waitlisters keep their order (see positioning change below).
- **404** for unknown event (empty lock result) or unknown registration.

### Supporting change — gap-safe waitlist positions
- Switched new-waitlister positioning from `count(WAITLISTED)+1` to **`max(waitlistPos)+1`**. After cancellations leave gaps, `count+1` could collide with an existing position; `max+1` stays unique and monotonic, so FIFO ordering survives arbitrary cancellations. No re-compaction needed — ordering is by `waitlistPos ASC`, and gaps don't affect relative order.

### Response information (req. 7)
`CancelResult`: `{ registration, cancelled, alreadyCancelled, promoted }`. `promoted` is the full promoted registration (with its new ticket) or `null` — so callers can tell whether someone was promoted and who.

### Tests performed — all against REAL Postgres (no mocked transactions)
`npm test` → **4 suites, 24 tests, all passing** (~2.5s). New `cancellation.integration.spec.ts` (8 cases), self-cleaning (verified 0 leftover rows):
- REGISTERED cancel with empty waitlist → `CANCELLED`, no promotion, history row retained.
- Auto-promotion of first waitlister → promoted to REGISTERED with a ticket (`/^[0-9A-F]{12}$/`).
- FIFO promotion order → w1 then w2 promoted in sequence.
- WAITLISTED cancel → marked CANCELLED, remaining `[a, c]` order preserved.
- Repeated cancellation → idempotent, no extra promotion, still 1 registered.
- 404 on cancelling a non-existent registration.
- **Concurrent cancels, single waitlister** → exactly one promotion of C; final REGISTERED=1, CANCELLED=2, waitlist empty; C holds one ticket (proves one spot never goes to two people).
- **Concurrent cancels, two waitlisters** → both promoted, REGISTERED=2 (capacity never exceeded), waitlist empty.
- `npm run build` → exit 0.

### Assumptions
- Cancellation is by `{ email }` in the body (participant self-identifies by email, not internal id) — consistent with ARCHITECTURE §4.
- A cancelled REGISTERED participant's **ticket row is retained** (history); check-in (Phase 5) will guard on status so a stale ticket can't be used.
- No auth — anyone may cancel any email (trusted/demo context).

---

## 2026-09-14 21:28 KST — Phase 3: Participant registration & waitlist

Implemented `RegistrationsModule`: `POST /api/events/:eventId/registrations` and `GET /api/events/:eventId/registrations`. No participant cancellation/promotion yet (Phase 4). No git commit.

### Concurrency approach (the key requirement)
- **Pessimistic row lock inside a single interactive transaction.** Each `register()` opens `prisma.$transaction`, and the first statement is a raw `SELECT id, capacity FROM "Event" WHERE id = $eventId FOR UPDATE`. This locks the event row, so all concurrent registrations for the same event are **serialized**: the "count REGISTERED → decide REGISTERED/WAITLISTED → insert" sequence can never interleave.
- Under default **READ COMMITTED** isolation this is sufficient — the second transaction blocks on the lock, then re-reads the now-committed count and is correctly waitlisted.
- **Why this over the alternatives:** simplest reliable option. Serializable isolation would also work but needs client-side retry loops on 40001 serialization failures (more code); an app-level mutex/atomic counter wouldn't survive multiple backend instances. A single-row `FOR UPDATE` has no deadlock risk and needs no retries. (See ARCHITECTURE §8.)
- The lock query doubles as the **event existence check** — an empty result throws `NotFoundException` (404).

### Database constraints
- `@@unique([eventId, email])` on `Registration` — the DB-level backstop guaranteeing one row per (event, email) even if application logic were bypassed. Looked up via the generated `eventId_email` compound key for the app-level idempotency check.
- `Ticket.code @unique` and `Ticket.registrationId @unique` — unique ticket codes; one ticket per registration.
- Both layers of duplicate protection are exercised: app-level (return existing active registration) + DB constraint.

### Behaviour implemented
- REGISTERED when `count(REGISTERED) < capacity`, else WAITLISTED (reqs. 2–3).
- **FIFO waitlist:** `waitlistPos = count(WAITLISTED) + 1`, assigned under the lock; list ordered by `waitlistPos`.
- **Ticket generated only for REGISTERED** (12 uppercase hex chars via `crypto.randomBytes`); waitlisted participants get no ticket (reqs. 6–7).
- **Idempotent duplicate registration** (req. 1): an existing REGISTERED/WAITLISTED row is returned unchanged; a CANCELLED row is revived (re-evaluated against capacity).
- Email normalized (trim + lowercase) before storage/lookup.
- `GET` returns `{ eventId, counts: { registered, waitlisted }, registered[], waitlisted[] }`.

### Tests performed — all against REAL Postgres (no mocked transactions)
`npm test` → **3 suites, 16 tests, all passing** (~2.9s). New `registrations.integration.spec.ts` (5 cases) connects to the local `event_registration` DB via a real `PrismaService`, and is **self-cleaning** (tracks created event ids, cascade-deletes in `afterAll`; verified 0 leftover rows afterward):
- registration when capacity exists → REGISTERED + ticket (`/^[0-9A-F]{12}$/`), `waitlistPos` null.
- registration when full → WAITLISTED, `waitlistPos` 1, no ticket.
- duplicate email (case-insensitive) → same registration id, DB row count stays 1.
- FIFO waitlist ordering → positions 1/2/3, list order matches insertion order.
- **two concurrent users for the last seat** (capacity 10, 9 pre-filled, 2 fired via `Promise.all`) → asserts statuses sort to exactly `[REGISTERED, WAITLISTED]` and DB counts are **REGISTERED = 10 (never 11), WAITLISTED = 1**.
- `npm run build` → exit 0.

### Assumptions
- **Email identity is case-insensitive** and trimmed; `bob@x.com` == `BOB@x.com` for the same event.
- No authentication — anyone can register any email (trusted/demo context, consistent with earlier phases).
- CANCELLED-revival path is implemented defensively even though cancellation isn't exposed until Phase 4.
- Ticket-code collisions are handled by the `@unique` constraint; with 48 bits of randomness they are astronomically unlikely at assignment scale, so no explicit retry loop was added.

---

## 2026-09-14 21:10 KST — Phase 2: Events module

Implemented the Events domain module (CRUD, no participant registration yet). No git commit.

### Completed work
- **DTOs (`src/events/dto/`)** with `class-validator`:
  - `CreateEventDto`: `title` (`@IsNotEmpty`), `description` (`@IsOptional`), `startsAt` (`@IsISO8601`), `capacity` (`@IsInt` + `@Min(1)`).
  - `UpdateEventDto` = `PartialType(CreateEventDto)` (via `@nestjs/mapped-types`) — all fields optional, rules inherited.
- **`EventsService`** (all business logic): `create`, `findAll` (ordered by `startsAt`), `findOne` (404 via `NotFoundException`), `update` (re-uses `findOne` for the 404 guard).
- **`EventsController`** (HTTP only): `POST /api/events`, `GET /api/events`, `GET /api/events/:id`, `PATCH /api/events/:id` — pure delegation to the service.
- Wired `EventsModule` into `AppModule`.

### Important decisions
- **UTC storage (req. 5):** DTO accepts an ISO-8601 string; the service does `new Date(dto.startsAt)` and Prisma persists it in UTC. Kept the wire format as a validated string rather than relying on implicit transform.
- **Reschedule hook (req. 9):** `update()` compares the incoming `startsAt` to the stored value; on a real change it calls a private `handleReschedule()` that only logs today, with a `TODO(Phase 9)` to emit `EVENT_RESCHEDULED` → RESCHEDULE emails. **No email sending implemented yet.**
- **404 semantics:** `update()` calls `findOne()` first so a missing event throws before any write is attempted.
- **Controller/service separation (req. 6):** controllers hold no logic; validation is declarative in DTOs + the global `ValidationPipe` (whitelist + transform) from Phase 0.
- Participant registration intentionally **not** implemented (req. 8) — deferred to Phases 3–4.

### Test results
- `npm test` → **2 suites, 11 tests, all passing** (~1.8s):
  - `events.service.spec.ts` (7): create (+ UTC Date assertion), list, get (found), get (missing → `NotFoundException`), update fields, update detects reschedule (logs, no email), update missing → `NotFoundException`.
  - `create-event.dto.spec.ts` (4): valid payload, capacity ≤ 0 rejected, empty title rejected, invalid `startsAt` rejected.
- `npm run build` (`nest build`) → **exit 0**.
- Live HTTP smoke test not run (declined); unit + validation tests and build cover the module.

---

## 2026-09-14 20:55 KST — Phase 1: Database & Prisma

Set up PostgreSQL + Prisma and the first migration. No git commit.

### Completed work
- Installed `prisma` + `@prisma/client` (v6.19.3).
- **`prisma/schema.prisma`** implementing ARCHITECTURE §6: `Event`, `Registration`, `Ticket`, `EmailLog` + enums `RegistrationStatus`, `EmailType`. Key constraints: `@@unique([eventId, email])`, `Ticket.code @unique`, `Ticket.registrationId @unique`, `@@unique([registrationId, dedupeKey])` on `EmailLog`, `@@index([eventId, status])`. `onDelete: Cascade` on child relations.
- **`PrismaModule` (global) + `PrismaService`** with `onModuleInit`/`onModuleDestroy` connect/disconnect; wired into `AppModule`.
- **`docker-compose.yml`** (postgres:16-alpine, healthcheck) as a portable alternative.
- First migration `20260914115539_init` created and applied.

### Important decisions
- **DB choice:** used the machine's existing local homebrew Postgres 15 (already listening on 5432) instead of Docker, since the Docker daemon wasn't running. Created database `event_registration` owned by `aselbaekki` (trust auth). `docker-compose.yml` retained for reproducibility — note it also maps host 5432, so stop local PG (or change the port) before using it.
- `DATABASE_URL` set in `backend/.env`; `.env.example` documents both the local and Docker forms.

### Verification
- `npx prisma validate` → valid; `npx prisma migrate dev --name init` applied; Prisma Client generated.
- Confirmed via `psql`: tables `Event`, `Registration`, `Ticket`, `EmailLog`, `_prisma_migrations` and enums `RegistrationStatus`, `EmailType` present.
- `npm run build` → exit 0.

---

## 2026-09-14 20:47 KST — Phase 0: reconcile scaffolds to the planned stack

Converted both apps from the initial scaffolds to the finalized stack. No domain logic yet — this is tooling/scaffolding only. No git commit.

### Backend: Express → NestJS + TypeScript
- Removed `src/server.js`, old Express deps, and lockfile.
- New `package.json` with NestJS 11 (`@nestjs/common|core|platform-express|config`), `class-validator`/`class-transformer`, and the standard Nest toolchain (CLI, jest/ts-jest, eslint flat-config + prettier).
- Added `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `eslint.config.mjs`, `.prettierrc`; Jest config in `package.json`.
- `src/main.ts` bootstrap: global `/api` prefix, global `ValidationPipe` (whitelist + transform), CORS from `CORS_ORIGIN`, port from config (default 5050).
- `src/app.module.ts` with global `ConfigModule`; `src/health/` module exposing `GET /api` and `GET /api/health`.
- **Verified:** `npm run build` (exit 0) and `node dist/main.js` — `GET /api` → 200, `GET /api/health` → 200, unknown route → 404.

### Frontend: plain-JS React → TypeScript + TanStack Query + Socket.IO client
- Removed Vite JSX boilerplate (`App.jsx`, `main.jsx`, `App.css`, `assets/`, `vite.config.js`).
- Added `@tanstack/react-query` (+ devtools) and `socket.io-client`; TS configs (`tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json`), `vite.config.ts`, `src/vite-env.d.ts` with typed env vars.
- Scaffolded the structure from ARCHITECTURE §10: `src/api/client.ts` (fetch wrapper), `src/api/queryClient.ts` (shared QueryClient), `src/realtime/socket.ts` (Socket.IO singleton + join/leave room helpers).
- `main.tsx` wraps `App` in `QueryClientProvider`; `App.tsx` is a Phase-0 placeholder that pings `/api/health` via TanStack Query to prove the wiring.
- Added `.env.example` (`VITE_API_URL`, `VITE_SOCKET_URL`).
- **Verified:** `npm run typecheck` (tsc) clean; `npm run build` succeeds; `npm run dev` boots (Vite ready).

### Environment notes / gotchas
- **Node 20.17.0** is below Vite 8's preferred `20.19+ / 22.12+`. It builds/runs with a warning; recommend upgrading Node to clear it.
- **rolldown native binding bug:** Vite 8 (rolldown) failed to build until `@rolldown/binding-darwin-arm64` was installed manually (npm optional-dependency resolution bug, likely aggravated by the old Node version). Installed on this machine; upgrading Node or a clean reinstall should make it resolve automatically. Flagged so a fresh clone knows the fix.
- Backend port remains **5050** (macOS AirPlay holds 5000); frontend dev server on **5173**, wired via CORS.

---

## 2026-09-14 20:33 KST — Architecture & design (design step, no implementation)

Analyzed the full requirement set and produced [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md). No application code written this step. Summary of the architectural decisions:

### Shape
- **Modular monolith** NestJS backend (single process, multiple modules) + **React SPA** + **PostgreSQL**. Explicitly *not* microservices — the domain fits one process and a single DB connection pool is what makes the concurrency guarantees simple.
- **PostgreSQL is the single source of truth and the single point of serialization.** Every correctness rule is enforced by DB constraints/transactions; Socket.IO is a notification layer only and never makes authoritative decisions.

### Modules
`Prisma`, `Events`, `Registrations` (concurrency core), `CheckIn`, `Dashboard`, `Realtime` (Socket.IO gateway), `Email` (mock + outbox), `Scheduler` (reminders), `Health`, `Common`.

### Data model
`Event 1—N Registration 1—1 Ticket`, plus `EmailLog` as an idempotency ledger.
- Registration states: **REGISTERED / WAITLISTED / CANCELLED**; check-in is an orthogonal `checkedInAt` timestamp (not a status) so a participant stays "registered" after check-in.
- `@@unique([eventId, email])` → idempotent registration.
- `Ticket.code @unique` → unique ticket code.
- `@@unique([registrationId, dedupeKey])` on `EmailLog` → exactly-once emails.

### Concurrency (the last-spot race, req. 4)
- **Pessimistic row lock**: `SELECT … FROM "Event" WHERE id=$id FOR UPDATE` at the top of a transaction serializes all registrations for one event. Count-and-decide then runs race-free → exactly one REGISTERED, one WAITLISTED.
- Chosen over serializable+retry (more code) and app-level mutex (doesn't survive multiple instances). `unique(eventId,email)` is an independent second safety net.
- The same event lock covers cancel + auto-promotion so a cancel and a new registration can't both claim the freed seat.

### Idempotency
- One pattern everywhere: **insert-ledger-row-then-act**. Winning a unique-constrained insert is the permission to perform the side effect once.
  - Duplicate registration → unique key, return existing (200).
  - Duplicate check-in → conditional `UPDATE … WHERE checkedInAt IS NULL`, check rows-affected.
  - Ticket / reminder / reschedule emails → `EmailLog` unique `(registrationId, dedupeKey)`; reminder cron is safe to run repeatedly.

### Realtime (reqs. 8, 10)
- Socket.IO room per event (`event:{eventId}`). Server broadcasts **after DB commit** only.
- `dashboard.updated` carries a full stats snapshot so dashboards render correct totals without replaying deltas; granular `registration.*` / `checkin.updated` events also emitted.
- Frontend: Socket.IO client → `queryClient.invalidateQueries` for the affected event, so every open tab reacts identically (multi-client correctness).

### API surface
- REST under `/api`: events CRUD + `/dashboard`; `POST /events/:id/registrations` (idempotent) + `/cancel`; `GET /tickets/:code` + `POST /tickets/:code/check-in`.

### Phasing
- 13 phases (0–12), one commit each, backend correctness first → realtime → frontend → tests. Concurrency-critical work (registration/waitlist/promotion) lands in phases 3–4.

### Reconciliation / open items
- **Stack gap:** existing scaffolds are Express (backend) and plain-JS React+Vite (frontend). Phase 0 must convert/re-scaffold to the planned NestJS+TS backend and add TanStack Query + Socket.IO client on the frontend.
- Backend port defaulted to **5050** (macOS AirPlay occupies 5000).
- No auth in scope — trusted/demo context assumed.

---

## 2026-09-09 — Project scaffolding

- Initialized `frontend/` with Vite + React (Create React App is deprecated as of 2025; Vite is its recommended replacement). Dependencies installed.
- Initialized `backend/` as a Node.js + Express server (ES modules) with `cors` and `dotenv`; health routes verified. Default port set to `5050` to avoid the macOS AirPlay conflict on `5000`.
- *Note:* both scaffolds predate the finalized stack decision (NestJS+TS / TanStack Query + Socket.IO) and will be reconciled in Phase 0.
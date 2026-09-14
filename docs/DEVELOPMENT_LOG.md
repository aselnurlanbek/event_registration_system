# Development Log

Chronological record of decisions and progress. Newest entries at the top.

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
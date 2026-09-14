# Event Registration System — Architecture

> Design document. Scope of this step: analysis and design only — **no full implementation yet**.

## 1. Requirements Analysis

The system is a client–server web application with two roles:

- **Organizer** — creates events (with a capacity limit), reschedules them, and watches a live dashboard / runs check-in.
- **Participant** — registers for an event by email, may be waitlisted, can cancel, and receives a ticket with a unique code.

The requirements fall into three categories:

### Functional
- Event lifecycle: create, read, update (date/time change is special), list.
- Registration by email; cancellation.
- Waitlist when capacity is reached.
- Automatic promotion of the first waitlisted participant on cancellation.
- Ticket with a unique code; single-use check-in.
- Organizer dashboard: registered / waitlist / checked-in counts.

### Correctness / concurrency (the hard part)
1. **Idempotent registration** — same email + same event ⇒ never a second registration.
2. **Capacity enforcement** — when full, new participants go to the waitlist.
3. **Auto-promotion** — cancel by a REGISTERED participant frees a spot for the first WAITLISTED one.
4. **Last-spot race** — two concurrent registrations for the last seat ⇒ exactly one REGISTERED, one WAITLISTED.
5. **Ticket email** — REGISTERED participants get a ticket email.
6. **Reminder** — every registered participant gets **exactly one** reminder 24h before.
7. **Single check-in** — a ticket can be checked in only once.
8. **Live stats** — dashboard updates without page refresh.
9. **Reschedule notification** — date/time change emails registered participants.
10. **Multi-client correctness** — works with many tabs/clients open simultaneously.

Requirements 1–4, 6, 7 are fundamentally about **atomicity and idempotency at the database layer**. Requirements 8, 10 are about **realtime fan-out**. These two concerns drive the whole design.

### Non-functional
- Simple, single-service backend (no microservices) — this is a technical assignment.
- Deterministic, testable concurrency behavior.
- Mock/local email (no external provider).

---

## 2. Proposed Architecture

A **single modular-monolith backend** + **SPA frontend** + **PostgreSQL**. One process, several NestJS modules. Realtime via a Socket.IO gateway embedded in the same process.

```
┌──────────────────────────┐         REST (TanStack Query)          ┌───────────────────────────────┐
│  React SPA (Vite + TS)   │ ─────────────────────────────────────▶ │  NestJS backend (single proc) │
│                          │                                         │                               │
│  - Event pages           │ ◀───────  WebSocket (Socket.IO) ──────▶ │  REST controllers             │
│  - Register / Ticket     │        rooms: event:{eventId}           │  Socket.IO gateway            │
│  - Check-in screen       │                                         │  Domain services              │
│  - Organizer dashboard   │                                         │  Mock email service           │
└──────────────────────────┘                                         │  Reminder scheduler (cron)    │
                                                                      └───────────────┬───────────────┘
                                                                                      │ Prisma
                                                                                      ▼
                                                                            ┌───────────────────┐
                                                                            │   PostgreSQL      │
                                                                            │  (source of truth)│
                                                                            └───────────────────┘
```

**Key principle:** PostgreSQL is the single source of truth and the single point of serialization. All correctness guarantees (capacity, uniqueness, single check-in, exactly-once email) are enforced by **database constraints and transactions**, never by application-level coordination. Socket.IO is a *notification* layer only — it never carries authoritative state decisions.

Why a modular monolith:
- The whole domain fits one process; splitting into services would add network hops, distributed transactions, and eventual-consistency headaches for zero benefit at this scale.
- A single DB connection pool lets us use transactions + row locks for the concurrency requirements — the simplest correct tool.

---

## 3. Backend Modules (NestJS)

| Module | Responsibility |
|---|---|
| `PrismaModule` | Global Prisma client provider (`PrismaService`), connection lifecycle. |
| `EventsModule` | Event CRUD; on date/time change, triggers reschedule notifications. |
| `RegistrationsModule` | The core domain: register (with capacity/waitlist decision), cancel, auto-promotion. Owns the concurrency-critical transaction. |
| `CheckInModule` | Ticket lookup by code; atomic single-use check-in. |
| `DashboardModule` | Aggregated counts (registered / waitlist / checked-in) per event. |
| `RealtimeModule` | Socket.IO gateway (`EventsGateway`); room management; broadcasts domain events. |
| `EmailModule` | Mock mailer (`EmailService`) + outbox/idempotency (`EmailLog`). Logs to console/DB instead of sending. |
| `SchedulerModule` | `@nestjs/schedule` cron job for 24h reminders. |
| `HealthModule` | Liveness/readiness endpoint. |
| `CommonModule` | Shared: DTO validation pipes, exception filters, response shaping. |

Dependency direction: `Registrations`, `CheckIn`, `Events` depend on `Prisma`, `Email`, and `Realtime`. `Realtime` depends on nothing domain-specific (it just broadcasts). `Scheduler` depends on `Email` + `Prisma`.

**Note on emitting realtime events:** domain services do the DB write in a transaction, then — *after commit* — call `RealtimeModule` to broadcast. Broadcasting after commit avoids notifying clients about state that later rolls back.

---

## 4. REST API Endpoints

Base path: `/api`.

### Events
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/events` | Create an event (`title`, `description`, `startsAt`, `capacity`). |
| `GET` | `/api/events` | List events. |
| `GET` | `/api/events/:eventId` | Event detail. |
| `PATCH` | `/api/events/:eventId` | Update event. Changing `startsAt` ⇒ reschedule notification emails. |
| `GET` | `/api/events/:eventId/dashboard` | Stats snapshot: `{ registered, waitlisted, checkedIn, capacity }`. |

### Registrations
| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/events/:eventId/registrations` | Register by email. **Idempotent** on `(eventId, email)`. Returns `{ status: REGISTERED \| WAITLISTED, ticket? }`. |
| `GET` | `/api/events/:eventId/registrations` | List registrations (organizer view). |
| `POST` | `/api/events/:eventId/registrations/cancel` | Cancel by email (body: `{ email }`). Triggers auto-promotion. |

> Cancellation is modeled as `POST .../cancel` with an email in the body rather than `DELETE /registrations/:id`, because the participant identifies themselves by email, not by an internal id they don't know.

### Tickets / Check-in
| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/tickets/:code` | Look up a ticket by code (for the check-in screen preview). |
| `POST` | `/api/tickets/:code/check-in` | **Atomic single-use** check-in. Returns `already_checked_in` if repeated. |

All mutating endpoints return the resulting resource state so the client can update optimistically; the authoritative broadcast follows over WebSocket.

---

## 5. WebSocket Events (Socket.IO)

Single namespace `/` (or `/realtime`). Clients join a **room per event**: `event:{eventId}`. This scopes broadcasts so a client watching event A never receives event B's traffic — important for the multi-client requirement.

### Client → Server
| Event | Payload | Effect |
|---|---|---|
| `join` | `{ eventId }` | Join room `event:{eventId}`. |
| `leave` | `{ eventId }` | Leave the room. |

### Server → Client (broadcast to `event:{eventId}`, always after DB commit)
| Event | Payload | Trigger |
|---|---|---|
| `registration.created` | `{ eventId, status, email(masked) }` | New registration (REGISTERED or WAITLISTED). |
| `registration.cancelled` | `{ eventId, email(masked) }` | A registration was cancelled. |
| `registration.promoted` | `{ eventId, email(masked) }` | A waitlisted participant was auto-promoted. |
| `checkin.updated` | `{ eventId, ticketCode }` | A ticket was checked in. |
| `dashboard.updated` | `{ eventId, registered, waitlisted, checkedIn, capacity }` | Emitted alongside every state change so dashboards stay live (req. 8). |
| `event.updated` | `{ eventId, startsAt, ... }` | Event fields (esp. date/time) changed. |

The `dashboard.updated` snapshot is intentionally redundant with the granular events: dashboards can subscribe to just that one and always render correct totals without replaying deltas. Emails are masked in payloads to avoid leaking participant PII to all connected clients.

---

## 6. Data Model (Prisma / PostgreSQL)

```prisma
model Event {
  id             String         @id @default(cuid())
  title          String
  description    String?
  startsAt       DateTime
  capacity       Int
  reminderSentAt DateTime?      // coarse guard; per-participant guard is EmailLog
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  registrations  Registration[]
}

enum RegistrationStatus {
  REGISTERED
  WAITLISTED
  CANCELLED
}

model Registration {
  id           String             @id @default(cuid())
  event        Event              @relation(fields: [eventId], references: [id])
  eventId      String
  email        String
  status       RegistrationStatus
  waitlistPos  Int?               // ordering for promotion (null unless WAITLISTED)
  checkedInAt  DateTime?          // set once at check-in
  createdAt    DateTime           @default(now())
  updatedAt    DateTime           @updatedAt
  ticket       Ticket?
  emailLogs    EmailLog[]

  @@unique([eventId, email])      // ← enforces idempotent registration (req. 1)
  @@index([eventId, status])      // fast capacity counts & waitlist ordering
}

model Ticket {
  id             String       @id @default(cuid())
  code           String       @unique          // the unique ticket code
  registration   Registration @relation(fields: [registrationId], references: [id])
  registrationId String       @unique
  createdAt      DateTime     @default(now())
}

enum EmailType {
  TICKET
  REMINDER
  RESCHEDULE
}

model EmailLog {
  id             String       @id @default(cuid())
  registration   Registration @relation(fields: [registrationId], references: [id])
  registrationId String
  type           EmailType
  // For RESCHEDULE (can happen multiple times) we include a discriminator; for
  // TICKET/REMINDER the natural key alone must be unique (exactly-once).
  dedupeKey      String       // e.g. "TICKET", "REMINDER", or "RESCHEDULE:<startsAtISO>"
  sentAt         DateTime     @default(now())

  @@unique([registrationId, dedupeKey])  // ← exactly-once email guard (reqs. 5, 6, 9)
}
```

### Relationships
- `Event 1—N Registration` (one event, many registrations).
- `Registration 1—1 Ticket` (a ticket exists for REGISTERED participants; created at registration or on promotion).
- `Registration 1—N EmailLog` (one row per email actually sent to that participant).

### Design notes
- **Check-in is a timestamp on `Registration` (`checkedInAt`), not a status.** A participant is simultaneously REGISTERED and (later) checked-in; making CHECKED_IN a status would lose the "registered" fact. Counts derive: registered = `status=REGISTERED`, checked-in = `status=REGISTERED AND checkedInAt IS NOT NULL`.
- **`waitlistPos`** gives a stable FIFO order for promotion. Alternatively `ORDER BY createdAt` on WAITLISTED rows; an explicit column is clearer and avoids tie-break ambiguity.
- **`EmailLog` is both an audit log and the idempotency ledger** — inserting the row *is* the dedupe check.

---

## 7. Registration States

```
                 register (capacity available)
        ────────────────────────────────────────────▶  REGISTERED ──── check-in ───▶ REGISTERED
       │                                                    │  ▲                        (checkedInAt set)
   (new email)                                        cancel│  │ auto-promote
       │                                                    ▼  │
        ────────────────────────────────────────────▶  WAITLISTED
                 register (event full)                      │
                                                       cancel│
                                                            ▼
                                                        CANCELLED
```

Enum states: **REGISTERED**, **WAITLISTED**, **CANCELLED**. Check-in is an orthogonal flag (`checkedInAt`) on a REGISTERED row.

Transitions:
- `∅ → REGISTERED` — register when `count(REGISTERED) < capacity`.
- `∅ → WAITLISTED` — register when full.
- `REGISTERED → CANCELLED` — participant cancels ⇒ triggers promotion of head of waitlist.
- `WAITLISTED → REGISTERED` — auto-promotion (also `WAITLISTED → CANCELLED` if the waitlisted person cancels).
- Re-registering a CANCELLED email is allowed: reuse the existing row (unique key still holds) by flipping it back to REGISTERED/WAITLISTED rather than inserting a new one.

---

## 8. Safe Concurrent Registration for the Last Spot (Req. 4)

**Problem:** two requests read `count(REGISTERED) = capacity - 1` at the same time, both conclude "a spot is free", both insert REGISTERED ⇒ over-capacity.

**Solution: serialize per-event with a pessimistic row lock inside a transaction.** All registration writes for a given event are funneled through a lock on that event's row, so the count-and-decide step is never concurrent for the same event.

```
BEGIN;
  -- 1. Serialize all registrations for THIS event. Concurrent txns block here.
  SELECT id FROM "Event" WHERE id = $eventId FOR UPDATE;

  -- 2. Idempotency: does this email already have a live registration?
  --    (unique(eventId,email) is the backstop; this makes it a clean 200.)
  SELECT * FROM "Registration"
    WHERE "eventId" = $eventId AND email = $email;
  -- if found and not CANCELLED → return it unchanged (idempotent, req. 1)

  -- 3. Capacity decision (now race-free, we hold the lock):
  SELECT count(*) FROM "Registration"
    WHERE "eventId" = $eventId AND status = 'REGISTERED';

  -- 4. status = count < capacity ? REGISTERED : WAITLISTED
  --    insert (or revive a CANCELLED row); if REGISTERED, create Ticket.
  INSERT INTO "Registration" (...) ...;
COMMIT;
-- after commit: send ticket email (idempotent) + broadcast realtime events
```

With the `FOR UPDATE` lock, the two racing requests are forced into a strict order: the first gets the last REGISTERED spot, the second reads the now-full count and becomes WAITLISTED. Exactly the required outcome.

**Why pessimistic locking over the alternatives:**
- *Serializable isolation + retry* also works but requires retry loops on serialization failures — more code, harder to reason about for an assignment.
- *Application mutex / queue* would not survive multiple backend instances and reintroduces the very coordination we want the DB to own.
- The `unique(eventId, email)` constraint is a **second, independent** safety net: even if two identical registrations somehow raced, the DB rejects the duplicate.

The same event-row lock is reused by **cancellation + auto-promotion**, so a cancel and a new registration can't both claim the freed seat.

---

## 9. Idempotency Strategy

Every "must happen at most once" requirement is backed by a **unique constraint** — the database rejects the duplicate; the application treats the rejection as success.

| Concern | Mechanism | Behavior on repeat |
|---|---|---|
| **Duplicate registration** (req. 1) | `@@unique([eventId, email])` + the in-transaction lookup in §8. | Return the existing registration with `200` (no new row, no error). |
| **Duplicate check-in** (req. 7) | Conditional atomic update: `UPDATE "Registration" SET "checkedInAt" = now() WHERE ticketCode = $code AND "checkedInAt" IS NULL`. Check rows-affected. | 0 rows affected ⇒ already checked in ⇒ return `already_checked_in` (idempotent, no error). |
| **Ticket email** (req. 5) | Insert `EmailLog(registrationId, dedupeKey='TICKET')` — unique. Send only if the insert succeeds. | Unique violation ⇒ email already sent ⇒ skip silently. |
| **Reminder** (req. 6) | Cron finds events ~24h out; for each REGISTERED participant, `INSERT EmailLog(dedupeKey='REMINDER')`. Send only on successful insert. | Re-runs / multiple cron ticks / restarts all hit the unique constraint ⇒ exactly one reminder per participant. |
| **Reschedule email** (req. 9) | `EmailLog(dedupeKey='RESCHEDULE:<newStartsAtISO>')`. | Same date change re-sent ⇒ deduped; a *different* new date ⇒ different key ⇒ a new notification (correct). |

**The pattern in one sentence:** *insert-the-ledger-row-then-act* — because the insert is atomic and unique-constrained, winning the insert is the permission to perform the side effect exactly once. This is safe across retries, concurrent workers, and process restarts.

The reminder cron is designed to be safe to run every minute: it only ever emits emails for `EmailLog` rows it successfully inserts, so overlapping runs cannot double-send.

---

## 10. Folder Structures

### Backend (NestJS + TypeScript + Prisma)
```
backend/
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── main.ts                 # bootstrap, CORS, validation pipe
│   ├── app.module.ts
│   ├── prisma/
│   │   ├── prisma.module.ts
│   │   └── prisma.service.ts
│   ├── common/                 # filters, interceptors, dto helpers
│   ├── events/
│   │   ├── events.controller.ts
│   │   ├── events.service.ts
│   │   ├── events.module.ts
│   │   └── dto/
│   ├── registrations/
│   │   ├── registrations.controller.ts
│   │   ├── registrations.service.ts   # ← §8 transaction lives here
│   │   ├── registrations.module.ts
│   │   └── dto/
│   ├── check-in/
│   │   ├── check-in.controller.ts
│   │   ├── check-in.service.ts
│   │   └── check-in.module.ts
│   ├── dashboard/
│   │   ├── dashboard.controller.ts
│   │   ├── dashboard.service.ts
│   │   └── dashboard.module.ts
│   ├── realtime/
│   │   ├── events.gateway.ts          # Socket.IO gateway + rooms
│   │   └── realtime.module.ts
│   ├── email/
│   │   ├── email.service.ts           # mock mailer (console/DB)
│   │   └── email.module.ts
│   ├── scheduler/
│   │   ├── reminder.service.ts        # @Cron 24h reminders
│   │   └── scheduler.module.ts
│   └── health/
├── test/                              # e2e + concurrency tests
├── .env / .env.example
└── package.json
```

### Frontend (React + TypeScript + Vite + TanStack Query + Socket.IO)
```
frontend/
├── src/
│   ├── main.tsx
│   ├── App.tsx                 # router
│   ├── api/
│   │   ├── client.ts           # fetch/axios wrapper, base URL
│   │   ├── events.ts           # TanStack Query hooks: useEvents, useEvent...
│   │   ├── registrations.ts    # useRegister, useCancel
│   │   └── tickets.ts          # useTicket, useCheckIn
│   ├── realtime/
│   │   ├── socket.ts           # Socket.IO client singleton
│   │   └── useEventRoom.ts     # join/leave + query invalidation on events
│   ├── pages/
│   │   ├── EventListPage.tsx
│   │   ├── EventDetailPage.tsx
│   │   ├── RegisterPage.tsx
│   │   ├── TicketPage.tsx
│   │   ├── CheckInPage.tsx
│   │   └── DashboardPage.tsx
│   ├── components/
│   ├── types/                  # shared DTO types (mirror backend)
│   └── lib/
├── .env / .env.example
└── package.json
```

**Realtime + TanStack Query integration:** the Socket.IO client listens for `dashboard.updated` / `registration.*` / `checkin.updated` and calls `queryClient.invalidateQueries` (or `setQueryData`) for the affected event. This keeps req. 8 (live stats) and req. 10 (multi-client) satisfied with almost no bespoke state code — the server broadcast is the single trigger and every tab reacts identically.

---

## 11. Implementation Phases (one Git commit each)

Each phase is independently committable and leaves the app in a working state.

| Phase | Commit theme | Contents |
|---|---|---|
| **0** | Scaffolding & tooling | Convert backend to NestJS+TS, frontend to TS; ESLint/Prettier; `.env.example`; docs (this step). |
| **1** | Database & Prisma | `schema.prisma` (Event, Registration, Ticket, EmailLog, enums), first migration, `PrismaService`, docker-compose for Postgres. |
| **2** | Events CRUD | `EventsModule`: create/list/get/update endpoints + DTO validation. |
| **3** | Registration + capacity + waitlist | `RegistrationsModule` register endpoint with the §8 locked transaction; REGISTERED/WAITLISTED decision; `unique(eventId,email)` idempotency. |
| **4** | Cancellation + auto-promotion | Cancel endpoint; promote head of waitlist under the same event lock. |
| **5** | Tickets + check-in | Ticket code generation; `GET /tickets/:code`; atomic single-use check-in. |
| **6** | Mock email + outbox | `EmailModule` + `EmailLog`; ticket email on registration (idempotent). |
| **7** | Realtime + live dashboard | `RealtimeModule`/`EventsGateway`, rooms, broadcasts after commit; `DashboardModule` stats endpoint; wire broadcasts into phases 3–6. |
| **8** | Reminder scheduler | `@nestjs/schedule` cron; exactly-once reminder via `EmailLog`. |
| **9** | Reschedule notification | `PATCH /events/:id` date change ⇒ `RESCHEDULE` emails + `event.updated` broadcast. |
| **10** | Frontend core | API layer (TanStack Query hooks), event list/detail, register, ticket, check-in pages. |
| **11** | Frontend realtime | Socket.IO client, `useEventRoom`, live dashboard, multi-tab verification. |
| **12** | Tests & polish | Concurrency test for req. 4 (parallel last-spot registrations), idempotency tests, README, cleanup. |

**Suggested ordering rationale:** backend correctness first (phases 1–6), then the realtime layer that observes it (7–9), then the UI that consumes both (10–11), then hardening (12). The concurrency-critical work (phases 3–4) lands early so everything downstream builds on a correct core.

---

## Open Items / Decisions to Confirm
- **Stack migration:** the current scaffolds are Express (backend) and plain-JS React (frontend). Phase 0 must re-scaffold/convert to NestJS+TS and add TanStack Query + Socket.IO client, per the planned stack.
- **Auth:** none specified — organizer vs participant is by convention/route, not authenticated. Assume trusted/demo context for the assignment.
- **Port:** backend default was moved to `5050` (macOS AirPlay occupies `5000`).
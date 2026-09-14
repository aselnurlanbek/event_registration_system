# Development Log

Chronological record of decisions and progress. Newest entries at the top.

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
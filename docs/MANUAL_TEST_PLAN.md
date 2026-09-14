# Manual Test Plan

Manual demonstration checklist for the Event Registration System. Check each box
as you verify it. Automated coverage exists too (`cd backend && npm test`,
104 tests) — this plan is for the live demo.

## 0. Setup

- [ ] PostgreSQL running and `backend/.env` has a valid `DATABASE_URL`
- [ ] `cd backend && npx prisma migrate dev` applied (schema present)
- [ ] Backend running: `cd backend && npm run start:dev` → `http://localhost:5050`
- [ ] Frontend running: `cd frontend && npm run dev` → `http://localhost:5173`
- [ ] `backend/.env` has a `JWT_SECRET`
- [ ] `NODE_ENV` is **not** `production` (so `/dev/*` demo endpoints are available)

**Handy dev/demo endpoints** (disabled in production):
- Mock email outbox: `GET http://localhost:5050/api/dev/emails`
- Ticket codes for an event: `GET http://localhost:5050/api/dev/events/:eventId/tickets`
- Run reminder job now: `POST http://localhost:5050/api/dev/reminders/run`

---

## 1. Participant flow

- [ ] **Create account** — go to `/register`, choose **Participant**, submit → redirected to `/participant`
- [ ] **Login** — log out, then log in at `/login` → redirected to `/participant`
- [ ] **Browse events** — `/participant` lists upcoming events
- [ ] **Open event** — click an event → `/participant/events/:id` shows title, description, date/time, capacity
- [ ] **Register** — click **Register**
- [ ] **See resulting state** — a clear **REGISTERED** (or **WAITLISTED**) status is shown
- [ ] **View own registrations** — `/participant/registrations` lists the registration with its status
- [ ] **View ticket** — when REGISTERED, a ticket card shows the **ticket code** (copyable) and check-in status
- [ ] **Cancel registration** — click **Cancel**, confirm in the dialog → status reflects the change

---

## 2. Organizer flow

- [ ] **Create account / login** — register at `/register` choosing **Organizer** (or log in) → `/organizer`
- [ ] **Create event** — **Create Event** → fill title/description/date/time/capacity → redirected to the event dashboard with a success banner
- [ ] **Edit event** — from the dashboard, **Edit event**, change a field, save → returns with confirmation
- [ ] **View registrations** — the event dashboard shows the registered participants table (email, registration time, ticket code, checked-in status)
- [ ] **View waitlist** — the waitlist table shows email, order, join time
- [ ] **See live statistics** — Registered / Waitlisted / Checked in / Remaining cards
- [ ] **Check in a participant** — **Open check-in**, enter a valid ticket code → "Participant checked in successfully."
  - [ ] Re-entering the same code → "Ticket already used."
  - [ ] An invalid code → "Invalid ticket code."
- [ ] **Cancel/delete event** — **Cancel event**, confirm the dialog → event flagged CANCELLED, returns to `/organizer` with confirmation
- [ ] **Ownership** — a *second* organizer account cannot see or edit this event (it does not appear in their `/organizer` list; direct URL access is blocked)

---

## 3. Waitlist flow (capacity = 1)

- [ ] Organizer creates an event with **capacity = 1**
- [ ] **Participant A** registers → **REGISTERED**
- [ ] **Participant B** registers → **WAITLISTED**
- [ ] **Participant A cancels**
- [ ] **Participant B** becomes **REGISTERED automatically** (refresh `/participant/registrations`)
- [ ] **Participant B** now has a **ticket code**
- [ ] Organizer can **check in Participant B** with that ticket code

---

## 4. Concurrency flow (capacity = 1, two simultaneous registrations)

Doing two *truly* simultaneous clicks by hand is unreliable, so use the script
below (or trust the automated proof in
`backend/src/registrations/registrations.integration.spec.ts`).

- [ ] Create an event with **capacity = 1** (note its id)
- [ ] Register two different participants **concurrently**
- [ ] Verify the final state is **exactly 1 REGISTERED + 1 WAITLISTED** (never 2 registered)

Optional script (two participant accounts must exist; substitute tokens/eventId):

```bash
API=http://127.0.0.1:5050/api
# TA / TB = participant JWTs (from POST /api/auth/login), EV = capacity-1 event id
curl -s -H "Authorization: Bearer $TA" -X POST $API/events/$EV/registrations &
curl -s -H "Authorization: Bearer $TB" -X POST $API/events/$EV/registrations &
wait
# then check counts (organizer token TO):
curl -s -H "Authorization: Bearer $TO" $API/events/$EV/stats
# expect: registered 1, waitlisted 1
```

- [ ] Confirmed exactly one REGISTERED and one WAITLISTED

---

## 5. Multi-client (live update) flow

- [ ] Open the organizer event dashboard (`/organizer/events/:id`) in **two browser tabs**
- [ ] In a third tab / another browser, **register** a participant for that event
- [ ] **Both** organizer tabs update the counts **without refresh**
- [ ] **Cancel** the registration elsewhere → both tabs update
- [ ] **Check in** a participant elsewhere → both tabs' Checked-in count updates
- [ ] (Reconnect) Stop and restart the backend while a dashboard tab is open; when it reconnects, the tab re-fetches current stats over REST

---

## 6. Restart (persistence) flow

- [ ] Note current events/registrations (e.g. organizer dashboard counts)
- [ ] **Stop** the backend (Ctrl-C)
- [ ] **Restart** the backend (`npm run start:dev`)
- [ ] Reload the app → **all previously created data still exists** (events, registrations, tickets, check-ins)
- [ ] Reminders already sent are **not** re-sent (state is in PostgreSQL) — see Email flow

---

## 7. Email (mock) flow

All "emails" are recorded to the outbox; inspect via `GET /api/dev/emails`.

- [ ] **Registration ticket** — after a participant registers (REGISTERED), a `REGISTRATION_TICKET` email appears
- [ ] **Waitlist promotion** — after a cancel promotes a waitlisted participant, a `WAITLIST_PROMOTED` email appears
- [ ] **Event reminder** — create an event starting within the next 24h with a REGISTERED participant, then `POST /api/dev/reminders/run` → an `EVENT_REMINDER` email appears; run it again → **no duplicate**
- [ ] **Event reschedule** — as the organizer, edit an event's date/time while it has a REGISTERED participant → an `EVENT_RESCHEDULED` email appears
- [ ] **Event cancelled** (bonus) — cancelling an event with participants records `EVENT_CANCELLED` emails

---

## 8. Authorization spot-checks (optional, see docs/AUTHORIZATION.md)

- [ ] A participant hitting an organizer-only URL/endpoint is blocked (403)
- [ ] An organizer cannot access another organizer's event data (403)
- [ ] Unauthenticated requests to protected endpoints return 401
# Event Registration System

Client–server app where an organizer creates capacity-limited events and participants register by email, with waitlisting, tickets, check-in, and a live organizer dashboard.

- **Backend:** NestJS + TypeScript + Prisma + PostgreSQL, realtime via Socket.IO
- **Frontend:** React + TypeScript + Vite + TanStack Query + Socket.IO client
- **Design:** see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md); progress in [`docs/DEVELOPMENT_LOG.md`](docs/DEVELOPMENT_LOG.md)

## Getting started (backend)

```bash
cd backend
cp .env.example .env          # set DATABASE_URL (local Postgres or docker-compose)
npm install
npx prisma migrate dev        # create schema
npm run start:dev             # http://localhost:5050  (API under /api)
npm test                      # unit + integration (needs a running Postgres)
```

A `docker-compose.yml` at the repo root provides a Postgres 16 instance as an alternative to a local install.

## Getting started (frontend)

```bash
cd frontend
cp .env.example .env          # set VITE_API_URL / VITE_SOCKET_URL (defaults point at :5050)
npm install
npm run dev                   # http://localhost:5173
npm run build                 # type-check (tsc -b) + production build
npm run lint                  # oxlint
```

The backend URL is read from the `VITE_API_URL` environment variable (REST) and `VITE_SOCKET_URL` (Socket.IO). Routes:

| Path | Page |
|---|---|
| `/` | Event list |
| `/events/:eventId` | Event detail (registration UI later) |
| `/organizer/events/:eventId` | Organizer dashboard (live stats later) |
| `/check-in/:eventId` | Check-in screen (ticket form later) |

## REST API (base path `/api`)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/events` | Create an event (`title`, `description?`, `startsAt` ISO-8601, `capacity`) |
| `GET` | `/events` | List events |
| `GET` | `/events/:eventId` | Event detail |
| `PATCH` | `/events/:eventId` | Update event (date/time change flagged for reschedule notification) |
| `POST` | `/events/:eventId/registrations` | Register by email (idempotent; REGISTERED or WAITLISTED) |
| `GET` | `/events/:eventId/registrations` | Registered + waitlisted lists with counts |
| `POST` | `/events/:eventId/registrations/cancel` | Cancel by email; auto-promotes the first waitlisted participant |
| `POST` | `/events/:eventId/check-in` | Check in a ticket (`ticketCode`) — single-use; 200 / 409 / 404 |
| `GET` | `/events/:eventId/stats` | `{ capacity, registered, waitlisted, checkedIn }` |
| `GET` | `/dev/emails` | **Development-only** — inspect the mock email outbox (404 in production) |
| `POST` | `/dev/reminders/run` | **Development-only** — manually trigger the reminder job (404 in production) |

## Event reminders (background job)

A cron job runs **every minute** (`@nestjs/schedule`) and sends each **currently REGISTERED** participant exactly **one** `EVENT_REMINDER`.

- **Reminder window:** an event is "due" when its `startsAt` is within the next **24 hours** (`now < startsAt <= now + 24h`). Once an event enters the window, the next tick records reminders; a participant who registers later but still inside the window also gets their one reminder.
- **Exactly-once / restart-safe:** the "already sent" state is **persisted in PostgreSQL** as `EmailLog` rows keyed by the unique `event-reminder:{eventId}:{registrationId}`. Re-runs, overlapping ticks, and backend restarts all skip already-recorded reminders — no in-memory flags involved. WAITLISTED and CANCELLED registrations are never reminded.
- **Manual trigger (dev/demo):** `POST /api/dev/reminders/run` runs the job immediately and returns `{ eventsInWindow, remindersSent }` (disabled in production).

## WebSocket API (Socket.IO)

The Socket.IO server is attached to the same origin/port as the REST API (default `http://localhost:5050`). It powers the **live organizer dashboard** — stat counts update without a page refresh and across multiple open tabs.

### Rooms

Clients subscribe **per event** using the room convention:

```
event:{eventId}
```

A broadcast for one event is only delivered to clients subscribed to that event.

### Client → Server messages

| Message | Payload | Ack response | Description |
|---|---|---|---|
| `subscribe` | `{ "eventId": "..." }` | `{ "status": "subscribed", "eventId": "..." }` | Join the event's room to receive its stats updates |
| `unsubscribe` | `{ "eventId": "..." }` | `{ "status": "unsubscribed", "eventId": "..." }` | Leave the event's room |

### Server → Client events

| Event | Payload | Emitted after |
|---|---|---|
| `event.stats.updated` | see below | successful registration, waitlist registration, cancellation, waitlist promotion, and successful check-in |

**`event.stats.updated` payload:**

```json
{
  "eventId": "clx...",
  "capacity": 100,
  "registered": 73,
  "waitlisted": 5,
  "checkedIn": 42
}
```

Only aggregate counts are sent — **no participant personal data** is ever transmitted over the WebSocket.

### Client usage example

```ts
import { io } from 'socket.io-client';

const socket = io('http://localhost:5050');

socket.emit('subscribe', { eventId }, (ack) => {
  // ack === { status: 'subscribed', eventId }
});

socket.on('event.stats.updated', (stats) => {
  // update the dashboard UI with stats
});

// later
socket.emit('unsubscribe', { eventId });
```

### Reconnect handling

Broadcasts are fire-and-forget; a client that was disconnected during an update will not receive the missed event. To stay correct across reconnects, the frontend should **re-fetch the current stats over REST** (`GET /api/events/:eventId/stats`) on (re)connect, then apply subsequent `event.stats.updated` events as live deltas. The REST snapshot is always authoritative; the WebSocket is a notification layer only.
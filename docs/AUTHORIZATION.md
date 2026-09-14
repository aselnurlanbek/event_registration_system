# Authorization & Role Security

How access control is enforced in the backend, the full role matrix, and the
results of the authorization security review.

## Roles

- **PARTICIPANT** — registers for events, manages their own registrations/tickets.
- **ORGANIZER** — creates and manages their **own** events and runs check-in.

Roles live on the `User` record and are carried in the JWT (`{ sub, email, role }`).

## Enforcement mechanism (defense is server-side, never the frontend)

Every protected route composes three guards, in order:

1. **`JwtAuthGuard`** (`passport-jwt`) — requires a valid bearer token, else **401**. Populates `req.user = { userId, email, role }` from the token.
2. **`RolesGuard`** + `@Roles(...)` — requires the user's role to match, else **403**.
3. **`EventOwnerGuard`** — for event-scoped organizer routes: loads the event by the URL id (`:eventId`/`:id`); **404** if it doesn't exist, **403** if `event.organizerId !== req.user.userId`.

Two structural properties matter for the attack scenarios:

- **Identity always comes from the JWT, never the request body/params.** Registration and cancellation derive email + userId from the token; there is **no client-supplied `registrationId` route anywhere**. So "act on another user's registration by passing their id/email" is impossible by construction — a body `email` is ignored.
- **Ownership is checked against the token user**, so changing an id in the URL to another organizer's event yields 403 (or 404 for unknown ids).

## Route authorization matrix

| Method & path | Auth | Role | Ownership | Notes |
|---|---|---|---|---|
| `POST /api/auth/register` | public | — | — | account creation |
| `POST /api/auth/login` | public | — | — | |
| `GET /api/auth/me` | JWT | any | — | own token identity |
| `GET /api/events` | public | — | — | browse ACTIVE events |
| `GET /api/events/:id` | public | — | — | event detail (non-sensitive fields) |
| `POST /api/events` | JWT | ORGANIZER | — | event stamped with creator as owner |
| `PATCH /api/events/:id` | JWT | ORGANIZER | **owner** | |
| `DELETE /api/events/:id` | JWT | ORGANIZER | **owner** | soft-cancel |
| `GET /api/organizer/events` | JWT | ORGANIZER | — | scoped to caller's own events |
| `POST /api/events/:eventId/registrations` | JWT | PARTICIPANT | — | self-register (JWT identity) |
| `POST /api/events/:eventId/registrations/cancel` | JWT | PARTICIPANT | self | cancels caller's own only |
| `GET /api/events/:eventId/registrations` | JWT | ORGANIZER | **owner** | private participant list |
| `GET /api/me/registrations` | JWT | PARTICIPANT | self | scoped to caller |
| `GET /api/events/:eventId/stats` | JWT | ORGANIZER | **owner** | |
| `POST /api/events/:eventId/check-in` | JWT | ORGANIZER | **owner** | |
| `GET /api/health`, `GET /api/` | public | — | — | liveness |
| `GET /api/dev/emails` | dev-only | — | — | see dev-endpoint note |
| `POST /api/dev/reminders/run` | dev-only | — | — | see dev-endpoint note |
| `GET /api/dev/events/:eventId/tickets` | dev-only | — | — | see dev-endpoint note |

## Reviewed requirements — all verified by automated tests

**PARTICIPANT can:** view available events; register themselves; view their own registrations; view their own ticket; cancel their own registration. ✅

**PARTICIPANT cannot:** create / edit / delete events; view an event's private participant list; check in tickets; modify another participant's registration. ✅ (all → 401/403)

**ORGANIZER can:** create events; edit / cancel own events; view registrations & stats for own events; check in for own events. ✅

**ORGANIZER cannot:** modify another organizer's event; access another organizer's private event data (registrations, stats, check-in). ✅ (all → 403)

**Attack scenarios tested directly over HTTP (not via the UI):**
1. **Direct API requests** — every assertion is a raw `supertest` HTTP call.
2. **Changing IDs in URLs** — foreign/unknown `eventId` → 403 / 404.
3. **Another user's registration ID** — not accepted anywhere; a participant cancelling with a body `email` targeting someone else only ever affects their own row (verified the victim row is unchanged).
4. **Another organizer's event ID** — edit/delete/registrations/stats/check-in all → 403.

Tests live in:
- `src/auth/authorization.matrix.integration.spec.ts` — the full matrix + attack scenarios (23 cases).
- `src/auth/auth.integration.spec.ts` — auth flows + organizer-only guard.
- `src/events/event-ownership.integration.spec.ts` — ownership across organizers.
- `src/registrations/registration-auth.integration.spec.ts` — participant identity & self-only actions.

## Findings

### F1 — Dev endpoints have no authentication (mitigated: production-gated) — LOW
`GET /api/dev/emails`, `POST /api/dev/reminders/run`, and `GET /api/dev/events/:eventId/tickets` perform **no auth/role/ownership checks**; they expose email payloads, trigger the reminder job, and reveal ticket codes. They are **disabled (404) when `NODE_ENV=production`**, so they are not a production exposure *provided the deployment sets `NODE_ENV=production`*.

- **Impact:** in a non-production environment anyone can read ticket codes / email logs. Ticket codes alone cannot be used to check people in (check-in is organizer-owner-only).
- **Operational requirement:** production **must** run with `NODE_ENV=production`. Because the gate is opt-out (open unless prod), a misconfigured deployment would expose these — consider making it opt-in (enabled only when `NODE_ENV=development`/`test`) or placing the dev routes behind an admin guard in a future hardening pass.

### No other issues found
The role + ownership matrix for all business routes is correctly and consistently enforced server-side. Notably, the concurrency-critical registration/cancel paths take identity from the JWT and never trust client-supplied ids, closing the "act as another user" class of bug by construction.

## Assumptions
- No email verification / password policy beyond min length (assignment scope).
- ORGANIZER self-registration is allowed for the demo (would be admin/invite-only in production — see DEVELOPMENT_LOG Phase A1–A2).
- Organizers cannot self-register as participants for an event (participant routes require the PARTICIPANT role); this is intentional.
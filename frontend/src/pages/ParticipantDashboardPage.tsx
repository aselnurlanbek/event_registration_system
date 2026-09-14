import { Link } from 'react-router-dom';
import { useEvents } from '../api/events';
import { useMyRegistrations, type MyRegistration } from '../api/me';
import { useCancelRegistration } from '../api/registrations';
import { useAuth } from '../auth/context';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import TicketCard from '../components/TicketCard';
import type { RegistrationStatus } from '../types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function preview(text: string | null): string {
  if (!text) return '';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

function StatusBadge({ status }: { status: RegistrationStatus }) {
  const cls =
    status === 'REGISTERED'
      ? 'badge badge--ok'
      : status === 'WAITLISTED'
        ? 'badge badge--warn'
        : 'badge badge--muted';
  return <span className={cls}>{status}</span>;
}

function MyRegistrationCard({
  reg,
  email,
}: {
  reg: MyRegistration;
  email: string;
}) {
  const cancel = useCancelRegistration(reg.event.id);
  const canCancel =
    (reg.status === 'REGISTERED' || reg.status === 'WAITLISTED') &&
    reg.event.status === 'ACTIVE';
  const showTicket = reg.status === 'REGISTERED' && !!reg.ticketCode;

  return (
    <li className="card">
      <div className="card__body">
        <h3 className="card__title">
          <Link to={`/participant/events/${reg.event.id}`}>
            {reg.event.title}
          </Link>
        </h3>
        <p className="muted">{formatDate(reg.event.startsAt)}</p>

        {showTicket ? (
          <TicketCard
            eventTitle={reg.event.title}
            startsAt={reg.event.startsAt}
            email={email}
            ticketCode={reg.ticketCode as string}
            checkedInAt={reg.checkedInAt}
            eventCancelled={reg.event.status === 'CANCELLED'}
          />
        ) : (
          <p>
            <StatusBadge status={reg.status} />
            {reg.status === 'WAITLISTED' && reg.waitlistPos != null && (
              <span className="muted"> · position {reg.waitlistPos}</span>
            )}
            {reg.event.status === 'CANCELLED' && (
              <span className="badge badge--muted"> EVENT CANCELLED</span>
            )}
          </p>
        )}

        {cancel.isError && (
          <p className="field-error">{(cancel.error as Error).message}</p>
        )}
      </div>
      {canCancel && (
        <div className="card__actions">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate()}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel'}
          </button>
        </div>
      )}
    </li>
  );
}

export default function ParticipantDashboardPage() {
  const { user } = useAuth();
  const events = useEvents();
  const mine = useMyRegistrations();

  // Map eventId → the participant's active registration (if any).
  const activeByEvent = new Map<string, MyRegistration>();
  (mine.data ?? []).forEach((r) => {
    if (r.status === 'REGISTERED' || r.status === 'WAITLISTED') {
      activeByEvent.set(r.event.id, r);
    }
  });

  return (
    <section>
      <h1>Welcome{user ? `, ${user.email}` : ''}</h1>

      <h2 className="section-title">Upcoming events</h2>
      {events.isLoading ? (
        <Loading message="Loading events…" />
      ) : events.isError ? (
        <ErrorMessage error={events.error} onRetry={() => events.refetch()} />
      ) : !events.data || events.data.length === 0 ? (
        <p className="muted">No upcoming events.</p>
      ) : (
        <ul className="card-list">
          {events.data.map((event) => {
            const active = activeByEvent.get(event.id);
            return (
              <li key={event.id} className="card">
                <div className="card__body">
                  <h3 className="card__title">
                    <Link to={`/participant/events/${event.id}`}>
                      {event.title}
                    </Link>
                  </h3>
                  <p className="muted">{formatDate(event.startsAt)}</p>
                  {event.description && <p>{preview(event.description)}</p>}
                  <p className="muted">Capacity: {event.capacity}</p>
                  {active && <StatusBadge status={active.status} />}
                </div>
                <div className="card__actions">
                  <Link
                    className="btn btn--sm"
                    to={`/participant/events/${event.id}`}
                  >
                    View
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <h2 className="section-title">My registrations</h2>
      {mine.isLoading ? (
        <Loading message="Loading your registrations…" />
      ) : mine.isError ? (
        <ErrorMessage error={mine.error} onRetry={() => mine.refetch()} />
      ) : !mine.data || mine.data.length === 0 ? (
        <p className="muted">You haven’t registered for any events yet.</p>
      ) : (
        <ul className="card-list">
          {mine.data.map((reg) => (
            <MyRegistrationCard key={reg.id} reg={reg} email={user?.email ?? ''} />
          ))}
        </ul>
      )}
    </section>
  );
}
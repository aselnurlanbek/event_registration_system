import { Link } from 'react-router-dom';
import { useEvents } from '../api/events';
import { useMyRegistrations, type MyRegistration } from '../api/me';
import EmptyState from '../components/EmptyState';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import StatusBadge from '../components/StatusBadge';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function preview(text: string | null): string {
  if (!text) return '';
  return text.length > 120 ? `${text.slice(0, 120)}…` : text;
}

export default function ParticipantEventsPage() {
  const events = useEvents();
  const mine = useMyRegistrations();

  // Map eventId → the participant's active registration (if any).
  const activeByEvent = new Map<string, MyRegistration>();
  (mine.data ?? []).forEach((r) => {
    if (r.status === 'REGISTERED' || r.status === 'WAITLISTED') {
      activeByEvent.set(r.event.id, r);
    }
  });

  if (events.isLoading) return <Loading message="Loading events…" />;
  if (events.isError) {
    return <ErrorMessage error={events.error} onRetry={() => events.refetch()} />;
  }

  return (
    <section>
      <h1>Events</h1>
      {!events.data || events.data.length === 0 ? (
        <EmptyState
          title="No upcoming events"
          hint="Check back soon — new events will appear here."
        />
      ) : (
        <ul className="card-list">
          {events.data.map((event) => {
            const active = activeByEvent.get(event.id);
            return (
              <li key={event.id} className="card">
                <div className="card__body">
                  <h2 className="card__title">
                    <Link to={`/participant/events/${event.id}`}>
                      {event.title}
                    </Link>
                  </h2>
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
    </section>
  );
}
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEventStats } from '../api/dashboard';
import { useCancelEvent, useMyEvents } from '../api/organizer';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import type { EventDto } from '../types';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function OrganizerEventCard({ event }: { event: EventDto }) {
  const stats = useEventStats(event.id);
  const cancel = useCancelEvent();
  const navigate = useNavigate();
  const isActive = event.status === 'ACTIVE';

  function handleCancel() {
    if (
      window.confirm(
        `Cancel "${event.title}"? Registered participants will be notified. This cannot be undone.`,
      )
    ) {
      cancel.mutate(event.id);
    }
  }

  return (
    <li className="card">
      <div className="card__body">
        <h3 className="card__title">
          {event.title}{' '}
          <span
            className={`badge ${isActive ? 'badge--ok' : 'badge--muted'}`}
          >
            {event.status}
          </span>
        </h3>
        <p className="muted">{formatDate(event.startsAt)}</p>
        <p className="event-stats">
          {stats.isLoading ? (
            <span className="muted">Loading counts…</span>
          ) : stats.data ? (
            <>
              <span>Capacity {stats.data.capacity}</span>
              <span>· Registered {stats.data.registered}</span>
              <span>· Waitlisted {stats.data.waitlisted}</span>
              <span>· Checked-in {stats.data.checkedIn}</span>
            </>
          ) : (
            <span className="muted">Counts unavailable</span>
          )}
        </p>
        {cancel.isError && (
          <p className="field-error">{(cancel.error as Error).message}</p>
        )}
      </div>
      <div className="card__actions">
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => navigate(`/organizer/events/${event.id}`)}
        >
          View
        </button>
        {isActive && (
          <>
            <Link
              className="btn btn--sm btn--ghost"
              to={`/organizer/events/${event.id}/edit`}
            >
              Edit
            </Link>
            <button
              type="button"
              className="btn btn--sm btn--ghost"
              disabled={cancel.isPending}
              onClick={handleCancel}
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel'}
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export default function OrganizerEventsPage() {
  const events = useMyEvents();
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash;

  return (
    <section>
      <div className="page-head">
        <h1>My events</h1>
        <Link className="btn" to="/organizer/events/new">
          Create Event
        </Link>
      </div>

      {flash && (
        <div className="notice notice--success" role="status">
          <p className="notice__title">{flash}</p>
        </div>
      )}

      {events.isLoading ? (
        <Loading message="Loading your events…" />
      ) : events.isError ? (
        <ErrorMessage error={events.error} onRetry={() => events.refetch()} />
      ) : !events.data || events.data.length === 0 ? (
        <div className="placeholder">
          No events yet. Create your first event.
        </div>
      ) : (
        <ul className="card-list">
          {events.data.map((event) => (
            <OrganizerEventCard key={event.id} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}
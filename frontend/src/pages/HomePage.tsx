import { Link } from 'react-router-dom';
import { useEvents } from '../api/events';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function HomePage() {
  const { data: events, isLoading, isError, error, refetch } = useEvents();

  if (isLoading) return <Loading message="Loading events…" />;
  if (isError) return <ErrorMessage error={error} onRetry={() => refetch()} />;

  return (
    <section>
      <h1>Events</h1>
      {!events || events.length === 0 ? (
        <p className="muted">No events yet.</p>
      ) : (
        <ul className="card-list">
          {events.map((event) => (
            <li key={event.id} className="card">
              <div className="card__body">
                <h2 className="card__title">
                  <Link to={`/events/${event.id}`}>{event.title}</Link>
                </h2>
                <p className="muted">{formatDate(event.startsAt)}</p>
                {event.description && <p>{event.description}</p>}
              </div>
              <div className="card__actions">
                <Link className="btn btn--sm" to={`/events/${event.id}`}>
                  Details
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
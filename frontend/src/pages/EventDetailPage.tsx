import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/events';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

export default function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { data: event, isLoading, isError, error, refetch } = useEvent(eventId);

  if (isLoading) return <Loading message="Loading event…" />;
  if (isError) return <ErrorMessage error={error} onRetry={() => refetch()} />;
  if (!event) return <ErrorMessage error="Event not found." />;

  return (
    <article>
      <p>
        <Link to="/" className="muted">
          ← All events
        </Link>
      </p>
      <h1>{event.title}</h1>
      <p className="muted">{new Date(event.startsAt).toLocaleString()}</p>
      {event.description && <p>{event.description}</p>}
      <p className="muted">Capacity: {event.capacity}</p>

      {/* Registration / waitlist / ticket UI is implemented in a later phase. */}
      <div className="placeholder">Registration form coming soon.</div>
    </article>
  );
}
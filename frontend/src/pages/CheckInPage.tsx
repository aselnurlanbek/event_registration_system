import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/events';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

export default function CheckInPage() {
  const { eventId = '' } = useParams();
  const { data: event, isLoading, isError, error, refetch } = useEvent(eventId);

  if (isLoading) return <Loading message="Loading check-in…" />;
  if (isError) return <ErrorMessage error={error} onRetry={() => refetch()} />;
  if (!event) return <ErrorMessage error="Event not found." />;

  return (
    <section>
      <p>
        <Link to={`/events/${eventId}`} className="muted">
          ← Event
        </Link>
      </p>
      <h1>Check-in</h1>
      <p className="muted">{event.title}</p>

      {/* Ticket-code check-in form is implemented in a later phase. */}
      <div className="placeholder">Ticket check-in coming soon.</div>
    </section>
  );
}
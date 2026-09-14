import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/events';
import { useAuth } from '../auth/context';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

// Public, read-only event view. Registering happens in the participant area
// (identity comes from the account), so this page links there / to login.
export default function EventDetailPage() {
  const { eventId = '' } = useParams();
  const { user } = useAuth();
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

      <div className="placeholder">
        {!user ? (
          <>
            <Link to="/login">Log in</Link> as a participant to register.
          </>
        ) : user.role === 'PARTICIPANT' ? (
          <Link to={`/participant/events/${event.id}`}>
            Go to registration →
          </Link>
        ) : (
          'Registration is for participant accounts.'
        )}
      </div>
    </article>
  );
}
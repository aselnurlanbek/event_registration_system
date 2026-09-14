import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/events';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

export default function OrganizerDashboardPage() {
  const { eventId = '' } = useParams();
  const { data: event, isLoading, isError, error, refetch } = useEvent(eventId);

  if (isLoading) return <Loading message="Loading dashboard…" />;
  if (isError) return <ErrorMessage error={error} onRetry={() => refetch()} />;
  if (!event) return <ErrorMessage error="Event not found." />;

  return (
    <section>
      <p>
        <Link to={`/events/${eventId}`} className="muted">
          ← Event
        </Link>
      </p>
      <h1>Organizer dashboard</h1>
      <p className="muted">{event.title}</p>

      {/* Live stats (registered / waitlisted / checked-in) via Socket.IO are
          wired in a later phase using the realtime infrastructure. */}
      <div className="placeholder">Live statistics coming soon.</div>
    </section>
  );
}
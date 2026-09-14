import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEvent } from '../api/events';
import { useUpdateEvent, type EventInput } from '../api/organizer';
import EventForm from '../components/EventForm';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

export default function OrganizerEditEventPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const event = useEvent(eventId);
  const update = useUpdateEvent(eventId);

  if (event.isLoading) return <Loading message="Loading event…" />;
  if (event.isError) {
    return <ErrorMessage error={event.error} onRetry={() => event.refetch()} />;
  }
  if (!event.data) return <ErrorMessage error="Event not found." />;

  function handleSubmit(values: EventInput) {
    update.mutate(values, {
      onSuccess: () =>
        navigate(`/organizer/events/${eventId}`, { replace: true }),
    });
  }

  return (
    <section>
      <p>
        <Link to={`/organizer/events/${eventId}`} className="muted">
          ← Event
        </Link>
      </p>
      <h1>Edit event</h1>
      <EventForm
        initial={{
          title: event.data.title,
          description: event.data.description ?? '',
          startsAt: event.data.startsAt,
          capacity: event.data.capacity,
        }}
        submitLabel="Save changes"
        submitting={update.isPending}
        error={update.error}
        onSubmit={handleSubmit}
      />
    </section>
  );
}
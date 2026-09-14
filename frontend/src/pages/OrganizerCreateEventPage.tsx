import { Link, useNavigate } from 'react-router-dom';
import { useCreateEvent, type EventInput } from '../api/organizer';
import EventForm from '../components/EventForm';

export default function OrganizerCreateEventPage() {
  const navigate = useNavigate();
  const create = useCreateEvent();

  function handleSubmit(values: EventInput) {
    create.mutate(values, {
      onSuccess: (event) =>
        navigate(`/organizer/events/${event.id}`, {
          replace: true,
          state: { flash: 'Event created successfully.' },
        }),
    });
  }

  return (
    <section>
      <p>
        <Link to="/organizer" className="muted">
          ← My events
        </Link>
      </p>
      <h1>Create event</h1>
      <EventForm
        submitLabel="Create event"
        submitting={create.isPending}
        error={create.error}
        onSubmit={handleSubmit}
      />
    </section>
  );
}
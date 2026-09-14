import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEvent } from '../api/events';
import {
  useCancelEvent,
  useUpdateEvent,
  type EventInput,
} from '../api/organizer';
import EventForm from '../components/EventForm';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

export default function OrganizerEditEventPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const event = useEvent(eventId);
  const update = useUpdateEvent(eventId);
  const cancel = useCancelEvent();

  if (event.isLoading) return <Loading message="Loading event…" />;
  if (event.isError) {
    return <ErrorMessage error={event.error} onRetry={() => event.refetch()} />;
  }
  if (!event.data) return <ErrorMessage error="Event not found." />;

  const ev = event.data;
  const isActive = ev.status === 'ACTIVE';

  function handleSubmit(values: EventInput) {
    // Sending startsAt lets the backend detect a reschedule and notify
    // registered participants (EVENT_RESCHEDULED) — the source of truth.
    update.mutate(values, {
      onSuccess: () =>
        navigate(`/organizer/events/${eventId}`, {
          replace: true,
          state: { flash: 'Event updated successfully.' },
        }),
    });
  }

  function handleCancelEvent() {
    const confirmed = window.confirm(
      `Cancel "${ev.title}"?\n\nAll registered and waitlisted participants will be ` +
        `notified by email and lose their spots. The event stays visible in history ` +
        `but can no longer accept registrations or check-ins. This cannot be undone.`,
    );
    if (!confirmed) return;
    cancel.mutate(eventId, {
      onSuccess: () =>
        navigate('/organizer', {
          replace: true,
          state: { flash: 'Event cancelled. Participants were notified.' },
        }),
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

      {!isActive && (
        <div className="notice notice--warning" role="status">
          <p className="notice__title">This event is cancelled.</p>
        </div>
      )}

      <EventForm
        initial={{
          title: ev.title,
          description: ev.description ?? '',
          startsAt: ev.startsAt,
          capacity: ev.capacity,
        }}
        submitLabel="Save changes"
        submitting={update.isPending}
        error={update.error}
        onSubmit={handleSubmit}
      />

      {isActive && (
        <div className="danger-zone">
          <h2 className="section-title">Danger zone</h2>
          <p className="muted">
            Cancelling notifies all registered and waitlisted participants and
            frees their spots.
          </p>
          <button
            type="button"
            className="btn btn--danger"
            disabled={cancel.isPending}
            onClick={handleCancelEvent}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel event'}
          </button>
          {cancel.isError && (
            <p className="field-error">{(cancel.error as Error).message}</p>
          )}
        </div>
      )}
    </section>
  );
}
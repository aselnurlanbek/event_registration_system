import { Link, useParams } from 'react-router-dom';
import { useEvent } from '../api/events';
import { useMyRegistrations } from '../api/me';
import { useCancelRegistration, useRegister } from '../api/registrations';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

export default function ParticipantEventDetailPage() {
  const { eventId = '' } = useParams();
  const event = useEvent(eventId);
  const mine = useMyRegistrations();
  const register = useRegister(eventId);
  const cancel = useCancelRegistration(eventId);

  if (event.isLoading || mine.isLoading) {
    return <Loading message="Loading event…" />;
  }
  if (event.isError) {
    return <ErrorMessage error={event.error} onRetry={() => event.refetch()} />;
  }
  if (!event.data) return <ErrorMessage error="Event not found." />;

  const ev = event.data;
  const myReg = (mine.data ?? []).find((r) => r.event.id === eventId) ?? null;
  const active =
    myReg &&
    (myReg.status === 'REGISTERED' || myReg.status === 'WAITLISTED')
      ? myReg
      : null;
  const eventCancelled = ev.status === 'CANCELLED';

  return (
    <article>
      <p>
        <Link to="/participant" className="muted">
          ← Dashboard
        </Link>
      </p>
      <h1>{ev.title}</h1>
      <p className="muted">{formatDate(ev.startsAt)}</p>
      {ev.description && <p>{ev.description}</p>}
      <p className="muted">Capacity: {ev.capacity}</p>

      {eventCancelled && (
        <div className="notice notice--warning" role="status">
          <p className="notice__title">This event has been cancelled.</p>
        </div>
      )}

      <hr className="divider" />

      {/* Current registration state — backend is the source of truth. */}
      {active ? (
        <div className="register__result">
          {active.status === 'REGISTERED' ? (
            <div className="notice notice--success" role="status">
              <p className="notice__title">You’re registered 🎉</p>
              {active.ticketCode && (
                <p>
                  Ticket: <code className="ticket-code">{active.ticketCode}</code>
                </p>
              )}
              <p className="muted">
                {active.checkedInAt
                  ? `Checked in ${formatDate(active.checkedInAt)}`
                  : 'Not checked in yet'}
              </p>
            </div>
          ) : (
            <div className="notice notice--warning" role="status">
              <p className="notice__title">You’re on the waitlist</p>
              <p>
                If a spot opens up you’ll be promoted automatically
                {active.waitlistPos != null
                  ? ` (position ${active.waitlistPos})`
                  : ''}
                .
              </p>
            </div>
          )}

          <button
            type="button"
            className="btn btn--ghost"
            disabled={cancel.isPending || eventCancelled}
            onClick={() => cancel.mutate()}
            style={{ marginTop: '1rem' }}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel registration'}
          </button>
          {cancel.isError && (
            <p className="field-error">{(cancel.error as Error).message}</p>
          )}
        </div>
      ) : (
        <div>
          <button
            type="button"
            className="btn"
            disabled={register.isPending || eventCancelled}
            onClick={() => register.mutate()}
          >
            {register.isPending ? 'Registering…' : 'Register'}
          </button>
          {register.isError && (
            <p className="field-error">{(register.error as Error).message}</p>
          )}
          {myReg?.status === 'CANCELLED' && (
            <p className="muted" style={{ marginTop: '0.5rem' }}>
              You previously cancelled — you can register again.
            </p>
          )}
        </div>
      )}
    </article>
  );
}
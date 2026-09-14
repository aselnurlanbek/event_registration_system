import { Link } from 'react-router-dom';
import { useMyRegistrations, type MyRegistration } from '../api/me';
import { useCancelRegistration } from '../api/registrations';
import { useAuth } from '../auth/context';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import StatusBadge from '../components/StatusBadge';
import TicketCard from '../components/TicketCard';
import { useState } from 'react';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function MyRegistrationCard({
  reg,
  email,
}: {
  reg: MyRegistration;
  email: string;
}) {
  const cancel = useCancelRegistration(reg.event.id);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const canCancel =
    (reg.status === 'REGISTERED' || reg.status === 'WAITLISTED') &&
    reg.event.status === 'ACTIVE';
  const showTicket = reg.status === 'REGISTERED' && !!reg.ticketCode;

  return (
    <li className="card">
      <div className="card__body">
        <h3 className="card__title">
          <Link to={`/participant/events/${reg.event.id}`}>
            {reg.event.title}
          </Link>
        </h3>
        <p className="muted">{formatDate(reg.event.startsAt)}</p>

        {showTicket ? (
          <TicketCard
            eventTitle={reg.event.title}
            startsAt={reg.event.startsAt}
            email={email}
            ticketCode={reg.ticketCode as string}
            checkedInAt={reg.checkedInAt}
            eventCancelled={reg.event.status === 'CANCELLED'}
          />
        ) : (
          <p>
            <StatusBadge status={reg.status} />
            {reg.status === 'WAITLISTED' && reg.waitlistPos != null && (
              <span className="muted"> · position {reg.waitlistPos}</span>
            )}
            {reg.event.status === 'CANCELLED' && (
              <span className="badge badge--muted"> EVENT CANCELLED</span>
            )}
          </p>
        )}

        {cancel.isError && (
          <p className="field-error">{(cancel.error as Error).message}</p>
        )}
      </div>
      {canCancel && (
        <div className="card__actions">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={cancel.isPending}
            onClick={() => setConfirmOpen(true)}
          >
            Cancel
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Cancel registration?"
        danger
        confirmLabel="Cancel registration"
        cancelLabel="Keep it"
        busy={cancel.isPending}
        message={
          <p>
            Cancel your {reg.status.toLowerCase()} spot for{' '}
            <strong>{reg.event.title}</strong>? If you’re registered, your spot
            may be given to the next person on the waitlist.
          </p>
        }
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() =>
          cancel.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })
        }
      />
    </li>
  );
}

export default function ParticipantRegistrationsPage() {
  const { user } = useAuth();
  const mine = useMyRegistrations();

  if (mine.isLoading) return <Loading message="Loading your registrations…" />;
  if (mine.isError) {
    return <ErrorMessage error={mine.error} onRetry={() => mine.refetch()} />;
  }

  return (
    <section>
      <h1>My registrations</h1>
      {!mine.data || mine.data.length === 0 ? (
        <EmptyState
          title="You haven’t registered for any events yet"
          hint="Browse events and register to see your tickets here."
        >
          <Link className="btn btn--sm" to="/participant">
            Browse events
          </Link>
        </EmptyState>
      ) : (
        <ul className="card-list">
          {mine.data.map((reg) => (
            <MyRegistrationCard
              key={reg.id}
              reg={reg}
              email={user?.email ?? ''}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
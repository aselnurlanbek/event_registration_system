import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useEventStats } from '../api/dashboard';
import { useEvent } from '../api/events';
import { useCancelEvent } from '../api/organizer';
import { useEventRegistrations, type ParticipantDto } from '../api/registrations';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { useEventRealtime } from '../realtime/useEventRealtime';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}

function RegisteredTable({ rows }: { rows: ParticipantDto[] }) {
  if (rows.length === 0) return <p className="muted">No registered participants.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Registered</th>
            <th>Ticket</th>
            <th>Checked in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.email}</td>
              <td>{formatDateTime(r.createdAt)}</td>
              <td>
                {r.ticket ? (
                  <code className="ticket-code">{r.ticket.code}</code>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
              <td>
                {r.checkedInAt ? (
                  <span className="badge badge--ok">
                    {formatDateTime(r.checkedInAt)}
                  </span>
                ) : (
                  <span className="badge">Not checked in</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WaitlistTable({ rows }: { rows: ParticipantDto[] }) {
  if (rows.length === 0) return <p className="muted">Waitlist is empty.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>Email</th>
            <th>Joined waitlist</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td>{r.waitlistPos ?? i + 1}</td>
              <td>{r.email}</td>
              <td>{formatDateTime(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OrganizerDashboardPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();

  // One-time success confirmation passed via router state (create/edit).
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash;

  // Initial data over REST.
  const event = useEvent(eventId);
  const stats = useEventStats(eventId);
  const registrations = useEventRegistrations(eventId);
  const cancel = useCancelEvent();

  // Live updates over Socket.IO (subscribe/reconnect/cleanup handled inside).
  useEventRealtime(eventId);

  function handleCancelEvent() {
    if (!event.data) return;
    const confirmed = window.confirm(
      `Cancel "${event.data.title}"?\n\nAll registered and waitlisted participants ` +
        `will be notified by email and lose their spots. The event stays visible in ` +
        `history but can no longer accept registrations or check-ins. This cannot be undone.`,
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

  if (stats.isLoading || registrations.isLoading) {
    return <Loading message="Loading dashboard…" />;
  }
  if (stats.isError) {
    return <ErrorMessage error={stats.error} onRetry={() => stats.refetch()} />;
  }
  if (registrations.isError) {
    return (
      <ErrorMessage
        error={registrations.error}
        onRetry={() => registrations.refetch()}
      />
    );
  }

  const ev = event.data;
  const s = stats.data;
  const regs = registrations.data;
  const isActive = ev?.status === 'ACTIVE';
  const remaining = s ? Math.max(0, s.capacity - s.registered) : 0;

  return (
    <section>
      <p>
        <Link to="/organizer" className="muted">
          ← My events
        </Link>
      </p>

      <div className="page-head">
        <h1>{ev?.title ?? 'Event'}</h1>
        <div className="card__actions">
          {isActive && (
            <Link
              className="btn btn--sm btn--ghost"
              to={`/organizer/events/${eventId}/edit`}
            >
              Edit event
            </Link>
          )}
          <Link
            className="btn btn--sm"
            to={`/organizer/events/${eventId}/check-in`}
          >
            Open check-in
          </Link>
          {isActive && (
            <button
              type="button"
              className="btn btn--sm btn--danger"
              disabled={cancel.isPending}
              onClick={handleCancelEvent}
            >
              {cancel.isPending ? 'Cancelling…' : 'Cancel event'}
            </button>
          )}
        </div>
      </div>

      {flash && (
        <div className="notice notice--success" role="status">
          <p className="notice__title">{flash}</p>
        </div>
      )}
      {cancel.isError && (
        <p className="field-error">{(cancel.error as Error).message}</p>
      )}

      {/* Event information */}
      {ev && (
        <div className="event-info">
          <p>
            <span
              className={`badge ${isActive ? 'badge--ok' : 'badge--muted'}`}
            >
              {ev.status}
            </span>
          </p>
          <p className="muted">{formatDateTime(ev.startsAt)}</p>
          {ev.description && <p>{ev.description}</p>}
          <p className="muted">Capacity: {ev.capacity}</p>
        </div>
      )}

      {/* Live statistics */}
      {s && (
        <div className="stat-grid">
          <StatCard label="Registered" value={s.registered} />
          <StatCard label="Waitlisted" value={s.waitlisted} />
          <StatCard label="Checked in" value={s.checkedIn} />
          <StatCard label="Remaining" value={remaining} />
        </div>
      )}

      <h2 className="section-title">Registered participants</h2>
      {regs && <RegisteredTable rows={regs.registered} />}

      <h2 className="section-title">Waitlist</h2>
      {regs && <WaitlistTable rows={regs.waitlisted} />}
    </section>
  );
}
import { Link, useParams } from 'react-router-dom';
import { useEventStats } from '../api/dashboard';
import { useEvent } from '../api/events';
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
            <th>Checked in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>{r.email}</td>
              <td>{formatDateTime(r.createdAt)}</td>
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

  // Initial data over REST.
  const event = useEvent(eventId);
  const stats = useEventStats(eventId);
  const registrations = useEventRegistrations(eventId);

  // Live updates over Socket.IO (subscribe/reconnect/cleanup handled inside).
  useEventRealtime(eventId);

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

  const s = stats.data;
  const regs = registrations.data;

  return (
    <section>
      <p>
        <Link to={`/events/${eventId}`} className="muted">
          ← Event
        </Link>
      </p>
      <h1>Organizer dashboard</h1>
      {event.data && <p className="muted">{event.data.title}</p>}

      {s && (
        <div className="stat-grid">
          <StatCard label="Capacity" value={s.capacity} />
          <StatCard label="Registered" value={s.registered} />
          <StatCard label="Waitlisted" value={s.waitlisted} />
          <StatCard label="Checked in" value={s.checkedIn} />
        </div>
      )}

      <h2 className="section-title">Registered participants</h2>
      {regs && <RegisteredTable rows={regs.registered} />}

      <h2 className="section-title">Waitlist</h2>
      {regs && <WaitlistTable rows={regs.waitlisted} />}
    </section>
  );
}
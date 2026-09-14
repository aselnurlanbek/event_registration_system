import { useState } from 'react';

interface TicketCardProps {
  eventTitle: string;
  startsAt: string;
  email: string;
  ticketCode: string;
  checkedInAt: string | null;
  eventCancelled: boolean;
}

type TicketStatus = 'VALID' | 'CHECKED IN' | 'EVENT CANCELLED';

function statusOf(checkedInAt: string | null, cancelled: boolean): TicketStatus {
  if (cancelled) return 'EVENT CANCELLED';
  if (checkedInAt) return 'CHECKED IN';
  return 'VALID';
}

function statusClass(status: TicketStatus): string {
  if (status === 'CHECKED IN') return 'ticket__status ticket__status--in';
  if (status === 'EVENT CANCELLED') return 'ticket__status ticket__status--cancelled';
  return 'ticket__status ticket__status--valid';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

/**
 * Read-only participant ticket. The check-in state is display-only — participants
 * cannot change it (check-in is an organizer-owner action on the backend).
 */
export default function TicketCard({
  eventTitle,
  startsAt,
  email,
  ticketCode,
  checkedInAt,
  eventCancelled,
}: TicketCardProps) {
  const [copied, setCopied] = useState(false);
  const status = statusOf(checkedInAt, eventCancelled);

  function copy() {
    void navigator.clipboard?.writeText(ticketCode).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="ticket">
      <div className="ticket__head">
        <div>
          <p className="ticket__title">{eventTitle}</p>
          <p className="ticket__meta">{formatDate(startsAt)}</p>
          <p className="ticket__meta">{email}</p>
        </div>
        <span className={statusClass(status)}>{status}</span>
      </div>

      <div className="ticket__code-row">
        <code className="ticket__code" aria-label="Ticket code">
          {ticketCode}
        </code>
        <button type="button" className="btn btn--sm" onClick={copy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {checkedInAt && (
        <p className="ticket__checked">✓ Checked in {formatDate(checkedInAt)}</p>
      )}
    </div>
  );
}
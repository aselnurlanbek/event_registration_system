import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCheckIn } from '../api/checkin';
import { ApiError } from '../api/client';
import { useEventStats } from '../api/dashboard';
import { useEvent } from '../api/events';
import { useEventRealtime } from '../realtime/useEventRealtime';

/** Map a failed check-in to a clear, user-facing message. */
function checkInErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'Invalid ticket code.';
    if (error.status === 409) {
      if (/already checked in/i.test(error.message)) {
        return 'This ticket has already been checked in.';
      }
      return error.message; // cancelled / not eligible — show the API message
    }
    return error.message;
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function CheckInPage() {
  const { eventId = '' } = useParams();
  const [code, setCode] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const event = useEvent(eventId);
  const stats = useEventStats(eventId);
  const checkIn = useCheckIn(eventId);

  // Keep the counters synchronized live over Socket.IO.
  useEventRealtime(eventId);

  // Focus the input on mount so the operator can type immediately.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value) return;
    checkIn.mutate(value, {
      onSuccess: () => {
        // Clear + refocus so the next ticket can be entered right away.
        setCode('');
        inputRef.current?.focus();
      },
    });
  }

  const s = stats.data;

  return (
    <section className="checkin">
      <p>
        <Link to={`/events/${eventId}`} className="muted">
          ← Event
        </Link>
      </p>
      <h1>Check-in</h1>
      {event.data && <p className="muted">{event.data.title}</p>}

      <div className="checkin__counters">
        <div className="counter">
          <span className="counter__value">{s ? s.checkedIn : '—'}</span>
          <span className="counter__label">Checked In</span>
        </div>
        <div className="counter">
          <span className="counter__value">{s ? s.registered : '—'}</span>
          <span className="counter__label">Registered</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="checkin__form">
        <label htmlFor="ticketCode" className="checkin__label">
          Ticket code
        </label>
        <input
          id="ticketCode"
          ref={inputRef}
          className="checkin__input"
          value={code}
          placeholder="Enter ticket code"
          autoComplete="off"
          spellCheck={false}
          disabled={checkIn.isPending}
          onChange={(e) => setCode(e.target.value)}
        />
        <button
          type="submit"
          className="btn checkin__submit"
          disabled={checkIn.isPending}
        >
          {checkIn.isPending ? 'Checking in…' : 'Check in'}
        </button>
      </form>

      {checkIn.isSuccess && (
        <div className="notice notice--success checkin__feedback" role="status">
          <p className="notice__title">Participant checked in successfully.</p>
          <p className="muted">{checkIn.data.participant.email}</p>
        </div>
      )}
      {checkIn.isError && (
        <div className="notice notice--error checkin__feedback" role="alert">
          <p className="notice__title">{checkInErrorMessage(checkIn.error)}</p>
        </div>
      )}
    </section>
  );
}
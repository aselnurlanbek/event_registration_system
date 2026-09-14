import { useState, type FormEvent } from 'react';
import type { EventInput } from '../api/organizer';

export interface EventFormInitial {
  title: string;
  description: string;
  startsAt: string; // ISO-8601
  capacity: number;
}

interface EventFormProps {
  initial?: EventFormInitial;
  submitLabel: string;
  submitting: boolean;
  error?: unknown;
  onSubmit: (values: EventInput) => void;
}

// Split an ISO string into local date (YYYY-MM-DD) + time (HH:mm) parts.
function toLocalParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}

export default function EventForm({
  initial,
  submitLabel,
  submitting,
  error,
  onSubmit,
}: EventFormProps) {
  const initialParts = initial ? toLocalParts(initial.startsAt) : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initialParts?.date ?? '');
  const [time, setTime] = useState(initialParts?.time ?? '');
  const [capacity, setCapacity] = useState(
    initial ? String(initial.capacity) : '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setValidationError('Title is required.');
    if (!date) return setValidationError('Date is required.');
    if (!time) return setValidationError('Time is required.');
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      return setValidationError('Capacity must be a whole number of at least 1.');
    }
    // Combine local date + time, then convert to UTC ISO for the backend.
    const combined = new Date(`${date}T${time}`);
    if (Number.isNaN(combined.getTime())) {
      return setValidationError('Please enter a valid date and time.');
    }
    setValidationError(null);
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      startsAt: combined.toISOString(),
      capacity: cap,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="auth-form" style={{ maxWidth: 480 }}>
      <label htmlFor="title">Title</label>
      <input
        id="title"
        className="input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={submitting}
      />

      <label htmlFor="description">Description</label>
      <textarea
        id="description"
        className="input"
        rows={3}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={submitting}
      />

      <label htmlFor="date">Date</label>
      <input
        id="date"
        type="date"
        className="input"
        value={date}
        onChange={(e) => setDate(e.target.value)}
        disabled={submitting}
      />

      <label htmlFor="time">Time</label>
      <input
        id="time"
        type="time"
        className="input"
        value={time}
        onChange={(e) => setTime(e.target.value)}
        disabled={submitting}
      />

      <label htmlFor="capacity">Capacity</label>
      <input
        id="capacity"
        type="number"
        min={1}
        className="input"
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        disabled={submitting}
      />

      {validationError || error ? (
        <p className="field-error" role="alert">
          {validationError ?? toMessage(error)}
        </p>
      ) : null}

      <button type="submit" className="btn" disabled={submitting}>
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
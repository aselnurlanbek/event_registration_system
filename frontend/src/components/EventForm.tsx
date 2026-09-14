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

// Convert an ISO string to the local value a <input type="datetime-local"> wants.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
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
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [startsAt, setStartsAt] = useState(
    initial ? toLocalInput(initial.startsAt) : '',
  );
  const [capacity, setCapacity] = useState(
    initial ? String(initial.capacity) : '',
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setValidationError('Title is required.');
    if (!startsAt) return setValidationError('Date and time are required.');
    const cap = Number(capacity);
    if (!Number.isInteger(cap) || cap < 1) {
      return setValidationError('Capacity must be a whole number of at least 1.');
    }
    setValidationError(null);
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      // datetime-local is local time → convert to UTC ISO for the backend.
      startsAt: new Date(startsAt).toISOString(),
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

      <label htmlFor="startsAt">Date &amp; time</label>
      <input
        id="startsAt"
        type="datetime-local"
        className="input"
        value={startsAt}
        onChange={(e) => setStartsAt(e.target.value)}
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
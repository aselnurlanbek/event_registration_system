import { useState, type FormEvent } from 'react';
import { useRegister } from '../api/registrations';
import ErrorMessage from './ErrorMessage';

// Minimal client-side sanity check only. The backend is the source of truth for
// everything that matters (capacity, waitlist, duplicates).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegistrationForm({ eventId }: { eventId: string }) {
  const [email, setEmail] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const register = useRegister(eventId);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) {
      setValidationError('Please enter your email address.');
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setValidationError('Please enter a valid email address.');
      return;
    }
    setValidationError(null);
    register.mutate(value);
  }

  const result = register.data;

  return (
    <div className="register">
      <h2>Register</h2>

      <form onSubmit={handleSubmit} noValidate className="register__form">
        <label htmlFor="email" className="register__label">
          Email address
        </label>
        <div className="register__row">
          <input
            id="email"
            type="email"
            className="input"
            value={email}
            placeholder="you@example.com"
            disabled={register.isPending}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button
            type="submit"
            className="btn"
            disabled={register.isPending}
          >
            {register.isPending ? 'Registering…' : 'Register'}
          </button>
        </div>
        {validationError && (
          <p className="field-error" role="alert">
            {validationError}
          </p>
        )}
      </form>

      {/* Network / validation / other backend errors (e.g. invalid email 400). */}
      {register.isError && (
        <div className="register__result">
          <ErrorMessage error={register.error} />
        </div>
      )}

      {/* Success — the backend told us the resulting status. */}
      {result && (
        <div className="register__result">
          {result.status === 'REGISTERED' ? (
            <div className="notice notice--success" role="status">
              <p className="notice__title">You’re registered! 🎉</p>
              <p>
                Status: <strong>{result.status}</strong>
              </p>
              {result.ticket && (
                <p>
                  Your ticket code:{' '}
                  <code className="ticket-code">{result.ticket.code}</code>
                </p>
              )}
            </div>
          ) : result.status === 'WAITLISTED' ? (
            <div className="notice notice--warning" role="status">
              <p className="notice__title">This event is currently full.</p>
              <p>
                You’ve been added to the <strong>waitlist</strong>
                {result.waitlistPos != null
                  ? ` (position ${result.waitlistPos})`
                  : ''}
                . If a spot opens up, you’ll be promoted automatically.
              </p>
            </div>
          ) : (
            <div className="notice" role="status">
              <p>
                Status: <strong>{result.status}</strong>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
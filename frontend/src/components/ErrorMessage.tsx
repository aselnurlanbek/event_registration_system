interface ErrorMessageProps {
  error: unknown;
  onRetry?: () => void;
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong.';
}

export default function ErrorMessage({ error, onRetry }: ErrorMessageProps) {
  return (
    <div className="state state--error" role="alert">
      <p className="state__title">Error</p>
      <p>{toMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
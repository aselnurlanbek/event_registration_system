interface LoadingProps {
  message?: string;
}

export default function Loading({ message = 'Loading…' }: LoadingProps) {
  return (
    <div className="state state--loading" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
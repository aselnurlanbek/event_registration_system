import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  hint?: string;
  children?: ReactNode; // optional action(s)
}

export default function EmptyState({ title, hint, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state__title">{title}</p>
      {hint && <p className="muted">{hint}</p>}
      {children && <div className="empty-state__action">{children}</div>}
    </div>
  );
}
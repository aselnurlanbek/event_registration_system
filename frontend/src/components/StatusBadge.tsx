import type { RegistrationStatus } from '../types';

const CLASS: Record<RegistrationStatus, string> = {
  REGISTERED: 'badge badge--ok',
  WAITLISTED: 'badge badge--warn',
  CANCELLED: 'badge badge--muted',
};

export default function StatusBadge({ status }: { status: RegistrationStatus }) {
  return <span className={CLASS[status]}>{status}</span>;
}
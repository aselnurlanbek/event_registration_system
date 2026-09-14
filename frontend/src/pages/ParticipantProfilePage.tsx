import { useAuth } from '../auth/context';

export default function ParticipantProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <section>
      <h1>Profile</h1>
      <dl className="detail-list">
        <div className="detail-list__row">
          <dt>Email</dt>
          <dd>{user.email}</dd>
        </div>
        <div className="detail-list__row">
          <dt>Account type</dt>
          <dd>
            <span className="role-chip role-chip--participant">
              {user.role}
            </span>
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>Member since</dt>
          <dd>{new Date(user.createdAt).toLocaleDateString()}</dd>
        </div>
      </dl>
    </section>
  );
}
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/context';

export default function ParticipantHomePage() {
  const { user } = useAuth();
  return (
    <section>
      <h1>Participant dashboard</h1>
      <p className="muted">Signed in as {user?.email}</p>
      <ul>
        <li>
          <Link to="/">Browse events</Link>
        </li>
      </ul>
      {/* Registration history lands in a later phase. */}
      <div className="placeholder">Your registrations will appear here.</div>
    </section>
  );
}
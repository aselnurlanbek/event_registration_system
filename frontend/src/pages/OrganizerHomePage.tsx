import { Link } from 'react-router-dom';
import { useAuth } from '../auth/context';

export default function OrganizerHomePage() {
  const { user } = useAuth();
  return (
    <section>
      <h1>Organizer dashboard</h1>
      <p className="muted">Signed in as {user?.email}</p>
      <ul>
        <li>
          <Link to="/">Browse events</Link>
        </li>
      </ul>
      {/* Own-events list + create/edit/cancel land in a later phase. */}
      <div className="placeholder">Your events will appear here.</div>
    </section>
  );
}
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';

function navClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app-nav__link app-nav__link--active' : 'app-nav__link';
}

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="container app-header__inner">
          <Link to="/" className="app-header__brand">
            Event Registration
          </Link>

          <nav className="app-nav">
            {/* Role-specific links — organizers never see participant links and
                vice versa. */}
            {user?.role === 'PARTICIPANT' && (
              <>
                <NavLink to="/participant" end className={navClass}>
                  Events
                </NavLink>
                <NavLink to="/participant/registrations" className={navClass}>
                  My Registrations
                </NavLink>
                <NavLink to="/participant/profile" className={navClass}>
                  Profile
                </NavLink>
              </>
            )}
            {user?.role === 'ORGANIZER' && (
              <>
                <NavLink to="/organizer" end className={navClass}>
                  Dashboard
                </NavLink>
                <NavLink to="/organizer/events/new" className={navClass}>
                  Create Event
                </NavLink>
              </>
            )}

            {user ? (
              <span className="app-nav__account">
                <span className="app-nav__email">{user.email}</span>
                <span
                  className={`role-chip role-chip--${user.role.toLowerCase()}`}
                >
                  {user.role}
                </span>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={handleLogout}
                >
                  Logout
                </button>
              </span>
            ) : (
              <>
                <NavLink to="/login" className={navClass}>
                  Log in
                </NavLink>
                <Link to="/register" className="btn btn--sm">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="container app-main">
        <Outlet />
      </main>

      <footer className="app-footer">
        <div className="container">Event Registration System</div>
      </footer>
    </div>
  );
}
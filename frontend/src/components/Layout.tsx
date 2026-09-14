import { Link, Outlet, useNavigate } from 'react-router-dom';
import { roleHome, useAuth } from '../auth/context';

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
            {user ? (
              <>
                <Link to={roleHome(user.role)} className="app-nav__link">
                  Dashboard
                </Link>
                <span className="app-nav__user">
                  {user.email} ({user.role.toLowerCase()})
                </span>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={handleLogout}
                >
                  Log out
                </button>
              </>
            ) : (
              <>
                <Link to="/login" className="app-nav__link">
                  Log in
                </Link>
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
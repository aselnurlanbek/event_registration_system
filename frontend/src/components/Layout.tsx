import { Link, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="app">
      <header className="app-header">
        <div className="container app-header__inner">
          <Link to="/" className="app-header__brand">
            Event Registration
          </Link>
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
import { Route, Routes } from 'react-router-dom';
import { RequireRole } from './auth/RequireRole';
import Layout from './components/Layout';
import CheckInPage from './pages/CheckInPage';
import EventDetailPage from './pages/EventDetailPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import OrganizerDashboardPage from './pages/OrganizerDashboardPage';
import OrganizerHomePage from './pages/OrganizerHomePage';
import ParticipantHomePage from './pages/ParticipantHomePage';
import RegisterPage from './pages/RegisterPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Public */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />

        {/* Participant-only */}
        <Route element={<RequireRole role="PARTICIPANT" />}>
          <Route path="/participant" element={<ParticipantHomePage />} />
        </Route>

        {/* Organizer-only */}
        <Route element={<RequireRole role="ORGANIZER" />}>
          <Route path="/organizer" element={<OrganizerHomePage />} />
          <Route
            path="/organizer/events/:eventId"
            element={<OrganizerDashboardPage />}
          />
          <Route path="/check-in/:eventId" element={<CheckInPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
import { Route, Routes } from 'react-router-dom';
import { RequireRole } from './auth/RequireRole';
import Layout from './components/Layout';
import CheckInPage from './pages/CheckInPage';
import EventDetailPage from './pages/EventDetailPage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import NotFoundPage from './pages/NotFoundPage';
import OrganizerCreateEventPage from './pages/OrganizerCreateEventPage';
import OrganizerDashboardPage from './pages/OrganizerDashboardPage';
import OrganizerEditEventPage from './pages/OrganizerEditEventPage';
import OrganizerEventsPage from './pages/OrganizerEventsPage';
import ParticipantDashboardPage from './pages/ParticipantDashboardPage';
import ParticipantEventDetailPage from './pages/ParticipantEventDetailPage';
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
          <Route path="/participant" element={<ParticipantDashboardPage />} />
          <Route
            path="/participant/events/:eventId"
            element={<ParticipantEventDetailPage />}
          />
        </Route>

        {/* Organizer-only */}
        <Route element={<RequireRole role="ORGANIZER" />}>
          <Route path="/organizer" element={<OrganizerEventsPage />} />
          <Route
            path="/organizer/events/new"
            element={<OrganizerCreateEventPage />}
          />
          <Route
            path="/organizer/events/:eventId/edit"
            element={<OrganizerEditEventPage />}
          />
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
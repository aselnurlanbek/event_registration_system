import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import CheckInPage from './pages/CheckInPage';
import EventDetailPage from './pages/EventDetailPage';
import HomePage from './pages/HomePage';
import NotFoundPage from './pages/NotFoundPage';
import OrganizerDashboardPage from './pages/OrganizerDashboardPage';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/events/:eventId" element={<EventDetailPage />} />
        <Route
          path="/organizer/events/:eventId"
          element={<OrganizerDashboardPage />}
        />
        <Route path="/check-in/:eventId" element={<CheckInPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
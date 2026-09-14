import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { registrationsKey } from '../api/registrations';
import { statsKey } from '../api/dashboard';
import type { StatsUpdatedPayload } from '../types';
import {
  getSocket,
  onStatsUpdated,
  subscribeToEvent,
  unsubscribeFromEvent,
} from './socket';

/**
 * Keeps an event's stats + participant tables live via Socket.IO.
 *
 * - Subscribes to the `event:{eventId}` room and listens for
 *   `event.stats.updated` (registration, cancellation, promotion, check-in).
 * - On each event: updates the stats cards instantly from the snapshot, and
 *   invalidates the registrations query so the tables refetch from REST.
 * - On (re)connect: re-subscribes and refetches BOTH queries from REST, so a
 *   reconnect never assumes we saw every intermediate event.
 * - Cleans up the listeners and room subscription on unmount.
 */
export function useEventRealtime(eventId: string): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!eventId) return;
    const socket = getSocket();

    const resyncFromRest = () => {
      void queryClient.invalidateQueries({ queryKey: statsKey(eventId) });
      void queryClient.invalidateQueries({
        queryKey: registrationsKey(eventId),
      });
    };

    const handleStats = (payload: StatsUpdatedPayload) => {
      if (payload.eventId !== eventId) return;
      // Instant cards from the snapshot...
      queryClient.setQueryData(statsKey(eventId), {
        capacity: payload.capacity,
        registered: payload.registered,
        waitlisted: payload.waitlisted,
        checkedIn: payload.checkedIn,
      });
      // ...and refresh the participant tables from REST.
      void queryClient.invalidateQueries({
        queryKey: registrationsKey(eventId),
      });
    };

    const handleConnect = () => {
      // Rooms are per-connection: re-join and re-sync after any (re)connect.
      subscribeToEvent(eventId);
      resyncFromRest();
    };

    // Subscribe now (covers the already-connected case) + on future reconnects.
    subscribeToEvent(eventId);
    socket.on('connect', handleConnect);
    const offStats = onStatsUpdated(handleStats);

    return () => {
      offStats();
      socket.off('connect', handleConnect);
      unsubscribeFromEvent(eventId);
    };
  }, [eventId, queryClient]);
}
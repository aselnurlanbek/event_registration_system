import { Server, Socket } from 'socket.io';
import { EventsGateway, eventRoom } from './events.gateway';

describe('EventsGateway (unit)', () => {
  let gateway: EventsGateway;

  beforeEach(() => {
    gateway = new EventsGateway();
  });

  it('builds the room name from the convention event:{eventId}', () => {
    expect(eventRoom('abc')).toBe('event:abc');
  });

  it('subscribe joins the event room', () => {
    const client = { id: 's1', join: jest.fn(), leave: jest.fn() } as unknown as Socket;

    const ack = gateway.subscribe(client, { eventId: 'e1' });

    expect(client.join).toHaveBeenCalledWith('event:e1');
    expect(ack).toEqual({ status: 'subscribed', eventId: 'e1' });
  });

  it('unsubscribe leaves the event room', () => {
    const client = { id: 's1', join: jest.fn(), leave: jest.fn() } as unknown as Socket;

    const ack = gateway.unsubscribe(client, { eventId: 'e1' });

    expect(client.leave).toHaveBeenCalledWith('event:e1');
    expect(ack).toEqual({ status: 'unsubscribed', eventId: 'e1' });
  });

  it('emits event.stats.updated to the room with only aggregate data (no PII)', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as unknown as Server;

    gateway.emitStatsUpdated('e1', {
      capacity: 100,
      registered: 73,
      waitlisted: 5,
      checkedIn: 42,
    });

    expect(to).toHaveBeenCalledWith('event:e1');
    expect(emit).toHaveBeenCalledWith('event.stats.updated', {
      eventId: 'e1',
      capacity: 100,
      registered: 73,
      waitlisted: 5,
      checkedIn: 42,
    });

    // Guard against leaking participant PII through the payload.
    const payload = emit.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'capacity',
      'checkedIn',
      'eventId',
      'registered',
      'waitlisted',
    ]);
  });
});
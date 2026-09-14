import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateEventDto } from './create-event.dto';

// Helper: returns the set of property names that failed validation.
function invalidProps(payload: Record<string, unknown>): string[] {
  const dto = plainToInstance(CreateEventDto, payload);
  return validateSync(dto).map((e) => e.property);
}

describe('CreateEventDto validation', () => {
  const valid = {
    title: 'Conference',
    description: 'Yearly conference',
    startsAt: '2026-10-01T18:00:00.000Z',
    capacity: 50,
  };

  it('accepts a valid payload', () => {
    expect(invalidProps(valid)).toEqual([]);
  });

  it('rejects capacity <= 0', () => {
    expect(invalidProps({ ...valid, capacity: 0 })).toContain('capacity');
    expect(invalidProps({ ...valid, capacity: -5 })).toContain('capacity');
  });

  it('rejects an empty title', () => {
    expect(invalidProps({ ...valid, title: '' })).toContain('title');
  });

  it('rejects an invalid startsAt', () => {
    expect(invalidProps({ ...valid, startsAt: 'not-a-date' })).toContain(
      'startsAt',
    );
  });
});
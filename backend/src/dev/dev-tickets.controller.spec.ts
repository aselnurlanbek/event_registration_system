import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DevTicketsController } from './dev-tickets.controller';

describe('DevTicketsController', () => {
  const prismaStub = {
    ticket: {
      findMany: jest.fn().mockResolvedValue([
        {
          code: 'ABC123',
          registrationId: 'reg_1',
          registration: {
            email: 'a@example.com',
            status: 'REGISTERED',
            checkedInAt: null,
          },
        },
      ]),
    },
  } as unknown as PrismaService;

  function make(nodeEnv: string | undefined) {
    const config = { get: () => nodeEnv } as unknown as ConfigService;
    return new DevTicketsController(prismaStub, config);
  }

  it('returns a flat ticket list in development with a dev-only warning', async () => {
    const result = await make('development').list('evt_1');
    expect(result.count).toBe(1);
    expect(result._warning).toMatch(/DEVELOPMENT-ONLY/);
    expect(result.tickets[0]).toEqual({
      code: 'ABC123',
      email: 'a@example.com',
      status: 'REGISTERED',
      checkedInAt: null,
      registrationId: 'reg_1',
    });
  });

  it('is hidden (404) in production', async () => {
    await expect(make('production').list('evt_1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DevEmailsController } from './dev-emails.controller';
import { EmailService } from './email.service';

describe('DevEmailsController', () => {
  const emailStub = {
    listAll: jest.fn().mockResolvedValue([{ id: 'e1' }]),
  } as unknown as EmailService;

  function make(nodeEnv: string | undefined) {
    const config = { get: () => nodeEnv } as unknown as ConfigService;
    return new DevEmailsController(emailStub, config);
  }

  it('returns the outbox in development with a dev-only warning', async () => {
    const result = await make('development').list();
    expect(result.count).toBe(1);
    expect(result._warning).toMatch(/DEVELOPMENT-ONLY/);
    expect(result.emails).toHaveLength(1);
  });

  it('is hidden (404) in production', async () => {
    await expect(make('production').list()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
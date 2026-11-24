import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database so this file cannot race with other test files that wipe shared collections.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_me_profile_t007',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
let hash = '';

const mkUser = (email: string, over: Record<string, unknown> = {}) =>
  prisma.user.create({
    data: {
      firstName: 'Sara',
      lastName: 'Ali',
      email,
      passwordHash: hash,
      isVerified: true,
      ...over,
    },
  });
const patch = (token: string | undefined, body: unknown) => {
  const r = request(app)
    .patch('/api/v1/me')
    .send(body as object);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  hash = await hashPassword('Passw0rdOne!');
});
beforeEach(async () => {
  await prisma.user.deleteMany();
});
afterAll(async () => {
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('PROF-01 · profile', () => {
  it('PROF-01 · updates first name, last name and locale and returns the public user', async () => {
    const u = await mkUser('a@example.com');
    const res = await patch(signAccessToken(u), {
      firstName: '  Noura ',
      lastName: 'Saad',
      preferredLocale: 'en',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: u.id,
      firstName: 'Noura',
      lastName: 'Saad',
      preferredLocale: 'en',
      email: 'a@example.com',
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    const db = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(db.firstName).toBe('Noura');
    expect(db.preferredLocale).toBe('en');
  });

  it.each(['0551234567', '055 123 4567', '+966-55-123-4567', '٠٥٥١٢٣٤٥٦٧'])(
    'PROF-01 · phone %s is stored as +966551234567',
    async (input) => {
      const u = await mkUser('p@example.com');
      const res = await patch(signAccessToken(u), { phone: input });
      expect(res.status).toBe(200);
      expect(res.body.phone).toBe('+966551234567');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).phone).toBe(
        '+966551234567',
      );
    },
  );

  it('PROF-01 · phone null clears it; a landline or letters is 422 VALIDATION_ERROR', async () => {
    const u = await mkUser('n@example.com', { phone: '+966551234567' });
    const token = signAccessToken(u);
    for (const bad of ['0112345678', 'abc', '05512', '966551234567']) {
      const r = await patch(token, { phone: bad });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('VALIDATION_ERROR');
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).phone).toBe(
      '+966551234567',
    );
    const res = await patch(token, { phone: null });
    expect(res.status).toBe(200);
    expect(res.body.phone).toBeNull();
  });

  it('PROF-01 · unknown fields (email, role, isVerified, isBlocked, id) give 422 VALIDATION_ERROR', async () => {
    const u = await mkUser('s@example.com');
    const token = signAccessToken(u);
    for (const extra of [
      { email: 'new@example.com' },
      { role: 'ADMIN' },
      { isVerified: false },
      { isBlocked: true },
      { id: '0'.repeat(24) },
    ]) {
      const res = await patch(token, { firstName: 'Changed', ...extra });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    const db = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(db).toMatchObject({
      firstName: 'Sara',
      email: 's@example.com',
      role: 'CUSTOMER',
      isVerified: true,
      isBlocked: false,
      avatar: null,
    });
  });

  it('PROF-01 · invalid values give 422: empty or too long names, bad locale, empty body', async () => {
    const u = await mkUser('v@example.com');
    const token = signAccessToken(u);
    for (const body of [
      {},
      { firstName: '   ' },
      { firstName: 'x'.repeat(41) },
      { lastName: '' },
      { preferredLocale: 'fr' },
    ]) {
      const res = await patch(token, body);
      expect(res.status, JSON.stringify(body)).toBe(422);
    }
    expect((await patch(token, { firstName: 'x'.repeat(40) })).status).toBe(200);
  });

  it('PROF-01 · without a token, or with a blocked user token, returns 401', async () => {
    const u = await mkUser('b@example.com');
    const token = signAccessToken(u);
    expect((await patch(undefined, { firstName: 'X' })).status).toBe(401);
    await prisma.user.update({ where: { id: u.id }, data: { isBlocked: true } });
    const res = await patch(token, { firstName: 'X' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('PROF-01 · a user only ever changes their own profile', async () => {
    const a = await mkUser('a1@example.com');
    const b = await mkUser('b1@example.com');
    await patch(signAccessToken(a), { firstName: 'Only-A', userId: b.id }).expect(422);
    await patch(signAccessToken(a), { firstName: 'Only-A' }).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: b.id } })).firstName).toBe('Sara');
  });
});

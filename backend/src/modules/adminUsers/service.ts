import { randomBytes } from 'node:crypto';
import type { Prisma, User } from '@prisma/client';
import { getEnv } from '../../config/env.js';
import { mailer } from '../../emails/mailer.js';
import { socketEmitter } from '../../lib/emitter.js';
import { AppError } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import { prisma } from '../../lib/prisma.js';
import { isDuplicateKey } from '../../lib/rateLimit.js';
import { escapeRegex } from '../../lib/searchText.js';
import { normalizeSaudiPhone } from '../../lib/phone.js';
import { createTestHooks } from '../../lib/testHooks.js';
import { revokeAllForUser } from '../../lib/tokens.js';
import { toPublicUser } from '../auth/auth.service.js';
import { assertCanIssue, createOtp, UNCONSUMED } from '../auth/otp.service.js';
import { toOrder, USER_INCLUDE } from '../orders/service.js';
import type { CustomerOrdersQuery, InviteAdminBody, ListCustomersQuery } from './schema.js';

const OBJECT_ID = /^[a-f0-9]{24}$/;
const notFound = () => new AppError(404, 'NOT_FOUND', 'User not found');
const emailInUse = () => new AppError(409, 'EMAIL_IN_USE', 'Email already in use');
const isWriteConflict = (e: unknown) => (e as { code?: string })?.code === 'P2034';

const pageMeta = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

/** Admin-list shape (spec `AdminUser`): the public user plus the T-017 audit field. */
const toAdminUser = (u: User) => ({ ...toPublicUser(u), invitedById: u.invitedById ?? null });

export const testHooks = createTestHooks<{
  /**
   * Fired inside the admin-block transaction, right BEFORE the serializer write on the guard
   * Counter doc, with the attempt number. Lets the LAST_ADMIN concurrency test hold two
   * transactions open at the same point. Same `createTestHooks` guard: inert outside tests.
   */
  beforeAdminBlockGuard?: (attempt: number) => Promise<void> | void;
}>();

// ---------------------------------------------------------------- ADM-05 customers

export async function listCustomers(query: ListCustomersQuery) {
  const where: Prisma.UserWhereInput = { role: 'CUSTOMER' };
  if (query.q) {
    // Rule 9: Prisma MongoDB contains/insensitive is $regex-backed -> always escaped, max 100 chars.
    const literal = escapeRegex(query.q);
    const or: Prisma.UserWhereInput[] = [
      { email: { contains: literal, mode: 'insensitive' } },
      { firstName: { contains: literal, mode: 'insensitive' } },
      { lastName: { contains: literal, mode: 'insensitive' } },
    ];
    // T-014 pattern: a query that normalises to a Saudi mobile also matches the exact stored phone.
    const phone = normalizeSaudiPhone(query.q);
    if (phone) or.push({ phone });
    where.OR = or;
  }
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.user.count({ where }),
  ]);
  // One grouped count for the page's users (never N+1).
  const counts = rows.length
    ? await prisma.order.groupBy({
        by: ['userId'],
        where: { userId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      })
    : [];
  const countByUser = new Map(counts.map((c) => [c.userId, c._count._all]));
  return {
    items: rows.map((u) => ({ ...toPublicUser(u), orderCount: countByUser.get(u.id) ?? 0 })),
    meta: pageMeta(query.page, query.limit, total),
  };
}

export async function getCustomer(id: string, query: CustomerOrdersQuery) {
  if (!OBJECT_ID.test(id)) throw notFound();
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== 'CUSTOMER') throw notFound();
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: USER_INCLUDE,
    }),
    prisma.order.count({ where: { userId: id } }),
  ]);
  return {
    user: toPublicUser(user),
    orders: orders.map(toOrder),
    meta: pageMeta(query.page, query.limit, total),
  };
}

/**
 * ADM-05. Customers only (an ADMIN id -> 404; admins go through blockAdmin). Blocking revokes every
 * refresh token in the same transaction, then kicks live sockets after commit (best effort, T-023).
 * Unblocking only clears the flag — the login lockout key stays (it is abuse protection, T-005).
 */
export async function blockCustomer(id: string, isBlocked: boolean) {
  if (!OBJECT_ID.test(id)) throw notFound();
  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id } });
    if (!user || user.role !== 'CUSTOMER') throw notFound();
    const u = await tx.user.update({ where: { id }, data: { isBlocked } });
    if (isBlocked) await revokeAllForUser(id, tx);
    return u;
  });
  if (isBlocked) socketEmitter.disconnectUser(id);
  return toPublicUser(updated);
}

// ---------------------------------------------------------------- ADM-11 admins

export async function listAdmins() {
  const rows = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toAdminUser);
}

async function sendInviteEmail(
  user: Pick<User, 'email' | 'firstName' | 'preferredLocale'>,
  code: string,
) {
  const env = getEnv();
  // The code is never in the URL (owner 2026-11-22); the screen is admin T-061.
  const adminUrl = `${env.ADMIN_URL.replace(/\/+$/, '')}/accept-invite?email=${encodeURIComponent(user.email)}`;
  await mailer.send({
    to: user.email,
    template: 'admin-invite',
    locale: user.preferredLocale,
    data: {
      firstName: user.firstName,
      code,
      ttlSeconds: env.INVITE_TTL_SECONDS,
      adminUrl,
    },
  });
}

/**
 * ADM-11 (owner 2026-11-22). Creates role ADMIN, unverified, with an UNUSABLE password (argon2id of
 * random bytes — the inviter never knows the real one; the invitee sets it via /auth/accept-invite),
 * `invitedById` for audit, and an INVITE_ADMIN code valid `INVITE_TTL_SECONDS`, emailed in the
 * invitee's `preferredLocale`. Any existing user with the email -> 409 EMAIL_IN_USE.
 */
export async function inviteAdmin(inviter: User, body: InviteAdminBody) {
  const { email, firstName, lastName, preferredLocale } = body;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw emailInUse();
  await assertCanIssue(email, 'INVITE_ADMIN');

  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        email,
        firstName,
        lastName,
        preferredLocale,
        passwordHash,
        role: 'ADMIN',
        isVerified: false,
        invitedById: inviter.id,
        // Rule 8: writers set optional fields to an explicit null.
        phone: null,
        avatar: null,
        lockedUntil: null,
        passwordChangedAt: null,
      },
    });
  } catch (err) {
    if (isDuplicateKey(err) || (err as { code?: string })?.code === 'P2002') throw emailInUse();
    throw err;
  }
  const code = await createOtp({ email, purpose: 'INVITE_ADMIN' });
  await sendInviteEmail(user, code);
  return toAdminUser(user);
}

/** ADM-11: burns the live INVITE_ADMIN codes and issues a fresh one (cooldown/cap apply). */
export async function resendInvite(id: string) {
  if (!OBJECT_ID.test(id)) throw notFound();
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== 'ADMIN') throw notFound();
  if (user.isVerified)
    throw new AppError(409, 'ALREADY_VERIFIED', 'The invite was already accepted');
  await assertCanIssue(user.email, 'INVITE_ADMIN');
  // The old code must stop working (owner 2026-11-22): consume every live invite code first.
  await prisma.otp.updateMany({
    where: { email: user.email, purpose: 'INVITE_ADMIN', ...UNCONSUMED },
    data: { consumedAt: new Date() },
  });
  const code = await createOtp({ email: user.email, purpose: 'INVITE_ADMIN' });
  await sendInviteEmail(user, code);
}

/** Every admin-block transaction writes this Counter doc, serializing concurrent blocks (see blockAdmin). */
const ADMIN_BLOCK_GUARD = 'adminBlockGuard';
const MAX_BLOCK_ATTEMPTS = 5;

/** Creates the guard doc outside the transaction (an in-tx upsert race would surface E11000, not P2034). */
async function ensureGuardDoc(): Promise<void> {
  try {
    await prisma.counter.upsert({
      where: { name: ADMIN_BLOCK_GUARD },
      update: {},
      create: { name: ADMIN_BLOCK_GUARD, seq: 0 },
    });
  } catch (err) {
    // Lost the bootstrap race: the doc exists, which is all we need.
    if (isDuplicateKey(err) || (err as { code?: string })?.code === 'P2002') return;
    throw err;
  }
}

/**
 * ADM-11 (owner 2026-11-22). Admins only (a CUSTOMER id -> 404). Guards: SELF_BLOCK (an admin cannot
 * block themselves) and LAST_ADMIN (the store must keep at least one active verified admin).
 *
 * The LAST_ADMIN check is serialized: the transaction first increments one shared Counter doc, so two
 * concurrent admin blocks write-conflict (P2034) instead of both reading a snapshot in which the other
 * admin is still active and committing a state with zero active admins. The loser retries (bounded,
 * small backoff) against the committed state.
 */
export async function blockAdmin(actor: User, id: string, isBlocked: boolean) {
  if (!OBJECT_ID.test(id)) throw notFound();
  if (isBlocked && id === actor.id)
    throw new AppError(422, 'SELF_BLOCK', 'You cannot block yourself');
  await ensureGuardDoc();

  let updated: User | undefined;
  for (let attempt = 1; ; attempt += 1) {
    try {
      updated = await prisma.$transaction(async (tx) => {
        await testHooks.beforeAdminBlockGuard?.(attempt);
        await tx.counter.update({
          where: { name: ADMIN_BLOCK_GUARD },
          data: { seq: { increment: 1 } },
        });
        const user = await tx.user.findUnique({ where: { id } });
        if (!user || user.role !== 'ADMIN') throw notFound();
        if (isBlocked) {
          const remaining = await tx.user.count({
            where: { role: 'ADMIN', isVerified: true, isBlocked: false, id: { not: id } },
          });
          if (remaining === 0)
            throw new AppError(409, 'LAST_ADMIN', 'The last active admin cannot be blocked');
        }
        const u = await tx.user.update({ where: { id }, data: { isBlocked } });
        if (isBlocked) await revokeAllForUser(id, tx);
        return u;
      });
      break;
    } catch (err) {
      if (isWriteConflict(err) && attempt < MAX_BLOCK_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
        continue;
      }
      throw err;
    }
  }
  if (isBlocked) socketEmitter.disconnectUser(id);
  return toAdminUser(updated);
}

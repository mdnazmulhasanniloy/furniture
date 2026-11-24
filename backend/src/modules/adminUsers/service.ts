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
import { createLogger } from '../../lib/logger.js';
import { createTestHooks } from '../../lib/testHooks.js';
import { revokeAllForUser } from '../../lib/tokens.js';
import { toPublicUser } from '../auth/auth.service.js';
import { assertCanIssue, createOtp, UNCONSUMED } from '../auth/otp.service.js';
import { toOrder, USER_INCLUDE } from '../orders/service.js';
import type { Logger } from '../../lib/logger.js';
import { releaseUploads } from '../../lib/r2.js';
import { notSet } from '../../lib/prismaFilters.js';
import type {
  BlockCustomerBody,
  CustomerOrdersQuery,
  DeleteCustomerBody,
  InviteAdminBody,
  ListCustomersQuery,
  UpdateCustomerBody,
} from './schema.js';

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

// ---------------------------------------------------------------- ADM-05 / ADM-17 customers

const forbiddenTarget = () => new AppError(403, 'FORBIDDEN_TARGET', 'This account cannot be changed here');
const customerDeleted = () => new AppError(409, 'CUSTOMER_DELETED', 'This customer was deleted');

/** The context a customer action needs for its single audit log line (CR-011). */
export interface CustomerActionContext {
  log?: Pick<Logger, 'info'>;
  requestId?: string;
}

/**
 * Admin view of a customer (CR-011): the public user plus the blocked fields and the concurrency token. The
 * blocked reason is admin-only (never in `toPublicUser`, which the customer's own endpoints use) and there is no
 * password hash anywhere in this shape.
 */
export const toAdminCustomer = (u: User) => ({
  ...toPublicUser(u),
  updatedAt: u.updatedAt,
  blockedReason: u.blockedReason ?? null,
  blockedAt: u.blockedAt ?? null,
  blockedById: u.blockedById ?? null,
  deletedAt: u.deletedAt ?? null,
  deletedById: u.deletedById ?? null,
});

/**
 * One structured log line per customer action (CR-011, owner Q-8): who (actor id), what (action), on whom (target
 * id), when, and the NAMES of the changed fields. Never a name, email, phone, reason or any other personal data.
 */
function audit(
  ctx: CustomerActionContext,
  action: 'customer.block' | 'customer.unblock' | 'customer.update' | 'customer.delete',
  actorId: string,
  targetId: string,
  fields: string[],
) {
  const log = ctx.log ?? (auditFallback ??= createLogger(getEnv()));
  log.info({ event: action, actorId, targetId, fields, at: new Date().toISOString(), requestId: ctx.requestId }, action);
}
let auditFallback: Logger | undefined;

/**
 * The guard shared by block, update and delete. The caller's own id -> 403 FORBIDDEN_TARGET; another admin (or any
 * non-customer, or an unknown id) -> 404, as before; so an admin can never block, edit or delete an admin or themselves
 * through these routes.
 */
async function loadCustomerTarget(db: Prisma.TransactionClient | typeof prisma, actorId: string, id: string) {
  if (!OBJECT_ID.test(id)) throw notFound();
  if (id === actorId) throw forbiddenTarget();
  const user = await db.user.findUnique({ where: { id } });
  if (!user || user.role !== 'CUSTOMER') throw notFound();
  return user;
}

const NOT_DELETED = notSet<Prisma.UserWhereInput>('deletedAt');

export async function listCustomers(query: ListCustomersQuery) {
  const and: Prisma.UserWhereInput[] = [{ role: 'CUSTOMER' }];
  // Rule 8: 'not deleted' must match documents created without the field, so it goes through notSet.
  if (query.status === 'deleted') and.push({ NOT: NOT_DELETED });
  else {
    and.push(NOT_DELETED);
    if (query.status === 'active') and.push({ isBlocked: false });
    if (query.status === 'blocked') and.push({ isBlocked: true });
  }
  const where: Prisma.UserWhereInput = { AND: and };
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
    and.push({ OR: or });
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
    items: rows.map((u) => ({ ...toAdminCustomer(u), orderCount: countByUser.get(u.id) ?? 0 })),
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
    user: toAdminCustomer(user),
    orders: orders.map(toOrder),
    meta: pageMeta(query.page, query.limit, total),
  };
}

/**
 * ADM-05 / ADM-17. Block needs a reason (admin-only, stored with who and when); unblock clears the three fields to
 * explicit null. Customers only (see loadCustomerTarget); a soft-deleted customer -> 409 CUSTOMER_DELETED.
 * Blocking revokes every refresh token in the same transaction, then kicks live sockets after commit (best effort,
 * T-023). The customer is then refused at login, refresh, password reset (no code is issued for a blocked user) and
 * on every authenticated call, including placing an order (requireAuth), always with the same generic response.
 */
export async function blockCustomer(
  actor: Pick<User, 'id'>,
  id: string,
  body: BlockCustomerBody,
  ctx: CustomerActionContext = {},
) {
  const { isBlocked, reason } = body;
  const updated = await prisma.$transaction(async (tx) => {
    const user = await loadCustomerTarget(tx, actor.id, id);
    if (user.deletedAt) throw customerDeleted();
    const data: Prisma.UserUpdateInput = isBlocked
      ? { isBlocked: true, blockedReason: reason ?? null, blockedAt: new Date(), blockedById: actor.id }
      : { isBlocked: false, blockedReason: null, blockedAt: null, blockedById: null };
    const u = await tx.user.update({ where: { id }, data });
    if (isBlocked) await revokeAllForUser(id, tx);
    return u;
  });
  if (isBlocked) socketEmitter.disconnectUser(id);
  audit(ctx, isBlocked ? 'customer.block' : 'customer.unblock', actor.id, id, ['isBlocked', 'blockedReason', 'blockedAt', 'blockedById']);
  return toAdminCustomer(updated);
}

/**
 * ADM-17. Name and phone only (the schema is strict), optimistic concurrency on `expectedUpdatedAt`
 * (409 STALE_UPDATE with the current customer in `details.current`). Phone is already normalised to +9665XXXXXXXX.
 */
export async function updateCustomer(
  actor: Pick<User, 'id'>,
  id: string,
  body: UpdateCustomerBody,
  ctx: CustomerActionContext = {},
) {
  const data: Prisma.UserUpdateInput = {};
  const fields: string[] = [];
  if (body.firstName !== undefined) {
    data.firstName = body.firstName;
    fields.push('firstName');
  }
  if (body.lastName !== undefined) {
    data.lastName = body.lastName;
    fields.push('lastName');
  }
  if (body.phone !== undefined) {
    data.phone = body.phone; // null clears it (explicit null, rule 8)
    fields.push('phone');
  }
  const updated = await prisma.$transaction(async (tx) => {
    const user = await loadCustomerTarget(tx, actor.id, id);
    if (user.deletedAt) throw customerDeleted();
    const res = await tx.user.updateMany({ where: { id, updatedAt: body.expectedUpdatedAt }, data });
    if (res.count === 0) {
      throw new AppError(409, 'STALE_UPDATE', 'The customer was changed by someone else; reload and retry', {
        current: toAdminCustomer(user),
      });
    }
    return tx.user.findUniqueOrThrow({ where: { id } });
  });
  audit(ctx, 'customer.update', actor.id, id, fields);
  return toAdminCustomer(updated);
}

/**
 * ADM-17 (owner Q-7). Soft delete with anonymisation; orders and their address snapshots are kept (sales and VAT
 * record). Refused while a PENDING or CONFIRMED order exists. One transaction; sockets and the avatar object are
 * handled after commit. The admin must send the customer's exact email, compared here as well as in the UI.
 */
export async function deleteCustomer(
  actor: Pick<User, 'id'>,
  id: string,
  body: DeleteCustomerBody,
  ctx: CustomerActionContext = {},
) {
  // argon2 is slow: hash outside the transaction. Random bytes, so nobody can ever log in with it.
  const unusableHash = await hashPassword(randomBytes(32).toString('hex'));
  let avatarKey: string | null = null;
  const updated = await prisma.$transaction(async (tx) => {
    const user = await loadCustomerTarget(tx, actor.id, id);
    if (user.deletedAt) throw customerDeleted();
    if (body.confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new AppError(422, 'CONFIRM_EMAIL_MISMATCH', 'The typed email does not match this customer');
    }
    const open = await tx.order.count({ where: { userId: id, status: { in: ['PENDING', 'CONFIRMED'] } } });
    if (open > 0) {
      throw new AppError(409, 'CUSTOMER_HAS_OPEN_ORDERS', 'This customer has pending or confirmed orders', {
        openOrders: open,
      });
    }
    avatarKey = user.avatar;
    const originalEmail = user.email;
    const u = await tx.user.update({
      where: { id },
      data: {
        firstName: 'Deleted',
        lastName: 'customer',
        email: `deleted-${id}@deleted.invalid`, // unique, never deliverable; frees the real address
        phone: null,
        avatar: null,
        passwordHash: unusableHash,
        isBlocked: true,
        isVerified: false,
        failedLoginCount: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(), // older access tokens stop working
        blockedReason: null,
        blockedAt: null,
        blockedById: null,
        deletedAt: new Date(),
        deletedById: actor.id,
      },
    });
    await revokeAllForUser(id, tx);
    await tx.address.deleteMany({ where: { userId: id } });
    await tx.cart.deleteMany({ where: { userId: id } });
    await tx.wishlist.deleteMany({ where: { userId: id } });
    await tx.notification.deleteMany({ where: { userId: id } });
    await tx.otp.deleteMany({ where: { email: originalEmail } });
    return u;
  });
  socketEmitter.disconnectUser(id);
  if (avatarKey) await releaseUploads([avatarKey], { requestId: ctx.requestId });
  audit(ctx, 'customer.delete', actor.id, id, ['firstName', 'lastName', 'email', 'phone', 'avatar', 'passwordHash', 'isBlocked', 'deletedAt']);
  return toAdminCustomer(updated);
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

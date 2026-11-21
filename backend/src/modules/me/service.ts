import type { Address, Prisma } from '@prisma/client';
import { assertActiveCity, getActiveCityCodes } from '../../lib/deliveryCities.js';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { toPublicUser } from '../auth/auth.service.js';
import type { CreateAddressBody, UpdateAddressBody, UpdateProfileBody } from './schema.js';

export const MAX_ADDRESSES = 10;
const OBJECT_ID = /^[a-f0-9]{24}$/;
const isWriteConflict = (e: unknown) => (e as { code?: string })?.code === 'P2034';
const notFound = () => new AppError(404, 'NOT_FOUND', 'Address not found');

export function toPublicAddress(a: Address, activeCities: ReadonlySet<string>) {
  return {
    id: a.id,
    label: a.label,
    fullName: a.fullName,
    phone: a.phone,
    cityCode: a.cityCode,
    area: a.area,
    street: a.street,
    notes: a.notes,
    isDefault: a.isDefault,
    // PROF-02: derived per request from SiteSetting.deliveryCities, never stored.
    isDeliverable: activeCities.has(a.cityCode.trim().toLowerCase()),
  };
}

export async function updateProfile(userId: string, body: UpdateProfileBody) {
  const user = await prisma.user.update({ where: { id: userId }, data: body });
  return toPublicUser(user);
}

export async function listAddresses(userId: string) {
  const rows = await prisma.address.findMany({
    where: { userId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
  const active = await getActiveCityCodes();
  return rows.map((r) => toPublicAddress(r, active));
}

/**
 * Runs `fn` in a transaction that first rewrites the user document. Concurrent address changes of one
 * user therefore conflict (P2034) and are retried, which keeps "exactly one default" true (PROF-02).
 */
async function withUserLock<T>(
  userId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { updatedAt: new Date() } });
        return fn(tx);
      });
    } catch (err) {
      if (!isWriteConflict(err) || attempt >= 15) throw err;
      await new Promise((r) => setTimeout(r, 5 + Math.random() * 25));
    }
  }
}

export async function createAddress(userId: string, body: CreateAddressBody) {
  const city = await assertActiveCity(body.cityCode);
  const created = await withUserLock(userId, async (tx) => {
    const count = await tx.address.count({ where: { userId } });
    if (count >= MAX_ADDRESSES) {
      throw new AppError(409, 'ADDRESS_LIMIT_REACHED', `At most ${MAX_ADDRESSES} addresses`);
    }
    const makeDefault = count === 0 || body.isDefault === true;
    if (makeDefault) {
      await tx.address.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.address.create({
      data: { ...body, cityCode: city.code, isDefault: makeDefault, userId },
    });
  });
  return toPublicAddress(created, await getActiveCityCodes());
}

export async function updateAddress(userId: string, id: string, body: UpdateAddressBody) {
  if (!OBJECT_ID.test(id)) throw notFound();
  const data: Prisma.AddressUpdateInput = { ...body };
  // The city is re-checked only when the patch changes it (an address in a later-deactivated city stays editable).
  if (body.cityCode !== undefined) data.cityCode = (await assertActiveCity(body.cityCode)).code;
  const updated = await withUserLock(userId, async (tx) => {
    const current = await tx.address.findFirst({ where: { id, userId } });
    if (!current) throw notFound();
    if (body.isDefault === false && current.isDefault) {
      throw new AppError(
        422,
        'VALIDATION_ERROR',
        'Set another address as default instead of unsetting this one',
      );
    }
    if (body.isDefault === true) {
      await tx.address.updateMany({
        where: { userId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.address.update({ where: { id }, data });
  });
  return toPublicAddress(updated, await getActiveCityCodes());
}

export async function deleteAddress(userId: string, id: string): Promise<void> {
  if (!OBJECT_ID.test(id)) throw notFound();
  await withUserLock(userId, async (tx) => {
    const current = await tx.address.findFirst({ where: { id, userId } });
    if (!current) throw notFound();
    await tx.address.delete({ where: { id } });
    if (current.isDefault) {
      const next = await tx.address.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

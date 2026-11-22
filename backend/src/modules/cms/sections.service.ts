import { Prisma, type HomeSection } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import type { CreateSectionBody, UpdateSectionBody } from './schema.js';

const OBJECT_ID = /^[a-f0-9]{24}$/;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Home section not found');
const validation = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';

export const toSection = (s: HomeSection) => ({
  id: s.id,
  type: s.type,
  title: s.title,
  subtitle: s.subtitle ?? null,
  config: s.config ?? null,
  sortOrder: s.sortOrder,
  isVisible: s.isVisible,
  updatedAt: s.updatedAt,
});
export type SectionResponse = ReturnType<typeof toSection>;

const staleUpdate = (current: HomeSection) =>
  new AppError(409, 'STALE_UPDATE', 'The section was changed by someone else; reload and retry', {
    current: toSection(current),
  });

/** MongoDB Json fields take plain null (no DbNull/JsonNull split on this connector). */
const configValue = (config: CreateSectionBody['config']): Prisma.InputJsonValue | null =>
  config === undefined ? null : (config as Prisma.InputJsonValue);

export async function list(): Promise<SectionResponse[]> {
  const rows = await prisma.homeSection.findMany({
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map(toSection);
}

export async function create(body: CreateSectionBody): Promise<SectionResponse> {
  const row = await prisma.homeSection.create({
    data: {
      type: body.type,
      title: body.title,
      subtitle: body.subtitle ?? null, // explicit null (rule 8)
      config: configValue(body.config),
      sortOrder: body.sortOrder ?? 0,
      isVisible: body.isVisible ?? true,
    },
  });
  return toSection(row);
}

export async function update(id: string, body: UpdateSectionBody): Promise<SectionResponse> {
  if (!OBJECT_ID.test(id)) throw notFound();
  try {
    const row = await prisma.$transaction(async (tx) => {
      const current = await tx.homeSection.findUnique({ where: { id } });
      if (!current) throw notFound();
      if (current.updatedAt.getTime() !== body.expectedUpdatedAt.getTime()) {
        throw staleUpdate(current);
      }
      const data: Prisma.HomeSectionUncheckedUpdateInput = {};
      if (body.type !== undefined) data.type = body.type;
      if (body.title !== undefined) data.title = body.title;
      if ('subtitle' in body) data.subtitle = body.subtitle ?? null;
      if ('config' in body) data.config = configValue(body.config);
      if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
      if (body.isVisible !== undefined) data.isVisible = body.isVisible;

      const res = await tx.homeSection.updateMany({
        where: { id, updatedAt: body.expectedUpdatedAt },
        data,
      });
      if (res.count !== 1) throw staleUpdate(current);
      return tx.homeSection.findUniqueOrThrow({ where: { id } });
    });
    return toSection(row);
  } catch (err) {
    if (isWriteConflict(err)) {
      const current = await prisma.homeSection.findUnique({ where: { id } });
      throw current ? staleUpdate(current) : notFound();
    }
    throw err;
  }
}

export async function remove(id: string): Promise<void> {
  if (!OBJECT_ID.test(id)) throw notFound();
  await prisma.$transaction(async (tx) => {
    const current = await tx.homeSection.findUnique({ where: { id } });
    if (!current) throw notFound();
    await tx.homeSection.delete({ where: { id } });
  });
}

/** `ids` must be exactly the set of existing section ids; `sortOrder` becomes the list position. */
export async function reorder(ids: string[]): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.homeSection.findMany({ select: { id: true } });
    const existingIds = new Set(existing.map((s) => s.id));
    if (ids.length !== existingIds.size || ids.some((id) => !existingIds.has(id))) {
      throw validation('ids must contain every existing section id exactly once');
    }
    for (const [index, id] of ids.entries()) {
      await tx.homeSection.update({ where: { id }, data: { sortOrder: index + 1 } });
    }
  });
}

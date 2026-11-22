import { Prisma, type Page } from '@prisma/client';
import { AppError } from '../../lib/errors.js';
import { prisma } from '../../lib/prisma.js';
import { sanitizePageHtml } from '../../lib/safeHtml.js';
import type { CreatePageBody, UpdatePageBody } from './schema.js';

const OBJECT_ID = /^[a-f0-9]{24}$/;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Page not found');
const validation = (message: string) => new AppError(422, 'VALIDATION_ERROR', message);
const isP2002 = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
const isWriteConflict = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
const slugTaken = () => new AppError(409, 'SLUG_TAKEN', 'Another page already uses this slug');

export const toPage = (p: Page) => ({
  id: p.id,
  slug: p.slug,
  title: p.title,
  content: p.content,
  metaTitle: p.metaTitle ?? null,
  metaDescription: p.metaDescription ?? null,
  isPublished: p.isPublished,
  updatedAt: p.updatedAt,
});
export type PageResponse = ReturnType<typeof toPage>;

const staleUpdate = (current: Page) =>
  new AppError(409, 'STALE_UPDATE', 'The page was changed by someone else; reload and retry', {
    current: toPage(current),
  });

type Localized = { en: string; ar: string };

/**
 * Publish gate (I18N-02, owner 2026-11-22), applied to the merged result AFTER sanitisation (content
 * that was only script collapses to empty and fails the gate): published needs title and content in
 * both locales, unpublished at least one non-empty locale each.
 */
function assertPublishGate(title: Localized, content: Localized, isPublished: boolean): void {
  const filled = (t: Localized) => Number(t.en.trim() !== '') + Number(t.ar.trim() !== '');
  for (const [field, text] of [
    ['title', title],
    ['content', content],
  ] as const) {
    if (isPublished && filled(text) < 2) {
      throw validation(`A published page needs ${field} in both en and ar (I18N-02)`);
    }
    if (filled(text) < 1) throw validation(`${field} needs at least one non-empty locale`);
  }
}

const sanitizeContent = (content: Localized): Localized => ({
  en: sanitizePageHtml(content.en),
  ar: sanitizePageHtml(content.ar),
});

export async function list(): Promise<PageResponse[]> {
  const rows = await prisma.page.findMany({ orderBy: [{ slug: 'asc' }] });
  return rows.map(toPage);
}

/** ADM-08 public read: published pages only, 404 otherwise. */
export async function getPublicBySlug(slug: string): Promise<PageResponse> {
  const row = await prisma.page.findUnique({ where: { slug } });
  if (!row || !row.isPublished) throw notFound();
  return toPage(row);
}

export async function create(body: CreatePageBody): Promise<PageResponse> {
  const content = sanitizeContent(body.content);
  const isPublished = body.isPublished ?? false;
  assertPublishGate(body.title, content, isPublished);
  try {
    const row = await prisma.page.create({
      data: {
        slug: body.slug,
        title: body.title,
        content,
        isPublished,
        // Optional fields are written as explicit null (null-vs-missing, CLAUDE.md rule 8).
        metaTitle: body.metaTitle ?? null,
        metaDescription: body.metaDescription ?? null,
      },
    });
    return toPage(row);
  } catch (err) {
    throw isP2002(err) ? slugTaken() : err;
  }
}

export async function update(
  id: string,
  body: UpdatePageBody,
): Promise<{ page: PageResponse; oldSlug: string }> {
  if (!OBJECT_ID.test(id)) throw notFound();
  try {
    const { row, oldSlug } = await prisma.$transaction(async (tx) => {
      const current = await tx.page.findUnique({ where: { id } });
      if (!current) throw notFound();
      if (current.updatedAt.getTime() !== body.expectedUpdatedAt.getTime()) {
        throw staleUpdate(current);
      }
      const content = body.content !== undefined ? sanitizeContent(body.content) : current.content;
      assertPublishGate(
        body.title ?? current.title,
        content,
        body.isPublished ?? current.isPublished,
      );

      const data: Prisma.PageUncheckedUpdateInput = {};
      if (body.slug !== undefined) data.slug = body.slug;
      if (body.title !== undefined) data.title = body.title;
      if (body.content !== undefined) data.content = content;
      if ('metaTitle' in body) data.metaTitle = body.metaTitle ?? null;
      if ('metaDescription' in body) data.metaDescription = body.metaDescription ?? null;
      if (body.isPublished !== undefined) data.isPublished = body.isPublished;

      const res = await tx.page.updateMany({
        where: { id, updatedAt: body.expectedUpdatedAt },
        data,
      });
      if (res.count !== 1) throw staleUpdate(current);
      const updated = await tx.page.findUniqueOrThrow({ where: { id } });
      return { row: updated, oldSlug: current.slug };
    });
    return { page: toPage(row), oldSlug };
  } catch (err) {
    if (isP2002(err)) throw slugTaken();
    if (isWriteConflict(err)) {
      const current = await prisma.page.findUnique({ where: { id } });
      throw current ? staleUpdate(current) : notFound();
    }
    throw err;
  }
}

export async function remove(id: string): Promise<{ slug: string }> {
  if (!OBJECT_ID.test(id)) throw notFound();
  let slug = '';
  await prisma.$transaction(async (tx) => {
    const current = await tx.page.findUnique({ where: { id } });
    if (!current) throw notFound();
    slug = current.slug;
    await tx.page.delete({ where: { id } });
  });
  return { slug };
}

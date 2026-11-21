import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_categories_crud_t009',
  );
});

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
let adminToken = '';
let customerToken = '';

const mkCategory = (slug: string, over: Record<string, unknown> = {}) =>
  prisma.category.create({
    data: {
      name: { en: `${slug} en`, ar: `${slug} ar` },
      slug,
      parentId: null,
      image: null,
      ...over,
    },
  });

const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token?: string) => {
  const r = request(app)[method](`/api/v1/admin/categories${path}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
};
const goodBody = (slug: string) => ({ name: { en: `${slug} en`, ar: `${slug} ar` }, slug });

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const hash = await hashPassword('Passw0rdOne');
  const admin = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'One',
      email: 'admin@example.com',
      passwordHash: hash,
      isVerified: true,
      role: 'ADMIN',
    },
  });
  const customer = await prisma.user.create({
    data: {
      firstName: 'Cust',
      lastName: 'One',
      email: 'cust@example.com',
      passwordHash: hash,
      isVerified: true,
    },
  });
  adminToken = signAccessToken(admin);
  customerToken = signAccessToken(customer);
});
async function wipeCategories() {
  await prisma.product.deleteMany();
  // Clear self-references first: Prisma's emulated relation action refuses to delete referenced parents.
  await prisma.category.updateMany({ data: { parentId: null } });
  await prisma.category.deleteMany();
}
beforeEach(wipeCategories);
afterAll(async () => {
  await wipeCategories();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('ADM-03 · access control', () => {
  it('ADM-03 · anonymous gets 401 and a customer gets 403 on every admin category route', async () => {
    const routes: ['get' | 'post' | 'patch' | 'delete', string][] = [
      ['get', ''],
      ['post', ''],
      ['patch', '/0123456789abcdef01234567'],
      ['delete', '/0123456789abcdef01234567'],
    ];
    for (const [method, path] of routes) {
      const anon = await api(method, path).send(goodBody('x'));
      expect(anon.status, `anon ${method}`).toBe(401);
      const cust = await api(method, path, customerToken).send(goodBody('x'));
      expect(cust.status, `customer ${method}`).toBe(403);
      expect(cust.body.code).toBe('FORBIDDEN');
    }
  });
});

describe('ADM-03 · create', () => {
  it('ADM-03 · create with name, slug, parent, sortOrder and isActive returns 201 matching the spec', async () => {
    const root = await api('post', '', adminToken).send({
      ...goodBody('living-room'),
      sortOrder: 3,
      isActive: false,
    });
    expect(root.status).toBe(201);
    expect(root.body).toMatchObject({
      name: { en: 'living-room en', ar: 'living-room ar' },
      slug: 'living-room',
      parentId: null,
      image: null,
      sortOrder: 3,
      isActive: false,
    });
    expect(root.body.id).toMatch(/^[a-f0-9]{24}$/);

    const child = await api('post', '', adminToken).send({
      ...goodBody('sofas'),
      parentId: root.body.id,
    });
    expect(child.status).toBe(201);
    expect(child.body.parentId).toBe(root.body.id);
    // Defaults apply when omitted.
    expect(child.body.sortOrder).toBe(0);
    expect(child.body.isActive).toBe(true);
  });

  it('ADM-03 · duplicate slug returns 409 SLUG_TAKEN on create and on update', async () => {
    await mkCategory('bedroom');
    const other = await mkCategory('dining');
    const create = await api('post', '', adminToken).send(goodBody('bedroom'));
    expect(create.status).toBe(409);
    expect(create.body.code).toBe('SLUG_TAKEN');
    const update = await api('patch', `/${other.id}`, adminToken).send({ slug: 'bedroom' });
    expect(update.status).toBe(409);
    expect(update.body.code).toBe('SLUG_TAKEN');
    // Nothing changed.
    expect((await prisma.category.findUniqueOrThrow({ where: { id: other.id } })).slug).toBe(
      'dining',
    );
  });

  it('ADM-03 · invalid body returns 422 VALIDATION_ERROR (missing ar name, bad slug, unknown field, negative sortOrder)', async () => {
    const bodies: Record<string, unknown>[] = [
      { name: { en: 'Only English' }, slug: 'x1' },
      { ...goodBody('Bad Slug') },
      { ...goodBody('x2'), productCount: 5 },
      { ...goodBody('x3'), sortOrder: -1 },
      { ...goodBody('x4'), image: { key: 'k', url: 'https://evil.example/own-url.webp' } },
    ];
    for (const body of bodies) {
      const res = await api('post', '', adminToken).send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    expect(await prisma.category.count()).toBe(0);
  });
});

describe('ADM-03 · list', () => {
  it('ADM-03 · admin list returns all categories incl. inactive, flat, with productCount', async () => {
    const active = await mkCategory('living-room', { sortOrder: 1 });
    const inactive = await mkCategory('outdoor', { isActive: false, sortOrder: 2 });
    await prisma.product.create({
      data: {
        title: { en: 'Sofa', ar: 'أريكة' },
        description: { en: 'd', ar: 'د' },
        slug: 'sofa-1',
        type: 'NEW',
        condition: 'NEW',
        price: 10000,
        stock: 1,
        categoryId: active.id,
        status: 'ARCHIVED', // archived products still count (delete guard)
      },
    });
    const res = await api('get', '', adminToken);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const bySlug: Record<string, Record<string, unknown>> = Object.fromEntries(
      res.body.map((c: { slug: string }) => [c.slug, c]),
    );
    expect(bySlug['living-room']!.productCount).toBe(1);
    expect(bySlug['outdoor']!.productCount).toBe(0);
    expect(bySlug['outdoor']!.isActive).toBe(false);
    expect(bySlug['outdoor']!.id).toBe(inactive.id);
    expect(bySlug['living-room']!.children).toBeUndefined();
  });
});

describe('ADM-03 · update', () => {
  it('ADM-03 · patch updates fields; an empty body returns 422', async () => {
    const cat = await mkCategory('living-room');
    const res = await api('patch', `/${cat.id}`, adminToken).send({
      name: { en: 'Living room', ar: 'غرفة المعيشة' },
      sortOrder: 7,
      isActive: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.name.ar).toBe('غرفة المعيشة');
    expect(res.body.sortOrder).toBe(7);
    expect(res.body.isActive).toBe(false);
    const empty = await api('patch', `/${cat.id}`, adminToken).send({});
    expect(empty.status).toBe(422);
  });

  it('ADM-03 · one level only: sub-sub-category, self-parent, unknown parent, and parenting a category with children are rejected (422)', async () => {
    const root = await mkCategory('living-room');
    const child = await mkCategory('sofas', { parentId: root.id });
    const grandchild = await api('post', '', adminToken).send({
      ...goodBody('sofa-beds'),
      parentId: child.id,
    });
    expect(grandchild.status).toBe(422);

    const self = await api('patch', `/${root.id}`, adminToken).send({ parentId: root.id });
    expect(self.status).toBe(422);

    const unknownParent = await api('post', '', adminToken).send({
      ...goodBody('x5'),
      parentId: '0123456789abcdef01234567',
    });
    expect(unknownParent.status).toBe(422);

    // `root` has a child, so it cannot itself become a child.
    const other = await mkCategory('bedroom');
    const reparent = await api('patch', `/${root.id}`, adminToken).send({ parentId: other.id });
    expect(reparent.status).toBe(422);

    // Clearing the parent is allowed.
    const clear = await api('patch', `/${child.id}`, adminToken).send({ parentId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.parentId).toBeNull();
  });

  it('ADM-03 · unknown and malformed ids return 404 NOT_FOUND', async () => {
    for (const id of ['0123456789abcdef01234567', 'not-an-id']) {
      const patch = await api('patch', `/${id}`, adminToken).send({ sortOrder: 1 });
      expect(patch.status, `patch ${id}`).toBe(404);
      expect(patch.body.code).toBe('NOT_FOUND');
      const del = await api('delete', `/${id}`, adminToken);
      expect(del.status, `delete ${id}`).toBe(404);
    }
  });
});

describe('ADM-03 · delete', () => {
  it('ADM-03 · delete with products returns 409 CATEGORY_HAS_PRODUCTS and keeps the category', async () => {
    const cat = await mkCategory('living-room');
    await prisma.product.create({
      data: {
        title: { en: 'Sofa', ar: 'أريكة' },
        description: { en: 'd', ar: 'د' },
        slug: 'sofa-2',
        type: 'RESALE',
        condition: 'GOOD',
        price: 5000,
        categoryId: cat.id,
      },
    });
    const res = await api('delete', `/${cat.id}`, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CATEGORY_HAS_PRODUCTS');
    expect(await prisma.category.count()).toBe(1);
  });

  it('ADM-03 · delete with sub-categories returns 409 CATEGORY_HAS_CHILDREN', async () => {
    const root = await mkCategory('living-room');
    await mkCategory('sofas', { parentId: root.id });
    const res = await api('delete', `/${root.id}`, adminToken);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CATEGORY_HAS_CHILDREN');
    expect(await prisma.category.count()).toBe(2);
  });

  it('ADM-03 · delete of an empty category returns 204 and it leaves both lists', async () => {
    const cat = await mkCategory('outdoor');
    const res = await api('delete', `/${cat.id}`, adminToken);
    expect(res.status).toBe(204);
    expect(await prisma.category.count()).toBe(0);
    expect((await api('get', '', adminToken)).body).toEqual([]);
    expect((await request(app).get('/api/v1/categories')).body).toEqual([]);
  });
});

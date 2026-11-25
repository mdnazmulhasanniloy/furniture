import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Own database to avoid races with other test files.
vi.hoisted(() => {
  process.env.DATABASE_URL = (process.env.TEST_DATABASE_URL ?? '').replace(
    'furnixa_test',
    'furnixa_cms_appearance_t086',
  );
});
vi.mock('../../src/lib/revalidate.js', () => ({ revalidateTags: vi.fn(async () => {}) }));

import { createApp } from '../../src/app.js';
import { hashPassword } from '../../src/lib/password.js';
import { prisma } from '../../src/lib/prisma.js';
import { revalidateTags } from '../../src/lib/revalidate.js';
import {
  THEMES,
  THEME_IDS,
  THEME_TOKEN_KEYS,
  resolveTheme,
  type ThemeTokens,
} from '../../src/lib/themes.js';
import { signAccessToken } from '../../src/lib/tokens.js';

const app = createApp();
const revalidateMock = vi.mocked(revalidateTags);
let adminToken = '';
let customerToken = '';

const APPEARANCE = '/api/v1/admin/settings/appearance';
const getAppearance = () =>
  request(app).get(APPEARANCE).set('Authorization', `Bearer ${adminToken}`);
const patchAppearance = () =>
  request(app).patch(APPEARANCE).set('Authorization', `Bearer ${adminToken}`);

const cities = [
  {
    code: 'riyadh',
    name: { en: 'Riyadh', ar: 'الرياض' },
    isActive: true,
    sortOrder: 1,
    deliveryFee: null,
  },
];

/** Deliberately built WITHOUT the theme fields: documents written before CR-010 look like this (rule 8). */
async function seedSettings(extra: Record<string, unknown> = {}) {
  return prisma.siteSetting.create({
    data: {
      key: 'default',
      storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
      contactEmail: 'seed@furnixa.test',
      contactPhone: '+966500000000',
      logo: null,
      address: null,
      freeDeliveryThreshold: null,
      vat: { vatRate: 0, applyToDelivery: true, pricesIncludeVat: true, registrationNumber: null },
      deliveryCities: cities,
      ...extra,
    },
  });
}

beforeAll(async () => {
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    env: { ...process.env },
    stdio: 'pipe',
  });
  const passwordHash = await hashPassword('Passw0rdOne!');
  const admin = await prisma.user.create({
    data: {
      firstName: 'Admin',
      lastName: 'One',
      email: 'admin@example.com',
      passwordHash,
      isVerified: true,
      role: 'ADMIN',
    },
  });
  const customer = await prisma.user.create({
    data: {
      firstName: 'Cust',
      lastName: 'One',
      email: 'cust@example.com',
      passwordHash,
      isVerified: true,
    },
  });
  adminToken = signAccessToken(admin);
  customerToken = signAccessToken(customer);
});
beforeEach(async () => {
  revalidateMock.mockClear();
  await prisma.siteSetting.deleteMany();
});
afterAll(async () => {
  await prisma.siteSetting.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

// ----------------------------------------------------------------- the registry and its AA gate

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
/** Same relative-luminance formula as web/src/test/ui-02-aa-contrast.test.ts and the admin gate. */
const lum = ([r, g, b]: RGB) => {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(rgb(a)), lum(rgb(b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Fixed in every preset (ADR-017, owner 2026-11-24): paper and ink never change. */
const PAPER = '#ffffff';
const INK = '#14201d';

/** [label, foreground, background, minimum] for one preset, on all three surfaces. */
function checksFor(t: ThemeTokens): [string, string, string, number][] {
  const surfaces: [string, string][] = [
    ['paper', PAPER],
    ['muted', t.muted],
    ['blush', t.blush],
  ];
  const out: [string, string, string, number][] = [];
  for (const [name, surface] of surfaces) {
    // Text: 4.5:1.
    out.push([`ink on ${name}`, INK, surface, 4.5]);
    out.push([`muted text on ${name}`, t.mutedForeground, surface, 4.5]);
    out.push([`price on ${name}`, t.price, surface, 4.5]);
    out.push([`primary text on ${name}`, t.primary, surface, 4.5]);
    // Graphics: 3:1.
    out.push([`ring on ${name}`, t.ring, surface, 3]);
    out.push([`gold-strong on ${name}`, t.goldStrong, surface, 3]);
    out.push([`stone icon on ${name}`, t.stone, surface, 3]);
  }
  out.push(['on-primary on primary', t.primaryForeground, t.primary, 4.5]);
  out.push(['field border on paper', t.input, PAPER, 3]);
  out.push(['gold hairline on primary (footer)', t.gold, t.primary, 3]);
  out.push(['surface text on primary (footer)', t.muted, t.primary, 4.5]);
  out.push(['ink on gold (decorative)', INK, t.gold, 4.5]);
  out.push(['ink on champagne (decorative)', INK, t.champagne, 4.5]);
  return out;
}

describe('UI-03 · theme preset registry', () => {
  it('UI-03 · every preset passes the AA gate on paper, muted and blush', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const preset of THEMES) {
      for (const [label, fg, bg, min] of checksFor(preset.tokens)) {
        checked += 1;
        const r = ratio(fg, bg);
        if (r < min) failures.push(`${preset.id}: ${label} ${r.toFixed(2)} < ${min}`);
      }
    }
    expect(failures).toEqual([]);
    // 5 presets x 27 checks: a new preset is gated by the same arithmetic, not by eye.
    expect(checked).toBe(135);
  });

  it('UI-03 · every preset carries all 14 tokens as #rrggbb, with secondary mirroring muted', () => {
    expect(THEMES.map((t) => t.id)).toEqual([...THEME_IDS]);
    expect(THEME_IDS[0]).toBe('emerald'); // the default and the current look
    expect(THEME_TOKEN_KEYS).toHaveLength(14);
    for (const preset of THEMES) {
      expect(Object.keys(preset.tokens).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
      for (const [key, value] of Object.entries(preset.tokens)) {
        expect(value, `${preset.id}.${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
      // The sand surface and --secondary are the same colour everywhere (design-system section 1b).
      expect(preset.tokens.secondary).toBe(preset.tokens.muted);
      expect(preset.tokens.primaryForeground).toBe('#ffffff');
      expect(preset.name.en.length).toBeGreaterThan(0);
      expect(preset.name.ar).toMatch(/[؀-ۿ]/);
    }
  });

  it('UI-03 · ink, paper and the status colours are not themeable', () => {
    for (const forbidden of [
      'background',
      'foreground',
      'card',
      'destructive',
      'success',
      'warning',
      'goldForeground',
      'blushForeground',
    ]) {
      expect(THEME_TOKEN_KEYS as readonly string[]).not.toContain(forbidden);
    }
  });

  it('UI-03 · resolveTheme answers emerald for null, undefined and an unknown id', () => {
    expect(resolveTheme('walnut').id).toBe('walnut');
    expect(resolveTheme(null).id).toBe('emerald');
    expect(resolveTheme(undefined).id).toBe('emerald');
    expect(resolveTheme('indigo').id).toBe('emerald'); // the preset that was dropped for Burgundy
    expect(resolveTheme('').id).toBe('emerald');
  });
});

// ----------------------------------------------------------------- the endpoints

describe('ADM-16 · appearance endpoints', () => {
  it('ADM-16 · GET returns the applied id, the updatedAt to send back and every preset', async () => {
    const seeded = await seedSettings();
    await request(app).get(APPEARANCE).expect(401);
    await request(app).get(APPEARANCE).set('Authorization', `Bearer ${customerToken}`).expect(403);

    const res = await getAppearance().expect(200);
    expect(res.body.themeId).toBe('emerald');
    expect(res.body.themeUpdatedAt).toBeNull();
    expect(new Date(res.body.updatedAt).getTime()).toBe(seeded.updatedAt.getTime());
    expect(res.body.presets.map((p: { id: string }) => p.id)).toEqual([...THEME_IDS]);
    const walnut = res.body.presets.find((p: { id: string }) => p.id === 'walnut');
    expect(walnut.name).toEqual({ en: 'Walnut', ar: 'الجوز' });
    expect(walnut.tokens.primary).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('ADM-16 · PATCH applies a theme, records who and when, and revalidates the storefront', async () => {
    const seeded = await seedSettings();
    await request(app).patch(APPEARANCE).send({ themeId: 'walnut' }).expect(401);
    await request(app)
      .patch(APPEARANCE)
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ themeId: 'walnut', expectedUpdatedAt: seeded.updatedAt.toISOString() })
      .expect(403);

    const res = await patchAppearance()
      .send({ themeId: 'walnut', expectedUpdatedAt: seeded.updatedAt.toISOString() })
      .expect(200);
    expect(res.body.themeId).toBe('walnut');
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThan(seeded.updatedAt.getTime());

    const row = await prisma.siteSetting.findUniqueOrThrow({ where: { key: 'default' } });
    expect(row.themeId).toBe('walnut');
    expect(row.themeUpdatedById).toBeTruthy();
    expect(row.themeUpdatedAt).toBeInstanceOf(Date);
    expect(res.body.themeUpdatedAt).not.toBeNull();
    // Colours show on product pages too, so the same tags as a settings save.
    expect(revalidateMock).toHaveBeenCalledWith(
      ['settings', 'home', 'products'],
      expect.anything(),
    );
  });

  it('ADM-16 · a bad body is refused with 422 and nothing is written', async () => {
    const seeded = await seedSettings();
    const at = seeded.updatedAt.toISOString();
    const bodies: Record<string, unknown>[] = [
      { themeId: 'indigo', expectedUpdatedAt: at }, // not a preset
      { themeId: 'EMERALD', expectedUpdatedAt: at }, // ids are lower case
      { themeId: 7, expectedUpdatedAt: at },
      { expectedUpdatedAt: at }, // missing
      { themeId: 'walnut' }, // no expectedUpdatedAt
      { themeId: 'walnut', expectedUpdatedAt: at, tokens: { primary: '#000000' } }, // colours are code
    ];
    for (const body of bodies) {
      const res = await patchAppearance().send(body);
      expect(res.status, JSON.stringify(body)).toBe(422);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    }
    const row = await prisma.siteSetting.findUniqueOrThrow({ where: { key: 'default' } });
    expect(row.themeId ?? null).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('ADM-16 · a stale expectedUpdatedAt is 409 STALE_UPDATE and changes nothing', async () => {
    const seeded = await seedSettings();
    const stale = new Date(seeded.updatedAt.getTime() - 1000).toISOString();
    const res = await patchAppearance()
      .send({ themeId: 'charcoal', expectedUpdatedAt: stale })
      .expect(409);
    expect(res.body.code).toBe('STALE_UPDATE');
    expect(res.body.details.current.storeName.en).toBe('Furnixa');
    const row = await prisma.siteSetting.findUniqueOrThrow({ where: { key: 'default' } });
    expect(row.themeId ?? null).toBeNull();
    expect(revalidateMock).not.toHaveBeenCalled();
  });

  it('ADM-16 · the full-replace PUT leaves the theme alone', async () => {
    const seeded = await seedSettings({ themeId: 'burgundy' });
    const res = await request(app)
      .put('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        expectedUpdatedAt: seeded.updatedAt.toISOString(),
        storeName: { en: 'Furnixa', ar: 'فرنيكسا' },
        contactEmail: 'info@furnixa.test',
        contactPhone: '0500000000',
        deliveryFee: 1500,
        freeDeliveryThreshold: null,
        vat: {
          vatRate: 0,
          applyToDelivery: true,
          pricesIncludeVat: true,
          registrationNumber: null,
        },
        deliveryCities: cities,
        defaultLocale: 'ar',
      })
      .expect(200);
    expect(res.body.theme.id).toBe('burgundy');
    const row = await prisma.siteSetting.findUniqueOrThrow({ where: { key: 'default' } });
    expect(row.themeId).toBe('burgundy');
  });
});

describe('UI-03 · the storefront payload', () => {
  it('UI-03 · GET /cms/settings carries the applied id and its token map', async () => {
    await seedSettings({ themeId: 'sand' });
    const res = await request(app).get('/api/v1/cms/settings').expect(200);
    expect(res.body.theme.id).toBe('sand');
    expect(Object.keys(res.body.theme.tokens).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
    const sand = THEMES.find((t) => t.id === 'sand')!;
    expect(res.body.theme.tokens).toEqual(sand.tokens);
    // The registry is code: no colour value is ever stored.
    const row = await prisma.siteSetting.findUniqueOrThrow({ where: { key: 'default' } });
    expect(JSON.stringify(row)).not.toContain(sand.tokens.primary);
  });

  it('UI-03 · a document saved before CR-010 and an unknown id both read as emerald', async () => {
    await seedSettings(); // no themeId field at all (rule 8)
    const emerald = THEMES[0]!;
    const before = await request(app).get('/api/v1/cms/settings').expect(200);
    expect(before.body.theme).toEqual({ id: 'emerald', tokens: emerald.tokens });

    await prisma.siteSetting.update({
      where: { key: 'default' },
      data: { themeId: 'retired-preset' },
    });
    const after = await request(app).get('/api/v1/cms/settings').expect(200);
    expect(after.body.theme).toEqual({ id: 'emerald', tokens: emerald.tokens });
    // The admin tab shows the fallback too, so the owner never sees a theme that is not applied.
    expect((await getAppearance().expect(200)).body.themeId).toBe('emerald');
  });
});

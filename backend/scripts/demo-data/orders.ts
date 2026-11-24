import { randomUUID } from 'node:crypto';
import type { OrderStatus, Prisma, PrismaClient } from '@prisma/client';
import { computePricing } from '../../src/lib/pricing.js';
import { nextOrderNo } from '../../src/modules/orders/service.js';
import type { SeededCustomer, SeededProduct } from './seed.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Deterministic PRNG (mulberry32) so a re-run produces the same shape of data. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Kind =
  | 'DELIVERED'
  | 'CANCELLED_REFUSED' // COD refused at the door
  | 'CANCELLED_EARLY'
  | 'OUT_FOR_DELIVERY'
  | 'PROCESSING'
  | 'CONFIRMED'
  | 'PENDING';

/** 40 orders: 17 delivered, 6 cancelled (3 refused at the door), 17 in progress. */
const PLAN: [Kind, number][] = [
  ['DELIVERED', 17],
  ['CANCELLED_REFUSED', 3],
  ['CANCELLED_EARLY', 3],
  ['OUT_FOR_DELIVERY', 3],
  ['PROCESSING', 4],
  ['CONFIRMED', 4],
  ['PENDING', 6],
];

const PATH: Record<Exclude<Kind, 'CANCELLED_EARLY'>, OrderStatus[]> = {
  DELIVERED: ['PENDING', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  CANCELLED_REFUSED: ['PENDING', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['PENDING', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY'],
  PROCESSING: ['PENDING', 'CONFIRMED', 'PROCESSING'],
  CONFIRMED: ['PENDING', 'CONFIRMED'],
  PENDING: ['PENDING'],
};

/** How many days ago an order of this kind is placed (min, max). Delivered orders fill the 30-day chart. */
const AGE_DAYS: Record<Kind, [number, number]> = {
  DELIVERED: [6, 30],
  CANCELLED_REFUSED: [5, 25],
  CANCELLED_EARLY: [2, 25],
  OUT_FOR_DELIVERY: [1.5, 4],
  PROCESSING: [1, 3.5],
  CONFIRMED: [0.5, 2.5],
  PENDING: [0.05, 2],
};

export interface OrdersContext {
  adminId: string;
  customers: SeededCustomer[];
  products: SeededProduct[];
  now: Date;
  seed?: number;
  log: (message: string) => void;
}

export interface SeededOrder {
  orderNo: string;
  status: OrderStatus;
  total: number;
}

/**
 * Creates ~40 backdated orders through the real pricing function (`computePricing`) with the live SiteSetting
 * and the delivery city's fee, so totals, VAT and snapshots match what checkout would have stored.
 * Product stock is not decremented: the catalogue invariants (resale 1, new 3-20) stay intact.
 */
export async function seedOrders(prisma: PrismaClient, ctx: OrdersContext): Promise<SeededOrder[]> {
  const rand = rng(ctx.seed ?? 20_261_124);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
  const between = (min: number, max: number) => min + rand() * (max - min);

  const settings = await prisma.siteSetting.findUnique({ where: { key: 'default' } });
  if (!settings) throw new Error('SiteSetting is missing: run "npm run seed" first.');

  const buyable = ctx.products.filter(
    (p) => p.status === 'PUBLISHED' && p.type === 'NEW' && p.stock >= 3,
  );
  const soldOut = ctx.products.filter((p) => p.status === 'PUBLISHED' && p.stock === 0);

  type Planned = { kind: Kind; createdAt: Date };
  const planned: Planned[] = PLAN.flatMap(([kind, n]) =>
    Array.from({ length: n }, () => {
      const [lo, hi] = AGE_DAYS[kind];
      return { kind, createdAt: new Date(ctx.now.getTime() - between(lo, hi) * DAY_MS) };
    }),
  ).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  // The sold-out pieces were bought: attach them to the first two delivered orders.
  const soldOutQueue = [...soldOut];
  const out: SeededOrder[] = [];

  for (const { kind, createdAt } of planned) {
    const customer = pick(ctx.customers);
    const city = settings.deliveryCities.find((c) => c.code === customer.address.cityCode);
    const cityName = city?.name ?? { en: customer.address.cityCode, ar: customer.address.cityCode };

    const chosen: { product: SeededProduct; qty: number }[] = [];
    if (kind === 'DELIVERED' && soldOutQueue.length > 0) {
      chosen.push({ product: soldOutQueue.shift()!, qty: 1 });
    }
    const extra = 1 + Math.floor(rand() * 2);
    while (chosen.length < Math.max(1, extra)) {
      const product = pick(buyable);
      if (!chosen.some((c) => c.product.id === product.id)) {
        chosen.push({ product, qty: 1 + Math.floor(rand() * 2) });
      }
    }

    const pricing = computePricing({
      lines: chosen.map((c) => ({ unitPrice: c.product.price, qty: c.qty })),
      city: { deliveryFee: city?.deliveryFee ?? null },
      settings: {
        deliveryFee: settings.deliveryFee,
        freeDeliveryThreshold: settings.freeDeliveryThreshold ?? null,
        vat: {
          vatRate: settings.vat.vatRate,
          applyToDelivery: settings.vat.applyToDelivery,
          pricesIncludeVat: settings.vat.pricesIncludeVat,
          registrationNumber: settings.vat.registrationNumber ?? null,
        },
      },
    });

    const path =
      kind === 'CANCELLED_EARLY'
        ? rand() < 0.5
          ? (['PENDING', 'CANCELLED'] as OrderStatus[])
          : (['PENDING', 'CONFIRMED', 'CANCELLED'] as OrderStatus[])
        : PATH[kind];
    const refused = kind === 'CANCELLED_REFUSED';
    let at = createdAt.getTime();
    const history = path.map((status, i) => {
      if (i > 0) at = Math.min(at + between(2, 20) * HOUR_MS, ctx.now.getTime() - 60_000);
      const byCustomer =
        i === 0 || (kind === 'CANCELLED_EARLY' && status === 'CANCELLED' && rand() < 0.5);
      return {
        status,
        at: new Date(at),
        byUserId: byCustomer ? customer.id : ctx.adminId,
        note:
          status === 'CANCELLED'
            ? refused
              ? 'Refused at the door (COD): the customer declined the delivery'
              : 'Cancelled before dispatch'
            : null,
      };
    });
    const status = path[path.length - 1]!;
    const orderNo = await nextOrderNo(createdAt);

    const items: Prisma.OrderItemCreateInput[] = chosen.map((c, i) => ({
      productId: c.product.id,
      titleSnapshot: c.product.title,
      sku: c.product.sku,
      imageSnapshot: c.product.images[0]?.url ?? null,
      imageKey: c.product.images[0]?.key ?? null,
      unitPrice: c.product.price,
      qty: c.qty,
      lineTotal: pricing.lines[i]!.lineTotal,
      type: c.product.type,
      condition: c.product.condition,
    }));

    await prisma.order.create({
      data: {
        orderNo,
        userId: customer.id,
        idempotencyKey: randomUUID(),
        addressId: customer.addressId,
        items,
        address: {
          fullName: customer.address.fullName,
          phone: customer.address.phone,
          cityCode: customer.address.cityCode,
          city: cityName,
          area: customer.address.area,
          street: customer.address.street,
          notes: null,
        },
        subtotal: pricing.subtotal,
        deliveryFee: pricing.deliveryFee,
        vat: pricing.vat,
        total: pricing.total,
        currency: 'SAR',
        paymentMethod: 'COD',
        paymentStatus: status === 'DELIVERED' ? 'PAID' : 'UNPAID',
        status,
        statusHistory: history,
        customerNote: rand() < 0.25 ? 'Please call before delivery' : null,
        adminNote: refused ? 'COD refused at the door' : null,
        createdAt,
        updatedAt: history[history.length - 1]!.at,
      },
    });
    out.push({ orderNo, status, total: pricing.total });
  }
  ctx.log(`orders: ${out.length}`);
  return out;
}

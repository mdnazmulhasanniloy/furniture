import { prisma } from '../../lib/prisma.js';
import { addDays, riyadhYmd, startOfRiyadhDay, startOfRiyadhMonth } from '../../lib/riyadhTime.js';
import { toOrder, USER_INCLUDE } from '../orders/service.js';

/** ADM-01: products with stock at or below this count as "low stock". */
export const LOW_STOCK_THRESHOLD = 2;
const SERIES_DAYS = 30;
const LATEST_COUNT = 5;

/**
 * ADM-01 (T-018). All day/month boundaries are Asia/Riyadh calendar days (fixed UTC+3, T-014
 * convention). Money is integer halalas summed by MongoDB (`_sum` over `Order.total`) — no float
 * arithmetic touches it. `monthRevenue` keys on the DELIVERED status event, so an order created
 * last month but delivered this month counts, and one delivered last month does not.
 */
export async function dashboardSummary() {
  const now = new Date();
  const todayStart = startOfRiyadhDay(now);
  const tomorrowStart = addDays(todayStart, 1);
  const monthStart = startOfRiyadhMonth(now);
  const seriesStart = addDays(todayStart, -(SERIES_DAYS - 1));

  const [todayOrders, pendingOrders, revenue, lowStockCount, seriesRows, latest] =
    await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: todayStart, lt: tomorrowStart } } }),
      prisma.order.count({ where: { status: 'PENDING' } }),
      prisma.order.aggregate({
        _sum: { total: true },
        where: {
          status: 'DELIVERED',
          statusHistory: { some: { status: 'DELIVERED', at: { gte: monthStart } } },
        },
      }),
      prisma.product.count({
        where: { status: 'PUBLISHED', stock: { lte: LOW_STOCK_THRESHOLD } },
      }),
      prisma.order.findMany({
        where: { createdAt: { gte: seriesStart } },
        select: { createdAt: true },
      }),
      prisma.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: LATEST_COUNT,
        include: USER_INCLUDE,
      }),
    ]);

  // Zero-filled buckets for the last 30 Riyadh days, oldest first.
  const buckets = new Map<string, number>();
  for (let i = 0; i < SERIES_DAYS; i += 1) buckets.set(riyadhYmd(addDays(seriesStart, i)), 0);
  for (const { createdAt } of seriesRows) {
    const day = riyadhYmd(createdAt);
    const count = buckets.get(day);
    if (count !== undefined) buckets.set(day, count + 1);
  }

  return {
    todayOrders,
    pendingOrders,
    monthRevenue: revenue._sum.total ?? 0,
    lowStockCount,
    ordersByDay: [...buckets].map(([date, count]) => ({ date, count })),
    latestOrders: latest.map(toOrder),
  };
}

/**
 * Asia/Riyadh calendar helpers (T-014/T-018 convention). Riyadh is fixed UTC+3 with no DST, so
 * every conversion is a constant offset — no timezone database needed. Pure date arithmetic on
 * millisecond integers; nothing here touches money.
 */

const RIYADH_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 86_400_000;

/** The instant the Riyadh day `YYYY-MM-DD` starts. */
export const riyadhDayStart = (ymd: string): Date => new Date(`${ymd}T00:00:00+03:00`);

/** The Riyadh calendar date of an instant, as `YYYY-MM-DD`. */
export const riyadhYmd = (at: Date): string =>
  new Date(at.getTime() + RIYADH_OFFSET_MS).toISOString().slice(0, 10);

/** The instant the Riyadh day containing `at` starts. */
export const startOfRiyadhDay = (at: Date): Date => riyadhDayStart(riyadhYmd(at));

/** The instant the Riyadh month containing `at` starts. */
export const startOfRiyadhMonth = (at: Date): Date =>
  riyadhDayStart(`${riyadhYmd(at).slice(0, 8)}01`);

/** Whole days added to an instant (a Riyadh day is always exactly 24 h — no DST). */
export const addDays = (at: Date, days: number): Date => new Date(at.getTime() + days * DAY_MS);

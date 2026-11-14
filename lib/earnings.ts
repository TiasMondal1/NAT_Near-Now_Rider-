/**
 * Earnings tab data (2026-11-14). Plain TS — no React Native imports — so
 * scripts/check-earnings.mjs can run it in Node.
 *
 * The totals come from GET /delivery-partner/earnings/summary, worked out on
 * the server (backend/src/utils/riderEarnings.ts) in one call. The tab used
 * to download the rider's whole delivery history on every visit and add it
 * up here. The rules are unchanged:
 *  - an order earns its payout amount, or 0 with no payout row (deliveries
 *    from before payouts were recorded — "legacy");
 *  - it is dated by when the payout was recorded, else by placed_at;
 *  - Today = since this phone's midnight, Last 7 Days = since now − 7 days;
 *  - the average divides by deliveries that HAVE a payout row.
 *
 * `summariseLocally` applies the same rules on the phone, only as a fallback
 * for a backend that doesn't have the endpoint yet (it answers 404).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type EarningsRow = {
  id: string;
  order_code: string | null;
  placed_at: string;
  stores?: { name: string } | null;
  /** Payout for this order (flat fee + tip); null when no payout row exists (legacy). */
  payout_amount: number | null;
  /** When the payout row was written (delivery/settlement time); null for legacy orders. */
  payout_created_at: string | null;
};

export type EarningsBucket = {
  deliveries: number;
  earnings: number;
  /** Deliveries with a payout row — the divisor for the average. */
  payout_known: number;
};

export type EarningsSummary = { today: EarningsBucket; week: EarningsBucket; all: EarningsBucket };

export type EarningsSummaryResponse = {
  success: boolean;
  window?: { today_start: string; week_start: string };
  summary: EarningsSummary;
  /** Deliveries dated inside the 7-day window, newest placed first. */
  recent: EarningsRow[];
};

export type EarningsWindow = { todayStart: number; weekStart: number };

/** When the rider was paid for this order (placed_at for legacy orders). */
export function earningDate(o: Pick<EarningsRow, "payout_created_at" | "placed_at">): Date {
  return new Date(o.payout_created_at ?? o.placed_at);
}

/** This phone's midnight, and the start of the rolling 7-day window. */
export function earningsWindow(now: number): EarningsWindow {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return { todayStart: midnight.getTime(), weekStart: now - 7 * DAY_MS };
}

export function summaryPath(win: EarningsWindow): string {
  const q = (t: number) => encodeURIComponent(new Date(t).toISOString());
  return `/delivery-partner/earnings/summary?today_start=${q(win.todayStart)}&week_start=${q(win.weekStart)}`;
}

/** The Today list: the 7-day rows dated since `todayStart`. */
export function todayRows(recent: readonly EarningsRow[], todayStart: number): EarningsRow[] {
  return recent.filter((r) => earningDate(r).getTime() >= todayStart);
}

const emptyBucket = (): EarningsBucket => ({ deliveries: 0, earnings: 0, payout_known: 0 });

/** Fallback only — see the header. Same output as the server's summariseRiderEarnings. */
export function summariseLocally(
  orders: readonly EarningsRow[],
  win: EarningsWindow
): { summary: EarningsSummary; recent: EarningsRow[] } {
  const summary: EarningsSummary = { today: emptyBucket(), week: emptyBucket(), all: emptyBucket() };
  const recent: EarningsRow[] = [];
  const add = (b: EarningsBucket, amount: number | null) => {
    b.deliveries += 1;
    if (amount != null) {
      b.earnings += amount;
      b.payout_known += 1;
    }
  };
  for (const o of orders) {
    const amount = o.payout_amount != null && Number.isFinite(o.payout_amount) ? o.payout_amount : null;
    const datedAt = earningDate(o).getTime();
    add(summary.all, amount);
    if (!Number.isFinite(datedAt)) continue;
    if (datedAt >= win.weekStart) {
      add(summary.week, amount);
      recent.push(o);
    }
    if (datedAt >= win.todayStart) add(summary.today, amount);
  }
  for (const b of [summary.today, summary.week, summary.all]) b.earnings = Math.round(b.earnings * 100) / 100;
  return { summary, recent };
}

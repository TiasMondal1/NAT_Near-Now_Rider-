/**
 * Plain-Node checks for lib/earnings.ts (the Earnings tab's data).
 *
 *   node scripts/check-earnings.mjs
 *
 * The fixture is the one in backend/src/utils/riderEarnings.test.ts, so the
 * phone-side fallback (`summariseLocally`, used only against a backend
 * without /earnings/summary) and the server give the same figures. Needs a
 * Node version that runs TypeScript files directly (22.18+ or 23.6+).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { earningsWindow, summariseLocally, summaryPath, todayRows } from "../lib/earnings.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-14T15:00:00+05:30");
const TODAY = Date.parse("2026-11-14T00:00:00+05:30");
const WINDOW = { todayStart: TODAY, weekStart: NOW - 7 * DAY };

// What GET /delivery-partner/orders?status=completed returns per order.
const row = (id, placedAt, payoutAmount = null, payoutCreatedAt = null) => ({
  id,
  order_code: `NN-${id}`,
  placed_at: placedAt,
  stores: { name: "Store" },
  payout_amount: payoutAmount,
  payout_created_at: payoutCreatedAt,
});

test("same buckets as the server for the shared fixture", () => {
  const orders = [
    row("a", "2026-11-14T10:00:00+05:30", 40, "2026-11-14T10:40:00+05:30"),
    row("b", "2026-11-13T22:00:00+05:30", 35.5, "2026-11-14T00:20:00+05:30"),
    row("c", "2026-11-10T12:00:00+05:30", 50, "2026-11-10T12:45:00+05:30"),
    row("d", "2026-11-14T09:00:00+05:30"),
    row("e", "2026-10-01T12:00:00+05:30", 45, "2026-10-01T13:00:00+05:30"),
  ];
  const { summary, recent } = summariseLocally(orders, WINDOW);
  assert.deepEqual(summary.today, { deliveries: 3, earnings: 75.5, payout_known: 2 });
  assert.deepEqual(summary.week, { deliveries: 4, earnings: 125.5, payout_known: 3 });
  assert.deepEqual(summary.all, { deliveries: 5, earnings: 170.5, payout_known: 4 });
  assert.deepEqual(recent.map((r) => r.id), ["a", "b", "c", "d"]);
  // The Today list is the 7-day rows since midnight.
  assert.deepEqual(todayRows(recent, TODAY).map((r) => r.id), ["a", "b", "d"]);
});

test("sums are rounded to paise", () => {
  const orders = [row("a", "2026-11-14T10:00:00+05:30", 0.1), row("b", "2026-11-14T11:00:00+05:30", 0.2), row("c", "2026-11-14T12:00:00+05:30", 0.7)];
  assert.equal(summariseLocally(orders, WINDOW).summary.all.earnings, 1);
});

test("an unparseable date counts in all-time only", () => {
  const { summary, recent } = summariseLocally([row("a", "not-a-date")], WINDOW);
  assert.equal(summary.all.deliveries, 1);
  assert.equal(summary.week.deliveries, 0);
  assert.deepEqual(recent, []);
});

test("the window is local midnight and now minus 7 days", () => {
  const win = earningsWindow(NOW);
  const midnight = new Date(NOW);
  midnight.setHours(0, 0, 0, 0);
  assert.equal(win.todayStart, midnight.getTime());
  assert.equal(win.weekStart, NOW - 7 * DAY);
});

test("the summary request carries both boundaries as encoded ISO times", () => {
  const path = summaryPath(WINDOW);
  const url = new URL(`https://x${path}`);
  assert.equal(url.pathname, "/delivery-partner/earnings/summary");
  assert.equal(Date.parse(url.searchParams.get("today_start")), TODAY);
  assert.equal(Date.parse(url.searchParams.get("week_start")), NOW - 7 * DAY);
  assert.ok(!path.includes(":"), "colons in the ISO times are percent-encoded");
});

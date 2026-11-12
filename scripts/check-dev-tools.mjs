/**
 * Plain-Node checks for the developer tools: which builds contain them, the
 * seven-tap unlock, the release-environment flag of the build script, and the
 * demo order (lib/demoDelivery.ts) that the real screens run against.
 *
 *   node scripts/check-dev-tools.mjs
 *
 * Same approach as check-order-polling.mjs: node:test and node:assert, no
 * extra packages. Needs a Node version that runs TypeScript files directly
 * (22.18+ or 23.6+).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  DEV_TOOLS_TAPS_TO_UNLOCK,
  DEV_TOOLS_TAP_WINDOW_MS,
  devToolsAvailable,
  registerUnlockTap,
} from "../lib/devToolsRules.ts";
import {
  DEMO_DELIVERY_OTP,
  DEMO_MAX_WRONG_ATTEMPTS,
  DEMO_PICKUP_CODE,
  DEMO_QR_TTL_MS,
  DEMO_RETRY_AFTER_SECONDS,
  DEMO_SCENARIOS,
  DEMO_STORE_CONFIRM_MS,
  DEMO_UPI_PAYS_AFTER_MS,
  createDemoDelivery,
  describeDemo,
  handleDemoRequest,
  isDemoLive,
  isDemoRequest,
  transformDemoResponse,
} from "../lib/demoDelivery.ts";

const require = createRequire(import.meta.url);
const { resolveReleaseEnvironment, positionalArgs } = require("./release-env.js");

// ─── Which builds have the tools, and how they are switched on ───────────────

test("developer tools exist only in dev clients and preview builds", () => {
  assert.equal(devToolsAvailable("production", false), false, "production release");
  assert.equal(devToolsAvailable("development", false), false, "a release built from a .env that says development");
  assert.equal(devToolsAvailable("", false), false);
  assert.equal(devToolsAvailable(undefined, false), false);
  assert.equal(devToolsAvailable("preview", false), true, "preview release");
  assert.equal(devToolsAvailable("production", true), true, "dev client");
});

test("the tools unlock on the seventh quick tap, not before", () => {
  let taps = { count: 0, lastAt: 0 };
  let now = 1_000_000;
  for (let i = 1; i <= DEV_TOOLS_TAPS_TO_UNLOCK; i++) {
    const next = registerUnlockTap(taps, (now += 200));
    assert.equal(next.unlocked, i === DEV_TOOLS_TAPS_TO_UNLOCK, `tap ${i}`);
    taps = next;
  }
  assert.equal(taps.count, 0, "the count starts over after unlocking");
});

test("a pause between taps starts the count again", () => {
  let taps = { count: 0, lastAt: 0 };
  let now = 1_000_000;
  for (let i = 0; i < DEV_TOOLS_TAPS_TO_UNLOCK - 1; i++) taps = registerUnlockTap(taps, (now += 200));
  taps = registerUnlockTap(taps, (now += DEV_TOOLS_TAP_WINDOW_MS + 1));
  assert.equal(taps.unlocked, false, "six taps, a pause, one tap must not unlock");
  assert.equal(taps.count, 1);
});

test("a release build is production unless --env=preview is passed", () => {
  assert.equal(resolveReleaseEnvironment([]), "production");
  assert.equal(resolveReleaseEnvironment(["aab"]), "production");
  assert.equal(resolveReleaseEnvironment(["--env=preview"]), "preview");
  assert.equal(resolveReleaseEnvironment(["aab", "--env", "preview"]), "preview");
  assert.throws(() => resolveReleaseEnvironment(["--env=development"]), /Unknown --env/);
  assert.deepEqual(positionalArgs(["--env", "preview", "aab"]), ["aab"], "the flag's value is not the build target");
  assert.deepEqual(positionalArgs(["--env=preview"]), []);
});

// ─── Demo order ──────────────────────────────────────────────────────────────

const T0 = 1_700_000_000_000;
const QR = "data:image/png;base64,TEST";
const get = (path) => ({ method: "GET", path });
const post = (path, body) => ({ method: "POST", path, body });

/** A demo order that has just been accepted. */
function accepted(scenario = "cod_upi") {
  const d = createDemoDelivery({ now: T0, delayMs: 0, scenario, qrImageUrl: QR });
  handleDemoRequest(d, post(`/delivery-partner/offers/${d.offerId}/accept`), T0);
  return d;
}
const base = (d) => `/delivery-partner/orders/${d.orderId}`;
const sequence = (d, now) => handleDemoRequest(d, get(`${base(d)}/pickup-sequence`), now);
const enterCode = (d, code, now) =>
  handleDemoRequest(d, post(`${base(d)}/stores/${d.stops[0].allocationId}/verify-code`, { code }), now);
const enterOtp = (d, otp, now) => handleDemoRequest(d, post(`${base(d)}/verify-delivery-otp`, { otp }), now);

/** Both pickups done: the code at the first store, the second confirms by itself. */
function pickedUp(scenario) {
  const d = accepted(scenario);
  enterCode(d, DEMO_PICKUP_CODE, T0 + 1000);
  const after = T0 + 1000 + DEMO_STORE_CONFIRM_MS;
  assert.equal(sequence(d, after).order.all_picked_up, true);
  return { d, now: after };
}

function thrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  assert.fail("expected the request to fail");
}

test("requests that are not about the demo order are left alone", () => {
  const d = createDemoDelivery({ now: T0, delayMs: 0 });
  assert.equal(isDemoRequest("/delivery-partner/orders/8f3c/pickup-sequence"), false);
  assert.equal(isDemoRequest("/delivery-partner/profile"), false);
  assert.equal(handleDemoRequest(d, get("/delivery-partner/orders/8f3c/pickup-sequence"), T0), undefined);
  assert.equal(handleDemoRequest(d, post("/delivery-partner/offers/77/accept"), T0), undefined);
  assert.equal(handleDemoRequest(d, get("/delivery-partner/profile"), T0), undefined);

  const profile = { success: true, profile: { status: "active" } };
  assert.equal(transformDemoResponse(d, get("/delivery-partner/profile"), profile, T0), profile);
  const completed = { success: true, orders: [{ id: "real" }] };
  assert.equal(transformDemoResponse(d, get("/delivery-partner/orders?status=completed&limit=50"), completed, T0), completed);
  const offers = { success: true, offers: [] };
  assert.equal(transformDemoResponse(null, get("/delivery-partner/available-orders"), offers, T0), offers, "no demo running");
});

test("a request for a demo id never reaches the network, even with no demo running", () => {
  const path = "/delivery-partner/orders/demo-order-gone/pickup-sequence";
  assert.equal(isDemoRequest(path), true);
  assert.equal(thrown(() => handleDemoRequest(null, get(path), T0)).status, 404);
  const other = createDemoDelivery({ now: T0 });
  assert.equal(thrown(() => handleDemoRequest(other, get(path), T0)).status, 404, "a different demo order");
  assert.equal(thrown(() => handleDemoRequest(null, post("/delivery-partner/offers/demo-offer-gone/accept"), T0)).status, 404);
});

test("the offer appears on Home only after its delay, alongside real offers", () => {
  const d = createDemoDelivery({ now: T0, delayMs: 10_000 });
  const real = { success: true, offers: [{ offer_id: "real-1" }] };
  const req = get("/delivery-partner/available-orders");

  assert.equal(transformDemoResponse(d, req, real, T0 + 9_999), real, "not yet");
  assert.match(describeDemo(d, T0), /Arrives on Home in 10 s/);

  const shown = transformDemoResponse(d, req, real, T0 + 10_000);
  assert.deepEqual(shown.offers.map((o) => o.offer_id), [d.offerId, "real-1"]);
  assert.equal(real.offers.length, 1, "the real response is not modified");

  // Everything the offer card on Home reads.
  const offer = shown.offers[0];
  assert.equal(offer.order_id, d.orderId);
  assert.match(offer.order_code, /^DEMO-/);
  assert.equal(offer.store_count, 2);
  assert.equal(offer.stores.length, 2);
  for (const s of offer.stores) {
    assert.equal(typeof s.latitude, "number");
    assert.equal(typeof s.longitude, "number");
    assert.ok(s.store_id && s.name && s.address && s.sequence_number);
    assert.equal(s.phone, null, "no number to dial");
  }
  assert.equal(typeof offer.customer_lat, "number");
  assert.ok(!Number.isNaN(Date.parse(offer.placed_at)));

  assert.equal(transformDemoResponse(d, req, { success: false }, T0 + 10_000).offers, undefined, "a failed response is left alone");
});

test("accepting turns the offer into an active order, listed after real ones", () => {
  const d = createDemoDelivery({ now: T0, delayMs: 0 });
  const res = handleDemoRequest(d, post(`/delivery-partner/offers/${d.offerId}/accept`), T0);
  assert.deepEqual({ result: res.result, order_id: res.order_id }, { result: "accepted", order_id: d.orderId });
  assert.equal(d.stage, "accepted");
  assert.equal(isDemoLive(d), true);

  // A second tap gets the same answer rather than an error.
  assert.equal(handleDemoRequest(d, post(`/delivery-partner/offers/${d.offerId}/accept`), T0).result, "accepted");

  const offers = { success: true, offers: [] };
  assert.equal(transformDemoResponse(d, get("/delivery-partner/available-orders"), offers, T0), offers, "no longer on offer");

  const active = transformDemoResponse(
    d,
    get("/delivery-partner/orders?status=active&limit=50"),
    { success: true, orders: [{ id: "real-order" }] },
    T0
  );
  assert.deepEqual(active.orders.map((o) => o.id), ["real-order", d.orderId], "real work stays first");
  assert.equal(active.orders[1].status, "rider_assigned");

  const nextPage = { success: true, orders: [] };
  assert.equal(
    transformDemoResponse(d, get("/delivery-partner/orders?status=active&limit=50&offset=50"), nextPage, T0),
    nextPage,
    "only on the first page"
  );
});

test("pickups: a wrong code is refused, three in a row are rate limited, the right one works", () => {
  const d = accepted();
  let seq = sequence(d, T0);
  assert.equal(seq.order.total_stores, 2);
  assert.equal(seq.order.all_picked_up, false);
  assert.deepEqual(seq.stops.map((s) => [s.picked_up, s.pickup_code_required]), [[false, true], [false, false]]);
  // Everything PickupStopCard reads.
  for (const s of seq.stops) {
    assert.ok(s.allocation_id && s.store.name && s.store.address);
    assert.equal(typeof s.store.latitude, "number");
    assert.equal(s.store.phone, "");
    assert.ok(s.items.length > 0 && s.items.every((it) => it.id && it.product_name && it.quantity));
  }

  for (let i = 1; i < DEMO_MAX_WRONG_ATTEMPTS; i++) {
    const err = thrown(() => enterCode(d, "0000", T0 + i));
    assert.equal(err.status, 400);
    assert.match(err.message, /Incorrect pickup code/);
    assert.equal(err.error, err.message, "screens show e.error");
  }
  const limited = thrown(() => enterCode(d, "0000", T0 + 10));
  assert.equal(limited.status, 429);
  assert.equal(limited.retryAfterSeconds, DEMO_RETRY_AFTER_SECONDS, "drives the countdown on the Verify button");

  assert.deepEqual(enterCode(d, DEMO_PICKUP_CODE, T0 + 1000), { success: true });
  seq = sequence(d, T0 + 1000);
  assert.equal(seq.stops[0].picked_up, true);
  assert.ok(!Number.isNaN(Date.parse(seq.stops[0].picked_up_at)));
  assert.equal(seq.order.status, "picking_up");
});

test("the second store confirms by itself a few seconds after becoming the next stop", () => {
  const d = accepted();
  // Not before the first stop is done, however long the rider waits.
  assert.equal(sequence(d, T0 + 60_000).stops[1].picked_up, false);

  const pickedAt = T0 + 60_000;
  enterCode(d, DEMO_PICKUP_CODE, pickedAt);
  assert.equal(sequence(d, pickedAt + DEMO_STORE_CONFIRM_MS - 1).stops[1].picked_up, false);
  assert.match(describeDemo(d, pickedAt + 1), /Pickup 2 of 2: the store confirms by itself/);

  const seq = sequence(d, pickedAt + DEMO_STORE_CONFIRM_MS);
  assert.equal(seq.stops[1].picked_up, true);
  assert.equal(seq.order.all_picked_up, true);
  assert.equal(seq.order.status, "picked_up");

  // Entering a code for it is refused rather than silently accepted.
  const d2 = accepted();
  enterCode(d2, DEMO_PICKUP_CODE, T0);
  const err = thrown(() =>
    handleDemoRequest(d2, post(`${base(d2)}/stores/${d2.stops[1].allocationId}/verify-code`, { code: DEMO_PICKUP_CODE }), T0 + 1)
  );
  assert.equal(err.status, 400);
});

test("delivery OTP: refused before the pickups, wrong ones counted, the right one sticks", () => {
  const early = accepted();
  assert.equal(thrown(() => enterOtp(early, DEMO_DELIVERY_OTP, T0)).status, 400);

  const { d, now } = pickedUp("cod_upi");
  assert.equal(sequence(d, now).order.delivery_otp_verified, false);
  assert.equal(thrown(() => enterOtp(d, "1111", now)).status, 400);
  assert.equal(thrown(() => enterOtp(d, "1111", now)).status, 400);
  assert.equal(thrown(() => enterOtp(d, "1111", now)).status, 429);
  assert.deepEqual(enterOtp(d, DEMO_DELIVERY_OTP, now), { success: true });
  assert.equal(sequence(d, now).order.delivery_otp_verified, true, "survives a reload of the screen");
});

test("COD by UPI: the QR is paid a few seconds after it is shown, and cash is then refused", () => {
  const { d, now } = pickedUp("cod_upi");
  enterOtp(d, DEMO_DELIVERY_OTP, now);

  const order = sequence(d, now).order;
  assert.equal(order.amount_to_collect, 245);
  assert.equal(order.cod_collection.status, "none");

  const unpaid = thrown(() => handleDemoRequest(d, post(`${base(d)}/delivered`), now));
  assert.equal(unpaid.status, 400);
  assert.match(unpaid.message, /Collect the payment/);

  const qr = handleDemoRequest(d, post(`${base(d)}/cod/qr`), now);
  assert.equal(qr.cod_collection.status, "awaiting");
  assert.equal(qr.cod_collection.qr_image_url, QR);
  assert.equal(Date.parse(qr.cod_collection.qr_close_by), now + DEMO_QR_TTL_MS.cod_upi);
  assert.equal(qr.amount_to_collect, 245);

  const poll = (t) => handleDemoRequest(d, get(`${base(d)}/cod`), t).cod_collection.status;
  assert.equal(poll(now + DEMO_UPI_PAYS_AFTER_MS - 1), "awaiting");
  assert.equal(poll(now + DEMO_UPI_PAYS_AFTER_MS), "paid_upi");

  const cash = thrown(() => handleDemoRequest(d, post(`${base(d)}/cod/cash`), now + 20_000));
  assert.equal(cash.status, 409);
  assert.equal(cash.cod_collection.status, "paid_upi", "CodCollectionBox updates from the error body");

  assert.deepEqual(handleDemoRequest(d, post(`${base(d)}/delivered`), now + 21_000), { success: true });
  assert.equal(sequence(d, now + 22_000).order.status, "order_delivered", "the screen shows Order Delivered");
  assert.equal(isDemoLive(d), false);

  const active = { success: true, orders: [] };
  assert.equal(transformDemoResponse(d, get("/delivery-partner/orders?status=active"), active, now + 22_000), active);
});

test("COD in cash: the QR is never paid and expires quickly; cash settles the order", () => {
  const { d, now } = pickedUp("cod_cash");
  enterOtp(d, DEMO_DELIVERY_OTP, now);
  const qr = handleDemoRequest(d, post(`${base(d)}/cod/qr`), now);
  assert.equal(Date.parse(qr.cod_collection.qr_close_by), now + DEMO_QR_TTL_MS.cod_cash);
  assert.equal(handleDemoRequest(d, get(`${base(d)}/cod`), now + 10 * 60_000).cod_collection.status, "awaiting");

  const cash = handleDemoRequest(d, post(`${base(d)}/cod/cash`), now + 60_000);
  assert.equal(cash.cod_collection.status, "cash_collected");
  assert.equal(cash.cod_collection.method, "cash");
  assert.deepEqual(handleDemoRequest(d, post(`${base(d)}/delivered`), now + 61_000), { success: true });
});

test("prepaid: nothing to collect, no payment step", () => {
  const { d, now } = pickedUp("prepaid");
  const order = sequence(d, now).order;
  assert.equal(order.amount_to_collect, 0);
  assert.equal("cod_collection" in order, false);
  assert.equal(thrown(() => handleDemoRequest(d, post(`${base(d)}/cod/qr`), now)).status, 400);
  assert.equal(thrown(() => handleDemoRequest(d, post(`${base(d)}/delivered`), now)).status, 400, "the OTP is still required");
  enterOtp(d, DEMO_DELIVERY_OTP, now);
  assert.deepEqual(handleDemoRequest(d, post(`${base(d)}/delivered`), now), { success: true });
});

test("offer taken: accepting fails the way a lost race does", () => {
  const d = createDemoDelivery({ now: T0, delayMs: 0, scenario: "taken" });
  const err = thrown(() => handleDemoRequest(d, post(`/delivery-partner/offers/${d.offerId}/accept`), T0));
  assert.equal(err.status, 409);
  assert.equal(err.result, "already_taken", "Home shows 'Too slow!' for this result");
  assert.equal(isDemoLive(d), false);
  const offers = { success: true, offers: [] };
  assert.equal(transformDemoResponse(d, get("/delivery-partner/available-orders"), offers, T0), offers, "gone from Home");
});

test("a cancelled order reads as cancelled and accepts nothing more", () => {
  const d = accepted();
  d.stage = "cancelled"; // what cancelDemoDelivery() does to an accepted order
  assert.equal(sequence(d, T0).order.status, "cancelled", "the delivery screen sends the rider back to Home");
  assert.equal(thrown(() => enterCode(d, DEMO_PICKUP_CODE, T0)).status, 409);
  assert.equal(thrown(() => handleDemoRequest(d, post(`${base(d)}/delivered`), T0)).status, 409);
  const active = { success: true, orders: [] };
  assert.equal(transformDemoResponse(d, get("/delivery-partner/orders?status=active"), active, T0), active);
});

test("the status line tells the tester what to do next at every step", () => {
  assert.equal(describeDemo(null, T0), "No demo order");
  const d = accepted("cod_cash");
  assert.match(describeDemo(d, T0), new RegExp(`Pickup 1 of 2: enter code ${DEMO_PICKUP_CODE}`));
  enterCode(d, DEMO_PICKUP_CODE, T0);
  const now = T0 + DEMO_STORE_CONFIRM_MS;
  sequence(d, now);
  assert.match(describeDemo(d, now), new RegExp(`delivery OTP is ${DEMO_DELIVERY_OTP}`));
  enterOtp(d, DEMO_DELIVERY_OTP, now);
  assert.match(describeDemo(d, now), /Collect ₹245/);
  handleDemoRequest(d, post(`${base(d)}/cod/cash`), now);
  assert.match(describeDemo(d, now), /Mark Delivered/);
  handleDemoRequest(d, post(`${base(d)}/delivered`), now);
  assert.equal(describeDemo(d, now), "Delivered");
});

test("every scenario offered on the tools screen can be created", () => {
  for (const { key } of DEMO_SCENARIOS) {
    const d = createDemoDelivery({ now: T0, scenario: key });
    assert.equal(d.scenario, key);
    assert.equal(d.amountToCollect, key === "prepaid" ? 0 : 245);
  }
});

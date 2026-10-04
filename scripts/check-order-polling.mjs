/**
 * Plain-Node check for lib/useRiderOrderPolling.ts (the home tab's active-order
 * and offers polling). No test framework or extra packages: it uses node:test,
 * node:assert, and the react / react-dom this app already depends on.
 *
 *   node scripts/check-order-polling.mjs
 *
 * Needs a Node version that runs TypeScript files directly (22.18+ or 23.6+).
 *
 * The harness component mirrors app/(tabs)/home.tsx: the session token arrives
 * first, the profile request then sets isOnline, and every active-order poll
 * stores a FRESH order object (as apiFetch's JSON parse does). That fresh
 * object is what turned the old single effect into a request loop.
 */
import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import {
  useRiderOrderPolling,
  ACTIVE_ORDER_POLL_ONLINE_MS,
  ACTIVE_ORDER_POLL_OFFLINE_MS,
  OFFERS_POLL_MS,
} from "../lib/useRiderOrderPolling.ts";

// The harness renders null, so react-dom only needs these stand-ins.
const noop = () => {};
const fakeDocument = { nodeType: 9, activeElement: null, addEventListener: noop, removeEventListener: noop };
globalThis.window ??= { document: fakeDocument, HTMLIFrameElement: function HTMLIFrameElement() {}, addEventListener: noop, removeEventListener: noop };
const fakeContainer = () => ({
  nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
  ownerDocument: fakeDocument, addEventListener: noop, removeEventListener: noop, textContent: "",
});

/** Let React render, run passive effects and settle promises, several times over. */
async function settle(rounds = 40) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

// Every mounted harness is unmounted after its test even when an assertion
// fails, so a looping effect can't keep the process alive.
const mounted = new Set();

function mountHarness({ serverOrder = null } = {}) {
  const server = { order: serverOrder };
  const log = { active: [], offers: [], cleared: 0 };
  const api = {};
  function Harness() {
    const [token, setToken] = useState("");
    const [isOnline, setIsOnline] = useState(false);
    const [activeOrder, setActiveOrder] = useState(null);
    const offersPollRef = useRef(null);
    const fetchActiveOrder = useCallback(async () => {
      log.active.push(token);
      await Promise.resolve();
      setActiveOrder(server.order ? { ...server.order } : null);
    }, [token]);
    const fetchOffers = useCallback(async () => {
      log.offers.push(token);
    }, [token]);
    const clearOffers = useCallback(() => {
      log.cleared++;
    }, []);
    useRiderOrderPolling({ token, isOnline, activeOrder, fetchActiveOrder, fetchOffers, clearOffers, offersPollRef });
    Object.assign(api, { setToken, setIsOnline, activeOrder, offersPollRef });
    return null;
  }
  const root = createRoot(fakeContainer());
  flushSync(() => root.render(createElement(Harness)));
  const unmount = () => {
    if (!mounted.delete(unmount)) return;
    flushSync(() => root.unmount());
  };
  mounted.add(unmount);
  return { server, log, api, set: (fn) => flushSync(fn), unmount };
}

/** Session token, then profile → online: the same order home.tsx's mount effect sets them. */
async function signIn(h, { online = true, token = "t1" } = {}) {
  h.set(() => h.api.setToken(token));
  await settle();
  h.set(() => h.api.setIsOnline(online));
  await settle();
}

beforeEach(() => mock.timers.enable({ apis: ["setInterval"] }));
afterEach(() => {
  for (const unmount of [...mounted]) unmount();
  mock.timers.reset();
});

test("mount: exactly one active-order fetch through session load, profile load and the order arriving", async () => {
  const h = mountHarness({ serverOrder: { id: "o1", order_code: "NN1" } });
  await signIn(h);
  await settle(200);
  assert.equal(h.log.active.length, 1, `active-order fetches after mount: ${h.log.active.length}`);
  h.unmount();
});

test("no request loop while an order is active: one fetch per 6 s tick", async () => {
  const h = mountHarness({ serverOrder: { id: "o1", order_code: "NN1" } });
  await signIn(h);
  const afterMount = h.log.active.length;
  await settle(200);
  assert.equal(h.log.active.length, afterMount, "fetched again without any timer tick");
  for (let i = 1; i <= 5; i++) {
    mock.timers.tick(ACTIVE_ORDER_POLL_ONLINE_MS);
    await settle();
    assert.equal(h.log.active.length, afterMount + i, `after ${i} ticks`);
  }
  h.unmount();
});

test("cadence: active order every 6 s online, every 45 s offline", async () => {
  assert.equal(ACTIVE_ORDER_POLL_ONLINE_MS, 6000);
  assert.equal(ACTIVE_ORDER_POLL_OFFLINE_MS, 45000);
  assert.equal(OFFERS_POLL_MS, 15000);

  const offline = mountHarness();
  await signIn(offline, { online: false });
  const base = offline.log.active.length;
  mock.timers.tick(ACTIVE_ORDER_POLL_OFFLINE_MS - 1);
  await settle();
  assert.equal(offline.log.active.length, base, "offline: nothing before 45 s");
  mock.timers.tick(1);
  await settle();
  assert.equal(offline.log.active.length, base + 1, "offline: one fetch at 45 s");
  offline.unmount();

  const online = mountHarness();
  await signIn(online, { online: true });
  const base2 = online.log.active.length;
  mock.timers.tick(ACTIVE_ORDER_POLL_ONLINE_MS);
  await settle();
  assert.equal(online.log.active.length, base2 + 1, "online: one fetch at 6 s");
  online.unmount();
});

test("offers: fetched now and every 15 s while online with no active order; cleared and stopped otherwise", async () => {
  const h = mountHarness();
  await signIn(h, { online: true });
  assert.equal(h.log.offers.length, 1, "one immediate offers fetch");
  mock.timers.tick(OFFERS_POLL_MS);
  await settle();
  assert.equal(h.log.offers.length, 2, "offers poll at 15 s");

  // An order gets assigned: offers are cleared and no longer polled.
  h.server.order = { id: "o1", order_code: "NN1" };
  mock.timers.tick(ACTIVE_ORDER_POLL_ONLINE_MS);
  await settle();
  const clearedAfterAssign = h.log.cleared;
  assert.ok(clearedAfterAssign >= 1, "offers cleared when an order is active");
  const offersWhileActive = h.log.offers.length;
  mock.timers.tick(OFFERS_POLL_MS * 4);
  await settle();
  assert.equal(h.log.offers.length, offersWhileActive, "no offers polling during a delivery");

  // Going offline also clears offers.
  const offlineH = mountHarness();
  await signIn(offlineH, { online: false });
  assert.equal(offlineH.log.offers.length, 0, "offline: offers never fetched");
  assert.ok(offlineH.log.cleared >= 1, "offline: offers cleared");
  h.unmount();
  offlineH.unmount();
});

test("no stale closure: finishing the order restarts offers; a new session uses the new fetchers", async () => {
  const h = mountHarness({ serverOrder: { id: "o1", order_code: "NN1" } });
  await signIn(h, { online: true });
  assert.equal(h.log.offers.length, 0, "no offers while the order is active");

  // Delivery completes: the next poll returns no order, and offers resume at once.
  h.server.order = null;
  mock.timers.tick(ACTIVE_ORDER_POLL_ONLINE_MS);
  await settle();
  assert.equal(h.log.offers.length, 1, "offers fetched as soon as the order is gone");
  mock.timers.tick(OFFERS_POLL_MS);
  await settle();
  assert.equal(h.log.offers.length, 2, "offers poll running again");

  // New session token: one immediate fetch with it, and the timers use it from then on.
  const before = h.log.active.length;
  h.set(() => h.api.setToken("t2"));
  await settle();
  assert.equal(h.log.active.length, before + 1, "one fetch for the new session");
  mock.timers.tick(ACTIVE_ORDER_POLL_ONLINE_MS);
  await settle();
  assert.deepEqual(h.log.active.slice(before), ["t2", "t2"], "interval calls the current fetcher");
  assert.equal(h.log.offers.at(-1), "t2", "offers use the current fetcher");
  h.unmount();
});

test("unmount: every interval is cleared", async () => {
  const h = mountHarness();
  await signIn(h, { online: true });
  const active = h.log.active.length;
  const offers = h.log.offers.length;
  h.unmount();
  mock.timers.tick(10 * 60 * 1000);
  await settle();
  assert.equal(h.log.active.length, active, "no active-order fetch after unmount");
  assert.equal(h.log.offers.length, offers, "no offers fetch after unmount");
});

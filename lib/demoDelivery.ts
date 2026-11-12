/**
 * A pretend delivery for the developer tools (lib/devTools.ts, app/dev-tools.tsx).
 *
 * It answers the same requests the backend answers for a real order — the
 * offer on Home, accept, the pickup sequence, pickup code, delivery OTP, the
 * cash/UPI step and "delivered" — so the real screens run unchanged against
 * it and a whole delivery can be walked through without a customer, a store
 * or a real order. lib/devTools.ts plugs it into apiFetch; nothing here ever
 * reaches the backend, and requests for a demo id never leave the phone.
 *
 * No React Native imports, so scripts/check-dev-tools.mjs runs it in plain Node.
 */

export const DEMO_ID_PREFIX = "demo-";
/** The pickup code the first demo store accepts. */
export const DEMO_PICKUP_CODE = "1234";
/** The delivery OTP the demo customer "reads out". */
export const DEMO_DELIVERY_OTP = "4321";
/** This many wrong codes in a row gets a 429, like the real rate limiter. */
export const DEMO_MAX_WRONG_ATTEMPTS = 3;
export const DEMO_RETRY_AFTER_SECONDS = 20;
/** A store with no pickup code confirms the rider's arrival after this long. */
export const DEMO_STORE_CONFIRM_MS = 8000;
/** In the "cod_upi" scenario the customer pays the QR this long after it is shown. */
export const DEMO_UPI_PAYS_AFTER_MS = 10000;
/** How long a demo QR stays valid. Short for "cod_cash" so expiry can be watched. */
export const DEMO_QR_TTL_MS = { cod_upi: 5 * 60_000, cod_cash: 45_000 };

export type DemoScenario = "cod_upi" | "cod_cash" | "prepaid" | "taken";

export const DEMO_SCENARIOS: readonly { key: DemoScenario; label: string; description: string }[] = [
  { key: "cod_upi", label: "COD · UPI", description: "Collect at the door. The customer pays the QR about 10 s after you show it." },
  { key: "cod_cash", label: "COD · cash", description: "Collect at the door. The QR is never paid and expires in 45 s, so take cash." },
  { key: "prepaid", label: "Prepaid", description: "Already paid online. Nothing to collect." },
  { key: "taken", label: "Offer taken", description: "Accept fails because another rider got the order first." },
];

export type DemoApiRequest = { method: string; path: string; body?: unknown };

export type DemoStage = "offered" | "accepted" | "delivered" | "cancelled" | "taken";

type DemoItem = { id: string; product_name: string; quantity: number; unit: string };

export type DemoStop = {
  allocationId: string;
  sequence: number;
  storeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** false = the store confirms the pickup itself (DEMO_STORE_CONFIRM_MS). */
  codeRequired: boolean;
  items: DemoItem[];
  /** When this stop became the next one to visit. */
  nextSince: number | null;
  pickedUpAt: number | null;
};

export type DemoDelivery = {
  scenario: DemoScenario;
  offerId: string;
  orderId: string;
  orderCode: string;
  /** The offer appears on Home from this moment. */
  visibleAt: number;
  stage: DemoStage;
  acceptedAt: number | null;
  amount: number;
  /** 0 = prepaid. */
  amountToCollect: number;
  customer: { address: string; lat: number; lng: number };
  stops: DemoStop[];
  otpVerified: boolean;
  wrongCodes: number;
  wrongOtps: number;
  qrImageUrl: string | null;
  cod: {
    status: "none" | "awaiting" | "paid_upi" | "cash_collected";
    qrShownAt: number | null;
    qrCloseBy: number | null;
    collectedAt: number | null;
  };
};

// Used when the phone has no GPS fix yet (central Kolkata).
const DEFAULT_NEAR = { lat: 22.5726, lng: 88.3639 };

export function createDemoDelivery(opts: {
  now: number;
  /** Delay before the offer appears. */
  delayMs?: number;
  scenario?: DemoScenario;
  /** The rider's position, so the distances on screen look real. */
  near?: { lat: number; lng: number } | null;
  qrImageUrl?: string | null;
}): DemoDelivery {
  const { now } = opts;
  const scenario = opts.scenario ?? "cod_upi";
  const near = opts.near ?? DEFAULT_NEAR;
  const stamp = now.toString(36);
  const amount = 245;
  return {
    scenario,
    offerId: `${DEMO_ID_PREFIX}offer-${stamp}`,
    orderId: `${DEMO_ID_PREFIX}order-${stamp}`,
    orderCode: `DEMO-${stamp.slice(-4).toUpperCase()}`,
    visibleAt: now + Math.max(0, opts.delayMs ?? 0),
    stage: "offered",
    acceptedAt: null,
    amount,
    amountToCollect: scenario === "prepaid" ? 0 : amount,
    customer: {
      address: `Demo customer · delivery OTP ${DEMO_DELIVERY_OTP} · 12 Test Lane`,
      lat: near.lat - 0.009,
      lng: near.lng + 0.011,
    },
    stops: [
      {
        allocationId: `${DEMO_ID_PREFIX}alloc-1-${stamp}`,
        sequence: 1,
        storeId: `${DEMO_ID_PREFIX}store-1`,
        name: "Demo Kirana Store",
        address: `Pickup code ${DEMO_PICKUP_CODE}`,
        lat: near.lat + 0.006,
        lng: near.lng + 0.004,
        codeRequired: true,
        items: [
          { id: `${DEMO_ID_PREFIX}item-1`, product_name: "Tata Salt 1kg", quantity: 1, unit: "pcs" },
          { id: `${DEMO_ID_PREFIX}item-2`, product_name: "Britannia Brown Bread", quantity: 2, unit: "pcs" },
        ],
        nextSince: null,
        pickedUpAt: null,
      },
      {
        allocationId: `${DEMO_ID_PREFIX}alloc-2-${stamp}`,
        sequence: 2,
        storeId: `${DEMO_ID_PREFIX}store-2`,
        name: "Demo Dairy",
        address: "No code: the store confirms in a few seconds",
        lat: near.lat + 0.01,
        lng: near.lng - 0.003,
        codeRequired: false,
        items: [{ id: `${DEMO_ID_PREFIX}item-3`, product_name: "Amul Taaza Milk 1L", quantity: 2, unit: "pcs" }],
        nextSince: null,
        pickedUpAt: null,
      },
    ],
    otpVerified: false,
    wrongCodes: 0,
    wrongOtps: 0,
    qrImageUrl: opts.qrImageUrl ?? null,
    cod: { status: "none", qrShownAt: null, qrCloseBy: null, collectedAt: null },
  };
}

/** An offer the rider can still act on, or a delivery still in progress. */
export function isDemoLive(d: DemoDelivery | null): boolean {
  return !!d && (d.stage === "offered" || d.stage === "accepted");
}

/** What the tester should do next, for the developer tools screen. */
export function describeDemo(d: DemoDelivery | null, now: number): string {
  if (!d) return "No demo order";
  if (d.stage === "offered") {
    return now < d.visibleAt
      ? `Arrives on Home in ${Math.ceil((d.visibleAt - now) / 1000)} s`
      : "Offer is waiting on Home (go online to see it)";
  }
  if (d.stage === "taken") return "Offer was taken by another rider";
  if (d.stage === "cancelled") return "Cancelled";
  if (d.stage === "delivered") return "Delivered";
  const next = d.stops.find((s) => s.pickedUpAt == null);
  if (next) {
    return next.codeRequired
      ? `Pickup ${next.sequence} of ${d.stops.length}: enter code ${DEMO_PICKUP_CODE}`
      : `Pickup ${next.sequence} of ${d.stops.length}: the store confirms by itself`;
  }
  if (!d.otpVerified) return `At the customer: the delivery OTP is ${DEMO_DELIVERY_OTP}`;
  if (d.amountToCollect > 0 && !codSettled(d)) {
    return d.cod.status === "awaiting" ? "Waiting for the QR payment" : `Collect ₹${d.amountToCollect}: show the QR or take cash`;
  }
  return "Ready: tap Mark Delivered";
}

// ─── Internals ───────────────────────────────────────────────────────────────

const OFFER_ACCEPT = /^\/delivery-partner\/offers\/([^/]+)\/accept$/;
const ORDER_ROUTE = /^\/delivery-partner\/orders\/([^/]+)\/(.+)$/;
const VERIFY_CODE = /^stores\/([^/]+)\/verify-code$/;

const allPickedUp = (d: DemoDelivery) => d.stops.every((s) => s.pickedUpAt != null);
const codSettled = (d: DemoDelivery) => d.cod.status === "paid_upi" || d.cod.status === "cash_collected";
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

/** Same shape apiFetch throws for a non-2xx response: an Error carrying the body and `status`. */
function apiError(status: number, body: Record<string, unknown>): Error {
  return Object.assign(new Error(String(body.error ?? "Request failed")), body, { status });
}

function tooManyAttempts(): Error {
  return apiError(429, {
    success: false,
    error: "Too many wrong attempts. Please wait and try again.",
    retryAfterSeconds: DEMO_RETRY_AFTER_SECONDS,
  });
}

function queryParam(query: string, name: string): string | null {
  for (const part of query.split("&")) {
    const [key, value = ""] = part.split("=");
    if (key === name) return decodeURIComponent(value);
  }
  return null;
}

/** Things that happen by themselves as time passes: store confirmations and the QR payment. */
function advance(d: DemoDelivery, now: number): void {
  if (d.stage !== "accepted") return;
  let since = d.acceptedAt ?? now;
  for (const stop of d.stops) {
    if (stop.pickedUpAt != null) {
      since = stop.pickedUpAt;
      continue;
    }
    if (stop.nextSince == null) stop.nextSince = since;
    if (stop.codeRequired || now - stop.nextSince < DEMO_STORE_CONFIRM_MS) break;
    stop.pickedUpAt = stop.nextSince + DEMO_STORE_CONFIRM_MS;
    since = stop.pickedUpAt;
  }
  if (
    d.scenario === "cod_upi" &&
    d.cod.status === "awaiting" &&
    d.cod.qrShownAt != null &&
    now - d.cod.qrShownAt >= DEMO_UPI_PAYS_AFTER_MS
  ) {
    d.cod.status = "paid_upi";
    d.cod.collectedAt = d.cod.qrShownAt + DEMO_UPI_PAYS_AFTER_MS;
  }
}

function riderStatus(d: DemoDelivery): string {
  if (d.stage === "delivered") return "order_delivered";
  if (d.stage === "cancelled") return "cancelled";
  if (allPickedUp(d)) return "picked_up";
  return d.stops.some((s) => s.pickedUpAt != null) ? "picking_up" : "rider_assigned";
}

function codCollection(d: DemoDelivery) {
  const awaiting = d.cod.status === "awaiting";
  return {
    status: d.cod.status,
    method: d.cod.status === "none" ? null : d.cod.status === "cash_collected" ? "cash" : "upi_qr",
    amount_due: d.amountToCollect,
    qr_image_url: awaiting ? d.qrImageUrl : null,
    qr_close_by: awaiting ? iso(d.cod.qrCloseBy) : null,
    collected_at: iso(d.cod.collectedAt),
  };
}

const codResponse = (d: DemoDelivery) => ({
  success: true,
  amount_to_collect: d.amountToCollect,
  cod_collection: codCollection(d),
});

/** GET /delivery-partner/available-orders → one entry of `offers`. */
function offerPayload(d: DemoDelivery) {
  return {
    offer_id: d.offerId,
    order_id: d.orderId,
    order_code: d.orderCode,
    total_amount: d.amount,
    delivery_address: d.customer.address,
    customer_lat: d.customer.lat,
    customer_lng: d.customer.lng,
    placed_at: iso(d.visibleAt),
    store_count: d.stops.length,
    stores: d.stops.map((s) => ({
      store_id: s.storeId,
      sequence_number: s.sequence,
      name: s.name,
      address: s.address,
      latitude: s.lat,
      longitude: s.lng,
      phone: null,
      item_count: s.items.length,
      items: s.items.map((it) => ({ product_name: it.product_name, quantity: it.quantity, unit: it.unit })),
    })),
  };
}

/** GET /delivery-partner/orders?status=active → one entry of `orders`. */
function activeOrderPayload(d: DemoDelivery) {
  return {
    id: d.orderId,
    order_code: d.orderCode,
    status: riderStatus(d),
    total_amount: d.amount,
    delivery_address: d.customer.address,
    placed_at: iso(d.visibleAt),
    stores: { name: d.stops[0]?.name ?? "Demo store" },
    order_items: d.stops.flatMap((s) => s.items.map((it) => ({ product_name: it.product_name, quantity: it.quantity }))),
  };
}

/** GET /delivery-partner/orders/:id/pickup-sequence. */
function pickupSequencePayload(d: DemoDelivery) {
  return {
    success: true,
    order: {
      id: d.orderId,
      order_code: d.orderCode,
      status: riderStatus(d),
      total_amount: d.amount,
      amount_to_collect: d.amountToCollect,
      customer_address: d.customer.address,
      customer_lat: d.customer.lat,
      customer_lng: d.customer.lng,
      total_stores: d.stops.length,
      all_picked_up: allPickedUp(d),
      receiver_name: null,
      receiver_phone: null,
      receiver_address: null,
      delivery_otp_verified: d.otpVerified,
      ...(d.amountToCollect > 0 ? { cod_collection: codCollection(d) } : {}),
    },
    stops: d.stops.map((s) => ({
      allocation_id: s.allocationId,
      sequence_number: s.sequence,
      status: s.pickedUpAt != null ? "picked_up" : "pending",
      picked_up: s.pickedUpAt != null,
      pickup_code_required: s.codeRequired,
      picked_up_at: iso(s.pickedUpAt),
      // No phone: the call button stays hidden, so nothing real gets dialled.
      store: { id: s.storeId, name: s.name, address: s.address, latitude: s.lat, longitude: s.lng, phone: "" },
      items: s.items,
    })),
  };
}

// ─── The two hooks lib/devTools.ts gives to apiFetch ─────────────────────────

/** True when the request names a demo offer or order, whether or not one is running. */
export function isDemoRequest(path: string): boolean {
  const pathname = path.split("?")[0];
  const id = OFFER_ACCEPT.exec(pathname)?.[1] ?? ORDER_ROUTE.exec(pathname)?.[1];
  return !!id && id.startsWith(DEMO_ID_PREFIX);
}

/**
 * Answer a request aimed at the demo order. Returns undefined for every other
 * request (it then goes to the network as usual), and throws the way apiFetch
 * does for an error response. A request for a demo id that is no longer
 * running gets a 404 rather than being sent to the real backend.
 */
export function handleDemoRequest(d: DemoDelivery | null, req: DemoApiRequest, now: number): unknown {
  const pathname = req.path.split("?")[0];
  const body = (req.body ?? {}) as Record<string, unknown>;

  const accept = OFFER_ACCEPT.exec(pathname);
  if (accept) {
    if (!accept[1].startsWith(DEMO_ID_PREFIX)) return undefined;
    if (!d || d.offerId !== accept[1]) {
      throw apiError(404, { success: false, result: "offer_not_found", error: "This order is no longer available." });
    }
    if (d.stage === "accepted") return { success: true, result: "accepted", order_id: d.orderId };
    if (d.stage !== "offered") {
      throw apiError(409, { success: false, result: "order_not_available", error: "This order is no longer available." });
    }
    if (d.scenario === "taken") {
      d.stage = "taken";
      throw apiError(409, { success: false, result: "already_taken", error: "Another driver accepted this order first." });
    }
    d.stage = "accepted";
    d.acceptedAt = now;
    return { success: true, result: "accepted", order_id: d.orderId };
  }

  const route = ORDER_ROUTE.exec(pathname);
  if (!route || !route[1].startsWith(DEMO_ID_PREFIX)) return undefined;
  if (!d || d.orderId !== route[1] || d.stage === "offered" || d.stage === "taken") {
    throw apiError(404, { success: false, error: "Demo order not found." });
  }
  advance(d, now);
  const action = route[2];

  // Reads keep working after the order ends, so the delivery screen can show
  // "Delivered" or notice the cancellation.
  if (action === "pickup-sequence") return pickupSequencePayload(d);
  if (action === "cod") return codResponse(d);

  if (d.stage !== "accepted") throw apiError(409, { success: false, error: "This demo order has ended." });

  const verifyCode = VERIFY_CODE.exec(action);
  if (verifyCode) {
    const stop = d.stops.find((s) => s.allocationId === verifyCode[1]);
    if (!stop) throw apiError(404, { success: false, error: "Store not found on this order." });
    if (stop.pickedUpAt != null) return { success: true };
    if (d.stops.find((s) => s.pickedUpAt == null) !== stop) {
      throw apiError(400, { success: false, error: "Pick up from the earlier store first." });
    }
    if (!stop.codeRequired) throw apiError(400, { success: false, error: "This store confirms the pickup itself." });
    if (String(body.code ?? "") !== DEMO_PICKUP_CODE) {
      d.wrongCodes += 1;
      if (d.wrongCodes >= DEMO_MAX_WRONG_ATTEMPTS) {
        d.wrongCodes = 0;
        throw tooManyAttempts();
      }
      throw apiError(400, { success: false, error: "Incorrect pickup code. Check with the store." });
    }
    d.wrongCodes = 0;
    stop.pickedUpAt = now;
    advance(d, now);
    return { success: true };
  }

  if (action === "verify-delivery-otp") {
    if (!allPickedUp(d)) throw apiError(400, { success: false, error: "Pick up from every store first." });
    if (d.otpVerified) return { success: true };
    if (String(body.otp ?? "") !== DEMO_DELIVERY_OTP) {
      d.wrongOtps += 1;
      if (d.wrongOtps >= DEMO_MAX_WRONG_ATTEMPTS) {
        d.wrongOtps = 0;
        throw tooManyAttempts();
      }
      throw apiError(400, { success: false, error: "Incorrect OTP. Ask the customer to check their app." });
    }
    d.wrongOtps = 0;
    d.otpVerified = true;
    return { success: true };
  }

  if (action === "cod/qr" || action === "cod/cash") {
    if (d.amountToCollect <= 0) throw apiError(400, { success: false, error: "This order is prepaid." });
    if (action === "cod/qr") {
      if (!codSettled(d) && d.scenario !== "prepaid" && d.scenario !== "taken") {
        d.cod.status = "awaiting";
        d.cod.qrShownAt = now;
        d.cod.qrCloseBy = now + DEMO_QR_TTL_MS[d.scenario];
      }
      return codResponse(d);
    }
    if (d.cod.status === "paid_upi") {
      throw apiError(409, {
        success: false,
        error: "The customer already paid by UPI. Don't take cash.",
        cod_collection: codCollection(d),
      });
    }
    d.cod.status = "cash_collected";
    d.cod.collectedAt = now;
    return codResponse(d);
  }

  if (action === "delivered") {
    if (!allPickedUp(d)) throw apiError(400, { success: false, error: "Pick up from every store first." });
    if (!d.otpVerified) throw apiError(400, { success: false, error: "Verify the delivery OTP first." });
    if (d.amountToCollect > 0 && !codSettled(d)) throw apiError(400, { success: false, error: "Collect the payment first." });
    d.stage = "delivered";
    return { success: true };
  }

  throw apiError(404, { success: false, error: "Not part of the demo order." });
}

/**
 * Add the demo order to the two real lists it should appear in: the offers
 * on Home while it is on offer, and the active orders once accepted. Real
 * entries are left untouched, and real active orders stay first.
 */
export function transformDemoResponse(d: DemoDelivery | null, req: DemoApiRequest, data: unknown, now: number): unknown {
  if (!d || req.method.toUpperCase() !== "GET" || !data || typeof data !== "object") return data;
  const body = data as Record<string, unknown>;
  if (body.success !== true) return data;
  const [pathname, query = ""] = req.path.split("?");

  if (pathname === "/delivery-partner/available-orders") {
    if (d.stage !== "offered" || now < d.visibleAt) return data;
    return { ...body, offers: [offerPayload(d), ...(Array.isArray(body.offers) ? body.offers : [])] };
  }

  if (pathname === "/delivery-partner/orders") {
    if (d.stage !== "accepted") return data;
    if (queryParam(query, "status") !== "active" || Number(queryParam(query, "offset") ?? 0) > 0) return data;
    advance(d, now);
    return { ...body, orders: [...(Array.isArray(body.orders) ? body.orders : []), activeOrderPayload(d)] };
  }

  return data;
}

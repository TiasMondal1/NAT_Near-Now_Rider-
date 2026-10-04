import { useEffect } from "react";
import type { MutableRefObject } from "react";

/** Active-order poll cadence while the rider is online / deliberately offline. */
export const ACTIVE_ORDER_POLL_ONLINE_MS = 6000;
export const ACTIVE_ORDER_POLL_OFFLINE_MS = 45000;
/** Offers fallback poll; home.tsx's Realtime subscription delivers new offers instantly. */
export const OFFERS_POLL_MS = 15000;

export interface RiderOrderPollingOptions {
  token: string;
  isOnline: boolean;
  /** Only whether there is one matters here (see below). */
  activeOrder: unknown;
  fetchActiveOrder: () => unknown;
  fetchOffers: () => unknown;
  clearOffers: () => void;
  offersPollRef: MutableRefObject<ReturnType<typeof setInterval> | null>;
}

/**
 * The home tab's active-order and offers polling, moved out of
 * app/(tabs)/home.tsx so scripts/check-order-polling.mjs can exercise it.
 *
 * These effects depend on whether there IS an active order, never on the
 * order object. fetchActiveOrder stores a fresh object on every poll, and the
 * single effect this replaces listed that object as a dependency, so every
 * poll response re-ran it, and re-running it fetched again at once: a request
 * loop at network speed for the whole delivery (the tab stays mounted under
 * the delivery screen). Measured with the check script: 142 active-order
 * fetches during mount instead of 1.
 *
 * The immediate fetch now happens once per session token. A change of
 * isOnline only re-arms the interval at the new rate: on mount isOnline is set
 * by the profile request right after the token, and the old effect fetched a
 * second time then; going online through the toggle already fetches in
 * handleToggle.
 */
export function useRiderOrderPolling({
  token,
  isOnline,
  activeOrder,
  fetchActiveOrder,
  fetchOffers,
  clearOffers,
  offersPollRef,
}: RiderOrderPollingOptions): void {
  const hasActiveOrder = !!activeOrder;

  // One immediate active-order fetch per session.
  useEffect(() => {
    if (!token) return;
    fetchActiveOrder();
  }, [token, fetchActiveOrder]);

  // Active orders must always be polled — a simulation or manual dispatch can
  // assign an order even when the driver is marked offline in the app. But a
  // rider deliberately offline doesn't need that caught within 6s — a manual
  // dispatch onto an offline driver is a rare admin action, not something
  // needing near-instant detection — so slow way down (45s) rather than
  // draining battery/network at the same cadence as an actively-online rider.
  useEffect(() => {
    if (!token) return;
    const interval = setInterval(
      fetchActiveOrder,
      isOnline ? ACTIVE_ORDER_POLL_ONLINE_MS : ACTIVE_ORDER_POLL_OFFLINE_MS
    );
    return () => clearInterval(interval);
  }, [token, isOnline, fetchActiveOrder]);

  useEffect(() => {
    if (!token) return;

    if (!isOnline) {
      if (offersPollRef.current) clearInterval(offersPollRef.current);
      offersPollRef.current = null;
      clearOffers();
      return;
    }

    // Offer cards only ever render while there is no active order (see
    // visibleOffers usages in home.tsx) — polling/subscribing for offers
    // during an active delivery burns battery/network on data that can never
    // display, right when GPS tracking is already running hardest.
    if (hasActiveOrder) {
      clearOffers();
      if (offersPollRef.current) clearInterval(offersPollRef.current);
      offersPollRef.current = null;
      return;
    }

    fetchOffers();
    offersPollRef.current = setInterval(fetchOffers, OFFERS_POLL_MS);

    return () => {
      if (offersPollRef.current) clearInterval(offersPollRef.current);
    };
  }, [token, isOnline, hasActiveOrder, fetchOffers, clearOffers, offersPollRef]);
}

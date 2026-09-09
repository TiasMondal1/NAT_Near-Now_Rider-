import { apiFetch } from "../constants/api";

export type UnreadNotification = {
  id: string;
  is_read: boolean;
  type?: string;
  data?: { approved?: boolean; rejectionReason?: string | null };
};

/**
 * Two independent pollers hit `GET /delivery-partner/notifications?unreadOnly=true`
 * on overlapping cadences — useProfileChangeOutcomeGate.ts (every 20s, app-wide)
 * for the profile-review-outcome banner, and (tabs)/home.tsx's fetchUnreadCount
 * (every 30s, while on Home) for the notifications badge. Found 2026-09-09 during
 * a deep-dive audit. Rather than restructure either poller (different owners,
 * different lifetimes — one is root-layout-scoped, one is tab-scoped), this is a
 * short-TTL shared cache: whichever poller calls first does the real network
 * request, and any other caller within the TTL window gets that same result
 * instead of firing a redundant one. Session-lifetime in-memory only, same
 * pattern as riderVerificationCache.ts.
 */
const TTL_MS = 8000; // comfortably under both pollers' intervals (20s/30s)

let cached: { data: UnreadNotification[]; ts: number } | null = null;
let inFlight: Promise<UnreadNotification[]> | null = null;

export async function fetchUnreadNotificationsShared(token: string): Promise<UnreadNotification[]> {
  const now = Date.now();
  if (cached && now - cached.ts < TTL_MS) return cached.data;
  if (inFlight) return inFlight;

  inFlight = apiFetch<UnreadNotification[]>("/delivery-partner/notifications?unreadOnly=true", {}, token)
    .then((data) => {
      const list = Array.isArray(data) ? data : [];
      cached = { data: list, ts: Date.now() };
      return list;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Call after marking a notification read so the next check reflects it immediately, not up to TTL_MS stale. */
export function invalidateUnreadNotificationsCache(): void {
  cached = null;
}

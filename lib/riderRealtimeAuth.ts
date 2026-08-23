import type { SupabaseClient } from "@supabase/supabase-js";
import { getSession, saveSession } from "../session";

// GoTrue rotates the refresh token on every silent refresh (access tokens
// last ~1hr). This app's own session lives up to 30 days without the rider
// ever re-verifying OTP, so without persisting each rotation back to
// SecureStore, a long-lived session would eventually try to restore a
// refresh token GoTrue already rotated away from — Realtime would quietly
// stop working with no visible symptom beyond "the poll must be doing all
// the work". One listener per client instance (guarded below), since these
// are module-level singletons that outlive any single screen mount.
const listenerRegistered = new WeakSet<SupabaseClient>();

/**
 * Restores the rider's Supabase Auth bridge session (minted server-side at
 * login/signup — see backend/src/services/riderAuthBridge.service.ts) onto
 * the given client, so Realtime's RLS check has a real auth.uid() to
 * evaluate against the partner_own_record policy. Returns the rider's
 * user_id (for building the channel filter), or null if there's no bridge
 * session to restore — which just means the mint failed server-side and the
 * caller should rely on its poll fallback instead.
 */
export async function restoreRiderRealtimeSession(client: SupabaseClient): Promise<string | null> {
  // Every call site chains this with a bare `.then(...)`, no `.catch()` —
  // client.auth.setSession() (GoTrue) can throw on some network/storage
  // failure paths, not just resolve with `{ error }`, so this whole body is
  // wrapped rather than relying on callers to catch it. An uncaught
  // rejection here is exactly the failure shape that caused a real crash
  // elsewhere in this app (see home.tsx's location-permission fix) —
  // Realtime is a best-effort enhancement over the poll fallback, so any
  // failure here should degrade to that, never crash.
  try {
    const session = await getSession();
    if (!session?.supabaseSession || !session?.user?.id) return null;

    const { error } = await client.auth.setSession({
      access_token: session.supabaseSession.accessToken,
      refresh_token: session.supabaseSession.refreshToken,
    });
    if (error) return null;

    if (!listenerRegistered.has(client)) {
      listenerRegistered.add(client);
      client.auth.onAuthStateChange((event, newSession) => {
        if (event !== "TOKEN_REFRESHED" || !newSession) return;
        getSession().then((current) => {
          if (!current) return;
          saveSession({
            ...current,
            supabaseSession: {
              accessToken: newSession.access_token,
              refreshToken: newSession.refresh_token,
            },
          }).catch(() => {});
        }).catch(() => {});
      });
    }

    return session.user.id;
  } catch (err) {
    console.warn("[riderRealtimeAuth] restoreRiderRealtimeSession failed:", err);
    return null;
  }
}

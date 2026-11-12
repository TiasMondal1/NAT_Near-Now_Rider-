import { router } from "expo-router";
import { apiFetch } from "../constants/api";
import { clearSession, getSession } from "../session";
import { stopBackgroundLocationTracking } from "./backgroundLocationTask";
import { setCrashUser } from "./crashReporting";

/**
 * The one logout path for every screen (profile, signup "go back",
 * pending-verification). Order matters:
 *
 *  1. Mark the rider offline so dispatch stops offering them orders.
 *  2. Clear the Expo push token server-side — on a shared device the next
 *     rider would otherwise receive this rider's order/status pushes.
 *  3. Stop the background location task so the foreground service and its
 *     "Sharing your location…" notification don't outlive the session.
 *  4. Wipe the local session and go to /phone.
 *
 * Steps 1–3 are best-effort: logging out must never be blocked by them.
 */
export async function logout(opts: { markOffline?: boolean } = {}): Promise<void> {
  try {
    const session = await getSession();
    if (session?.token) {
      if (opts.markOffline) {
        await apiFetch("/delivery-partner/status", { method: "PATCH", body: { is_online: false } }, session.token, 0).catch(
          () => {}
        );
      }
      await apiFetch(
        "/delivery-partner/push-token",
        { method: "PATCH", body: { expo_push_token: null } },
        session.token,
        0
      ).catch(() => {});
    }
  } catch {
    // Non-fatal.
  }
  await stopBackgroundLocationTracking().catch(() => {});
  setCrashUser(null);
  await clearSession();
  router.replace("/phone");
}

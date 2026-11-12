/**
 * Functional checks for the developer tools screen (app/dev-tools.tsx).
 *
 * Each check exercises one thing the app depends on — the connection, the
 * backend, every endpoint the tabs read, Realtime, location, the background
 * task, notifications — and reports what it found in plain words. They only
 * read: nothing is changed on the server, the rider is not put online, and
 * no permission prompt is shown.
 */
import { Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { API_BASE, apiFetch } from "../constants/api";
import { getSession } from "../session";
import { BACKGROUND_LOCATION_TASK } from "./backgroundLocationTask";
import { fetchBillingInfo } from "./billingInfo";
import { DevNotifications, IS_EXPO_GO } from "./devTools";
import { ORDERS_CHANNEL_ID } from "./orderAlertChannel";
import { restoreRiderRealtimeSession } from "./riderRealtimeAuth";
import {
  fetchVerificationDocuments,
  isVehicleRegistrationRequired,
  REQUIRED_DOC_KEYS,
} from "./riderVerificationDocuments";
import { isSupabaseConfigured, supabase } from "./supabase";

export type CheckStatus = "pass" | "warn" | "fail" | "skip";
export type CheckOutcome = { status: CheckStatus; detail: string };
export type CheckResult = CheckOutcome & { id: string; label: string };

type CheckContext = {
  token: string | null;
  expiresAt: number | null;
  /** Filled in by the account check, used by the documents check. */
  vehicleType: string | null;
};

type Check = {
  id: string;
  label: string;
  /** Skipped with "log in first" when there is no session. */
  needsLogin?: boolean;
  run: (ctx: CheckContext) => Promise<CheckOutcome>;
};

const CHECK_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer in ${Math.round(ms / 1000)} s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function errorText(err: unknown): string {
  const e = err as { error?: string; message?: string; status?: number } | null;
  const text = e?.error || e?.message || String(err);
  return e?.status ? `${text} (HTTP ${e.status})` : text;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** An authenticated GET that is reported as reachable, with what it returned. */
async function endpoint<T>(path: string, token: string, describe: (data: T) => string): Promise<CheckOutcome> {
  const started = Date.now();
  const data = await apiFetch<T>(path, {}, token, 0);
  return { status: "pass", detail: `${describe(data)} · ${Date.now() - started} ms` };
}

const CHECKS: Check[] = [
  {
    id: "internet",
    label: "Internet connection",
    run: async () => {
      const state = await NetInfo.fetch();
      if (!state.isConnected) return { status: "fail", detail: "This phone is offline" };
      if (state.isInternetReachable === false) return { status: "fail", detail: `Connected to ${state.type}, but no internet access` };
      return { status: "pass", detail: `Connected (${state.type})` };
    },
  },
  {
    id: "backend",
    label: "Backend server",
    run: async () => {
      const host = API_BASE.replace(/^https?:\/\//, "");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const started = Date.now();
      try {
        // Any HTTP answer, even a 404 for the bare root, proves the server is up.
        const res = await fetch(`${API_BASE}/`, { signal: controller.signal });
        const ms = Date.now() - started;
        return {
          status: res.status >= 500 ? "warn" : "pass",
          detail: `${host} answered HTTP ${res.status} in ${ms} ms`,
        };
      } catch (err: any) {
        return {
          status: "fail",
          detail: `${host} did not answer: ${err?.name === "AbortError" ? "timed out after 10 s" : errorText(err)}`,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  },
  {
    id: "session",
    label: "Login session",
    run: async (ctx) => {
      if (!ctx.token) return { status: "warn", detail: "Not logged in. Checks that need an account are skipped." };
      const days = ctx.expiresAt ? Math.max(0, Math.round((ctx.expiresAt - Date.now()) / 86_400_000)) : null;
      return { status: "pass", detail: days == null ? "Logged in" : `Logged in · expires in ${plural(days, "day")}` };
    },
  },
  {
    id: "account",
    label: "Rider account",
    needsLogin: true,
    run: async (ctx) => {
      const res = await apiFetch<{
        profile?: { status?: string | null; is_approved?: boolean | null; is_online?: boolean; vehicle_type?: string | null };
      }>("/delivery-partner/profile", {}, ctx.token!, 0);
      const p = res.profile;
      if (!p) return { status: "fail", detail: "The server returned no rider profile for this login" };
      ctx.vehicleType = p.vehicle_type ?? null;
      const canWork = p.status === "active" && p.is_approved !== false;
      return {
        status: canWork ? "pass" : "warn",
        detail: [
          `Status: ${p.status ?? "unknown"}`,
          p.is_approved === false ? "not approved" : "approved",
          p.is_online ? "online" : "offline",
          p.vehicle_type ?? "no vehicle type",
        ].join(" · "),
      };
    },
  },
  {
    id: "documents",
    label: "Verification documents",
    needsLogin: true,
    run: async (ctx) => {
      const docs = await fetchVerificationDocuments(ctx.token!);
      const required = REQUIRED_DOC_KEYS.filter(
        (key) => key !== "vehicle_registration" || isVehicleRegistrationRequired(ctx.vehicleType)
      );
      const mine = docs.filter((d) => required.includes(d.doc_type));
      const uploaded = mine.filter((d) => !!d.url).length;
      const approved = mine.filter((d) => d.status === "approved").length;
      const rejected = mine.filter((d) => d.status === "rejected").length;
      return {
        status: rejected === 0 && uploaded === required.length ? "pass" : "warn",
        detail: `${uploaded}/${required.length} uploaded · ${approved} approved${rejected ? ` · ${rejected} rejected` : ""}`,
      };
    },
  },
  {
    id: "billing",
    label: "Payout details",
    needsLogin: true,
    run: async (ctx) => {
      const info = await fetchBillingInfo(ctx.token!);
      return info.upiId
        ? { status: "pass", detail: "UPI ID is on file" }
        : { status: "warn", detail: "No approved UPI ID yet (none entered, or still waiting for review)" };
    },
  },
  {
    id: "offers",
    label: "Order offers",
    needsLogin: true,
    run: (ctx) =>
      endpoint<{ offers?: unknown[] }>("/delivery-partner/available-orders", ctx.token!, (d) =>
        plural(d.offers?.length ?? 0, "offer")
      ),
  },
  {
    id: "active-orders",
    label: "Active deliveries",
    needsLogin: true,
    run: (ctx) =>
      endpoint<{ orders?: unknown[] }>("/delivery-partner/orders?status=active", ctx.token!, (d) =>
        plural(d.orders?.length ?? 0, "active order")
      ),
  },
  {
    id: "history",
    label: "Order history and earnings",
    needsLogin: true,
    run: (ctx) =>
      endpoint<{ orders?: unknown[]; has_more?: boolean }>(
        "/delivery-partner/orders?status=completed&limit=1",
        ctx.token!,
        (d) => ((d.orders?.length ?? 0) > 0 ? "Past deliveries found" : "No past deliveries yet")
      ),
  },
  {
    id: "inbox",
    label: "Notification inbox",
    needsLogin: true,
    run: (ctx) =>
      endpoint<unknown[]>("/delivery-partner/notifications?unreadOnly=true", ctx.token!, (d) =>
        `${Array.isArray(d) ? d.length : 0} unread`
      ),
  },
  {
    id: "support",
    label: "Support contacts",
    needsLogin: true,
    run: async (ctx) => {
      try {
        const res = await apiFetch<{ contacts?: unknown[] }>("/delivery-partner/support-contacts", {}, ctx.token!, 0);
        const count = Array.isArray(res.contacts) ? res.contacts.length : 0;
        return count > 0
          ? { status: "pass", detail: `${plural(count, "contact")} from the server` }
          : { status: "warn", detail: "The server sent no contacts. The app shows its built-in list." };
      } catch (err) {
        return { status: "warn", detail: `Not available (${errorText(err)}). The app shows its built-in list.` };
      }
    },
  },
  {
    id: "realtime",
    label: "Realtime updates",
    needsLogin: true,
    run: async () => {
      if (!isSupabaseConfigured) {
        return { status: "fail", detail: "Supabase URL or key is missing from this build. The app runs on polling only." };
      }
      const userId = await restoreRiderRealtimeSession(supabase);
      if (!userId) {
        return {
          status: "warn",
          detail: "This login has no Realtime session (normal after a saved demo login). Offers arrive by the 15 s poll.",
        };
      }
      return new Promise<CheckOutcome>((resolve) => {
        const started = Date.now();
        const channel = supabase.channel(`devtools-check:${started}`);
        let settled = false;
        const finish = (outcome: CheckOutcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void supabase.removeChannel(channel);
          resolve(outcome);
        };
        const timer = setTimeout(() => finish({ status: "fail", detail: "No answer from Realtime in 10 s" }), 10_000);
        channel
          .on(
            "postgres_changes",
            { event: "UPDATE", schema: "public", table: "delivery_partners", filter: `user_id=eq.${userId}` },
            () => {}
          )
          .subscribe((status, err) => {
            if (status === "SUBSCRIBED") finish({ status: "pass", detail: `Subscribed in ${Date.now() - started} ms` });
            else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              finish({ status: "fail", detail: err?.message ? `${status}: ${err.message}` : status });
            }
          });
      });
    },
  },
  {
    id: "location-permission",
    label: "Location permission",
    run: async () => {
      const fg = await Location.getForegroundPermissionsAsync();
      if (fg.status !== "granted") {
        return { status: "fail", detail: `Not granted (${fg.status}). The rider cannot be tracked or go online properly.` };
      }
      const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
      return bg?.status === "granted"
        ? { status: "pass", detail: "Allowed all the time" }
        : { status: "warn", detail: "Allowed only while the app is open. Tracking stops when the app is in the background." };
    },
  },
  {
    id: "location-services",
    label: "Location services (GPS)",
    run: async () =>
      (await Location.hasServicesEnabledAsync())
        ? { status: "pass", detail: "Switched on" }
        : { status: "fail", detail: "Location is switched off in the phone's settings" },
  },
  {
    id: "gps-fix",
    label: "Current position",
    run: async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return { status: "skip", detail: "Needs location permission" };
      const started = Date.now();
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const accuracy = loc.coords.accuracy != null ? ` · accurate to ${Math.round(loc.coords.accuracy)} m` : "";
      return {
        status: "pass",
        detail: `${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}${accuracy} · ${Date.now() - started} ms`,
      };
    },
  },
  {
    id: "background-task",
    label: "Background location task",
    run: async () => {
      if (!(await TaskManager.isAvailableAsync())) return { status: "fail", detail: "Background tasks are not available in this build" };
      if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) return { status: "fail", detail: "The task is not defined" };
      const running = await TaskManager.isTaskRegisteredAsync(BACKGROUND_LOCATION_TASK);
      return {
        status: "pass",
        detail: running ? "Ready and running now" : "Ready. It runs while you are online and the app is in the background.",
      };
    },
  },
  {
    id: "notification-permission",
    label: "Notification permission",
    run: async () => {
      if (!DevNotifications) return { status: "skip", detail: IS_EXPO_GO ? "Needs a dev or preview build, not Expo Go" : "Not available" };
      const perm = await DevNotifications.getPermissionsAsync();
      if (perm.status === "granted") return { status: "pass", detail: "Granted" };
      return {
        status: "fail",
        detail: perm.canAskAgain === false ? "Blocked in the phone's settings" : `Not granted (${perm.status})`,
      };
    },
  },
  {
    id: "notification-channel",
    label: "Order alert channel",
    run: async () => {
      if (!DevNotifications) return { status: "skip", detail: IS_EXPO_GO ? "Needs a dev or preview build, not Expo Go" : "Not available" };
      if (Platform.OS !== "android") return { status: "skip", detail: "Android only" };
      const channel = await DevNotifications.getNotificationChannelAsync(ORDERS_CHANNEL_ID);
      if (!channel) {
        return { status: "warn", detail: "Not created yet. It is created after login once notifications are allowed." };
      }
      const loud = channel.importance >= DevNotifications.AndroidImportance.HIGH;
      return {
        status: loud && channel.sound ? "pass" : "warn",
        detail: `${loud ? "Pops up on screen" : "Silent or low importance (changed in the phone's settings)"} · ${
          channel.sound ? "order chime" : "no sound"
        }`,
      };
    },
  },
  {
    id: "push-token",
    label: "Push registration",
    run: async () => {
      if (!DevNotifications) return { status: "skip", detail: IS_EXPO_GO ? "Needs a dev or preview build, not Expo Go" : "Not available" };
      const { status } = await DevNotifications.getPermissionsAsync();
      if (status !== "granted") return { status: "skip", detail: "Needs notification permission" };
      const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
      const token = await DevNotifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      return { status: "pass", detail: `This phone has a push token (ends ${token.data.slice(-9)})` };
    },
  },
];

/** Ids and labels in run order, for drawing the list before anything has run. */
export const CHECK_LIST: readonly { id: string; label: string }[] = CHECKS.map(({ id, label }) => ({ id, label }));

/**
 * Run every check in order, reporting each result as it finishes. A check
 * that throws or hangs is reported as failed; it never stops the rest.
 */
export async function runDiagnostics(
  onResult: (result: CheckResult) => void,
  isCancelled: () => boolean = () => false
): Promise<void> {
  const session = await getSession().catch(() => null);
  const signedIn = !!session?.token && !session.needsSignupCompletion;
  const ctx: CheckContext = {
    token: signedIn ? session!.token : null,
    expiresAt: signedIn ? session!.expiresAt ?? null : null,
    vehicleType: null,
  };
  for (const check of CHECKS) {
    if (isCancelled()) return;
    let outcome: CheckOutcome;
    try {
      outcome =
        check.needsLogin && !ctx.token
          ? { status: "skip", detail: "Log in to run this check" }
          : await withTimeout(check.run(ctx), CHECK_TIMEOUT_MS);
    } catch (err) {
      outcome = { status: "fail", detail: errorText(err) };
    }
    if (isCancelled()) return;
    onResult({ id: check.id, label: check.label, ...outcome });
  }
}

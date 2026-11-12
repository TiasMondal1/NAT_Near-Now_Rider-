/**
 * Developer tools — testing aids for dev clients and "preview" builds.
 *
 * `DEV_TOOLS_AVAILABLE` is false in every other release (production
 * included), and everything here returns early without it, so a production
 * build has no entry point and no demo data.
 *
 * Where a build has them they start hidden. Tapping the build number seven
 * times (components/BuildVersionLabel.tsx, on Profile and on the login
 * screen) shows them; the switch on the tools screen hides them again.
 *
 *  - Functional checks: lib/diagnostics.ts.
 *  - Demo order: a pretend delivery (lib/demoDelivery.ts) that the real
 *    screens run against. It is plugged into apiFetch here and never reaches
 *    the backend.
 *  - Test notification: a local notification on the order-alert channel.
 *  - Saved demo login: reuse one real OTP login instead of paying for an SMS
 *    on every re-login. The token is the one a real login stores; nothing is
 *    bypassed on the server.
 */
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { apiFetch, setApiInterceptor } from "../constants/api";
import { APP_ENV } from "../constants/config";
import { getSession, type UserSession } from "../session";
import { devToolsAvailable } from "./devToolsRules";
import {
  createDemoDelivery,
  handleDemoRequest,
  isDemoRequest,
  transformDemoResponse,
  type DemoDelivery,
  type DemoScenario,
} from "./demoDelivery";
import { DEMO_QR_IMAGE } from "./demoQrImage";
import { ensureOrdersChannel, ORDERS_CHANNEL_ID, ORDER_CHIME_SOUND } from "./orderAlertChannel";

/** Dev client or EXPO_PUBLIC_ENV=preview only — see lib/devToolsRules.ts. */
export const DEV_TOOLS_AVAILABLE: boolean = devToolsAvailable(APP_ENV, typeof __DEV__ !== "undefined" && __DEV__);

// expo-notifications is unsupported in Expo Go (SDK 53+); same conditional
// require as app/_layout.tsx.
export const IS_EXPO_GO = Constants.executionEnvironment === "storeClient";
let Notifications: typeof import("expo-notifications") | null = null;
if (DEV_TOOLS_AVAILABLE && !IS_EXPO_GO) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");
}
/** expo-notifications for the tools and checks; null in Expo Go and in production builds. */
export const DevNotifications = Notifications;

// ─── Shown or hidden ─────────────────────────────────────────────────────────

const ENABLED_KEY = "dev_tools_enabled_v1";
let enabledMem: boolean | null = null;
const enabledListeners = new Set<(v: boolean) => void>();

export async function isDevToolsEnabled(): Promise<boolean> {
  if (!DEV_TOOLS_AVAILABLE) return false;
  if (enabledMem != null) return enabledMem;
  try {
    enabledMem = (await AsyncStorage.getItem(ENABLED_KEY)) === "1";
  } catch {
    enabledMem = false;
  }
  return enabledMem;
}

export async function setDevToolsEnabled(v: boolean): Promise<void> {
  if (!DEV_TOOLS_AVAILABLE) return;
  enabledMem = v;
  // Hiding the tools must not leave a pretend order on Home.
  if (!v) removeDemoDelivery();
  enabledListeners.forEach((l) => l(v));
  try {
    await AsyncStorage.setItem(ENABLED_KEY, v ? "1" : "0");
  } catch {
    // The in-memory flag still applies for this run.
  }
}

/** Whether the tools are currently shown. Always false in a production build. */
export function useDevToolsEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!DEV_TOOLS_AVAILABLE) return;
    let active = true;
    void isDevToolsEnabled().then((v) => {
      if (active) setEnabled(v);
    });
    enabledListeners.add(setEnabled);
    return () => {
      active = false;
      enabledListeners.delete(setEnabled);
    };
  }, []);
  return enabled;
}

// ─── Saved demo login ────────────────────────────────────────────────────────

const DEMO_SESSION_KEY = "dev_demo_session_v1";

export async function saveDemoSession(session: UserSession): Promise<void> {
  if (!DEV_TOOLS_AVAILABLE) return;
  // The Realtime bridge tokens are left out: the refresh token is single-use
  // and rotates while the app runs, so a saved copy would be stale (and the
  // pair would not fit in one SecureStore entry). After a demo login the app
  // runs on polling; do a real OTP login to test Realtime.
  const copy: UserSession = { token: session.token, expiresAt: session.expiresAt, user: session.user };
  await SecureStore.setItemAsync(DEMO_SESSION_KEY, JSON.stringify(copy));
}

export async function loadDemoSession(): Promise<UserSession | null> {
  if (!DEV_TOOLS_AVAILABLE) return null;
  try {
    const raw = await SecureStore.getItemAsync(DEMO_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserSession;
    if (!parsed?.token || !parsed?.user?.id) return null;
    if (parsed.expiresAt && parsed.expiresAt < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearDemoSession(): Promise<void> {
  await SecureStore.deleteItemAsync(DEMO_SESSION_KEY).catch(() => {});
}

// ─── Local notifications ─────────────────────────────────────────────────────

type Scheduled = { ok: true; id: string } | { ok: false; reason: string };

async function scheduleLocalNotification(
  title: string,
  body: string,
  seconds: number,
  data: Record<string, unknown>
): Promise<Scheduled> {
  if (!Notifications) {
    return { ok: false, reason: IS_EXPO_GO ? "Notifications need a dev or preview build, not Expo Go." : "Not available in this build." };
  }
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") return { ok: false, reason: "Notification permission is not granted." };
    if (Platform.OS === "android") await ensureOrdersChannel(Notifications);
    const id = await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: ORDER_CHIME_SOUND, data },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.round(seconds)),
        channelId: ORDERS_CHANNEL_ID,
      },
    });
    return { ok: true, id };
  } catch (e: any) {
    return { ok: false, reason: e?.message || "Couldn't schedule the notification." };
  }
}

/** A local notification on the order-alert channel, with the order chime. */
export async function sendTestNotification(delaySeconds = 5): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!DEV_TOOLS_AVAILABLE) return { ok: false, reason: "Not available in this build." };
  const res = await scheduleLocalNotification(
    "Test notification",
    "If you can see and hear this, order alerts work on this phone.",
    delaySeconds,
    { type: "dev_test" }
  );
  return res.ok ? { ok: true } : res;
}

// ─── Demo order ──────────────────────────────────────────────────────────────

/** Delay between tapping "Simulate" and the offer arriving. */
export const DEMO_ORDER_DELAY_MS = 10_000;

let demo: DemoDelivery | null = null;
let demoTimer: ReturnType<typeof setTimeout> | null = null;
let demoNotificationId: string | null = null;
let interceptorInstalled = false;
const demoListeners = new Set<() => void>();

function emitDemoOrdersChanged(): void {
  demoListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A screen's refresh failing is not the tools' problem.
    }
  });
}

/**
 * Called whenever the demo order appears in, or leaves, the offers or the
 * active orders. Home listens so it refetches at once: a demo order has no
 * Realtime row to announce it. Never fires in a production build.
 */
export function onDemoOrdersChanged(listener: () => void): () => void {
  if (!DEV_TOOLS_AVAILABLE) return () => {};
  demoListeners.add(listener);
  return () => {
    demoListeners.delete(listener);
  };
}

export function getDemoDelivery(): DemoDelivery | null {
  return demo;
}

function installInterceptor(): void {
  if (interceptorInstalled) return;
  interceptorInstalled = true;
  setApiInterceptor({
    handle: (req) => {
      if (!isDemoRequest(req.path)) return undefined;
      const before = demo?.stage;
      try {
        return handleDemoRequest(demo, req, Date.now());
      } finally {
        // Accepted, taken or delivered: the lists on Home just changed. Off
        // the request's own call stack, so the caller finishes first.
        if (demo?.stage !== before) setTimeout(emitDemoOrdersChanged, 0);
      }
    },
    transform: (req, data) => transformDemoResponse(demo, req, data, Date.now()),
  });
}

function stopDemoTimers(): void {
  if (demoTimer) {
    clearTimeout(demoTimer);
    demoTimer = null;
  }
  if (demoNotificationId && Notifications) {
    void Notifications.cancelScheduledNotificationAsync(demoNotificationId).catch(() => {});
  }
  demoNotificationId = null;
}

function removeDemoDelivery(): void {
  stopDemoTimers();
  if (!demo) return;
  demo = null;
  emitDemoOrdersChanged();
}

/**
 * Raise a pretend order. The offer appears on Home after `delayMs` (the rider
 * has to be online to see offers) together with a real local notification,
 * so leaving the app or locking the phone tests the alert too.
 */
export async function startDemoDelivery(
  scenario: DemoScenario,
  delayMs: number = DEMO_ORDER_DELAY_MS
): Promise<{ ok: true; notification: string | null } | { ok: false; reason: string }> {
  if (!DEV_TOOLS_AVAILABLE) return { ok: false, reason: "Developer tools are not part of this build." };
  const session = await getSession();
  if (!session?.token || session.needsSignupCompletion) return { ok: false, reason: "Log in first." };

  removeDemoDelivery();

  // A demo order must never sit in front of real work.
  try {
    const res = await apiFetch<{ orders?: unknown[] }>("/delivery-partner/orders?status=active", {}, session.token, 0);
    if ((res.orders?.length ?? 0) > 0) {
      return { ok: false, reason: "You have a real delivery in progress. Finish it before starting a demo order." };
    }
  } catch {
    return {
      ok: false,
      reason: "Couldn't reach the server. The demo order is shown inside the app's real lists, so it needs a working connection.",
    };
  }

  let near: { lat: number; lng: number } | null = null;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    const loc = status === "granted" ? await Location.getLastKnownPositionAsync() : null;
    if (loc) near = { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    // No fix: the demo uses a default location.
  }

  const created = createDemoDelivery({ now: Date.now(), delayMs, scenario, near, qrImageUrl: DEMO_QR_IMAGE });
  demo = created;
  installInterceptor();
  demoTimer = setTimeout(() => {
    demoTimer = null;
    emitDemoOrdersChanged();
  }, delayMs + 50);

  const scheduled = await scheduleLocalNotification(
    "New order request",
    `Demo order #${created.orderCode} · ${created.stops.length} stores`,
    delayMs / 1000,
    { type: "new_order_offer", demo: true }
  );
  // Cancelled or replaced while the notification was being scheduled.
  if (demo !== created) {
    if (scheduled.ok && Notifications) void Notifications.cancelScheduledNotificationAsync(scheduled.id).catch(() => {});
    return { ok: false, reason: "The demo order was cancelled." };
  }
  demoNotificationId = scheduled.ok ? scheduled.id : null;
  return { ok: true, notification: scheduled.ok ? null : scheduled.reason };
}

/**
 * End the demo order. Before it is accepted it simply disappears. Once
 * accepted it turns into a cancelled order, so the delivery screen's "order
 * was cancelled" path runs on its next refresh.
 */
export function cancelDemoDelivery(): void {
  stopDemoTimers();
  if (!demo) return;
  if (demo.stage === "accepted") demo.stage = "cancelled";
  else demo = null;
  emitDemoOrdersChanged();
}

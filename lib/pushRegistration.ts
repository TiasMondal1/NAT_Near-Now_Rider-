import { Platform } from "react-native";
import Constants from "expo-constants";
import { apiFetch } from "../constants/api";
import { getSession } from "../session";
import { ensureOrdersChannel } from "./orderAlertChannel";

// expo-notifications is unsupported in Expo Go (SDK 53+).
const isExpoGo = Constants.executionEnvironment === "storeClient";

/**
 * Make this phone able to receive order pushes: notification permission,
 * the order-alert channel, and the push token saved on the server.
 *
 * Called after login (app/_layout.tsx) and again from Home when the rider
 * turns notifications on later. Before that second call existed, a rider who
 * refused the first prompt and allowed notifications afterwards still got no
 * pushes until the next login, because the token was only ever sent once.
 *
 * `prompt: false` never shows the system dialog; it only registers if
 * permission is already there. Returns whether the token reached the server.
 */
export async function registerForOrderPushes({ prompt }: { prompt: boolean }): Promise<boolean> {
  if (isExpoGo || Platform.OS === "web") return false;
  // Conditional require, not a static import: see app/_layout.tsx.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Notifications = require("expo-notifications") as typeof import("expo-notifications");

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== "granted" && prompt) {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return false;

  if (Platform.OS === "android") {
    // The "orders_v2" channel with the order sound — defined once in
    // lib/orderAlertChannel.ts (see there for why the id is _v2).
    await ensureOrdersChannel(Notifications);
  }

  // Explicit projectId, not just implicit auto-resolution — this app had no
  // EAS project linked at all until 2026-08-25 (see app.config.js's
  // easProjectId comment), so getExpoPushTokenAsync() with no args had
  // nothing to resolve and silently failed for every install. Passing it
  // explicitly fails loudly (the caller logs it) instead of depending on
  // Constants auto-population working in every build environment.
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  const tokenData = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  const session = await getSession();
  if (!session?.token) return false;
  await apiFetch(
    "/delivery-partner/push-token",
    { method: "PATCH", body: { expo_push_token: tokenData.data } },
    session.token
  );
  return true;
}

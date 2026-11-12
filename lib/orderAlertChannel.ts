import { Colors } from "../constants/theme";

/**
 * The Android notification channel order alerts arrive on. One definition,
 * used by the push setup in app/_layout.tsx and by the developer tools' test
 * notifications, so both always describe the same channel.
 *
 * The id ends in _v2 because Android fixes a channel's sound when it is
 * created: the original "orders" channel could never pick up
 * order_chime.wav, only a channel with a new id does. The id must match
 * `defaultChannel` in app.config.js.
 */
export const ORDERS_CHANNEL_ID = "orders_v2";
export const ORDER_CHIME_SOUND = "order_chime.wav";

type NotificationsModule = typeof import("expo-notifications");

export function ensureOrdersChannel(Notifications: NotificationsModule) {
  return Notifications.setNotificationChannelAsync(ORDERS_CHANNEL_ID, {
    name: "Order Alerts",
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: Colors.accent,
    sound: ORDER_CHIME_SOUND,
  });
}

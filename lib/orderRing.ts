import { AppState, Platform, Vibration } from "react-native";
import Constants from "expo-constants";
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";

/**
 * The order-request ring: the order sound on a loop, with vibration, from the
 * moment a request is waiting until the rider accepts or ignores it (or the
 * request goes away). Home starts and stops it; nothing else should.
 *
 * What it covers and what it cannot:
 *  - App open: rings straight away. The push notification's own sound is
 *    muted in app/_layout.tsx so the two do not overlap.
 *  - App in the background or phone locked, app still running: the push
 *    notification plays the sound once (the system does that, and it cannot
 *    be muted from here), then this loop takes over when that has finished.
 *  - App closed by the system or swiped away: no JavaScript runs, so only
 *    the push notification rings, once per push. Repeating there needs the
 *    server to send the push again while the request is unanswered.
 *
 * The loop plays on the media volume, not the notification volume. The
 * vibration is there so a rider with media turned down still notices.
 */

// The same file the notification channel uses (lib/orderAlertChannel.ts).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ORDER_SOUND = require("../assets/sounds/order_chime.mp3");

/** Length of the order sound, plus a little: how long the push's own copy plays. */
export const PUSH_SOUND_MS = 15_500;

/** Push `data.type` of an order request (see app/_layout.tsx). */
export const ORDER_OFFER_PUSH_TYPE = "new_order_offer";

const VIBRATION_PATTERN = [0, 700, 500, 700, 1600];

const isExpoGo = Constants.executionEnvironment === "storeClient";

type NotificationsModule = typeof import("expo-notifications");
function notificationsModule(): NotificationsModule | null {
  // Unsupported in Expo Go (SDK 53+) and pointless on web.
  if (isExpoGo || Platform.OS === "web") return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("expo-notifications") as NotificationsModule;
}

let player: AudioPlayer | null = null;
let audioModeReady: Promise<void> | null = null;
let ringing = false;
let startTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSub: { remove: () => void } | null = null;

function prepareAudioMode(): Promise<void> {
  if (!audioModeReady) {
    audioModeReady = setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "duckOthers",
    }).catch((err) => {
      console.warn("[orderRing] audio mode not set:", err);
    });
  }
  return audioModeReady;
}

/**
 * Take the order-request notifications out of the tray, which also stops the
 * sound the system is playing for them. Only while the app is on screen: in
 * the background the notification is the only thing telling the rider.
 */
async function dismissOfferNotifications(): Promise<void> {
  if (AppState.currentState !== "active") return;
  const Notifications = notificationsModule();
  if (!Notifications) return;
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all(
      presented
        .filter((n) => (n.request.content.data as { type?: string } | null)?.type === ORDER_OFFER_PUSH_TYPE)
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier))
    );
  } catch {
    // Best effort.
  }
}

async function beginLoop(): Promise<void> {
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  appStateSub?.remove();
  appStateSub = null;
  if (!ringing) return;

  void dismissOfferNotifications();
  if (Platform.OS !== "web") Vibration.vibrate(VIBRATION_PATTERN, true);

  try {
    await prepareAudioMode();
    // Stopped while the audio mode was being set.
    if (!ringing) return;
    if (!player) {
      player = createAudioPlayer(ORDER_SOUND);
      player.loop = true;
    }
    await player.seekTo(0).catch(() => {});
    if (!ringing) return;
    player.play();
  } catch (err) {
    // The vibration above still runs; a missing sound must not break Home.
    console.warn("[orderRing] could not play the order sound:", err);
  }
}

export function isOrderRinging(): boolean {
  return ringing;
}

/** Start ringing. Safe to call again while already ringing. */
export function startOrderRing(): void {
  if (ringing) return;
  ringing = true;

  if (AppState.currentState === "active") {
    void beginLoop();
    return;
  }
  // Not on screen: the push notification is playing the same sound right
  // now. Wait for it to finish instead of playing over it — or start at once
  // if the rider opens the app first.
  startTimer = setTimeout(() => void beginLoop(), PUSH_SOUND_MS);
  appStateSub = AppState.addEventListener("change", (state) => {
    if (state === "active" && startTimer) void beginLoop();
  });
}

/** Stop ringing. Safe to call when not ringing. */
export function stopOrderRing(): void {
  if (!ringing) return;
  ringing = false;
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
  appStateSub?.remove();
  appStateSub = null;
  if (Platform.OS !== "web") Vibration.cancel();
  try {
    player?.pause();
  } catch {
    // Player already released.
  }
  void dismissOfferNotifications();
}

// ─── Push arrival ────────────────────────────────────────────────────────────

const offerPushListeners = new Set<() => void>();

/** Home listens so a request shows (and rings) the moment its push lands. */
export function onOfferPush(listener: () => void): () => void {
  offerPushListeners.add(listener);
  return () => {
    offerPushListeners.delete(listener);
  };
}

/** Called by the push listener in app/_layout.tsx. */
export function notifyOfferPush(): void {
  offerPushListeners.forEach((l) => {
    try {
      l();
    } catch {
      // A listener must not break notification handling.
    }
  });
}

// ─── Notification permission ─────────────────────────────────────────────────

export type OrderAlertPermission = { granted: boolean; canAskAgain: boolean };

/** Null where it cannot be known (Expo Go, web). */
export async function getOrderAlertPermission(): Promise<OrderAlertPermission | null> {
  const Notifications = notificationsModule();
  if (!Notifications) return null;
  try {
    const p = await Notifications.getPermissionsAsync();
    return { granted: p.status === "granted", canAskAgain: p.canAskAgain };
  } catch {
    return null;
  }
}

export async function requestOrderAlertPermission(): Promise<OrderAlertPermission | null> {
  const Notifications = notificationsModule();
  if (!Notifications) return null;
  try {
    const p = await Notifications.requestPermissionsAsync();
    return { granted: p.status === "granted", canAskAgain: p.canAskAgain };
  } catch {
    return null;
  }
}

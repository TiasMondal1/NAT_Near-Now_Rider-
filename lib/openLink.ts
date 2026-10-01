/**
 * Opening phone/maps/settings links safely (audit D4, 2026-10-02).
 *
 * `Linking.openURL()` rejects when no installed app handles the URL — e.g. a
 * tablet with no dialer, or an Android phone without the Google Maps app
 * (common on devices without Google services), which can't open
 * `google.navigation:` links. Every call site used it bare, so that rejection
 * went unhandled and the button silently did nothing. These helpers catch it,
 * try a web fallback where one exists, and otherwise tell the rider why.
 */
import { Alert, Linking, Platform } from "react-native";

export async function openExternal(
  url: string,
  opts: { fallbackUrl?: string; failTitle?: string; failMessage?: string } = {}
): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    if (opts.fallbackUrl) {
      try {
        await Linking.openURL(opts.fallbackUrl);
        return true;
      } catch {
        // fall through to the alert
      }
    }
    Alert.alert(opts.failTitle ?? "Couldn't open link", opts.failMessage ?? "No app on this phone can open it.");
    return false;
  }
}

/** Turn-by-turn navigation in the native maps app, falling back to Google Maps on the web. */
export function openNavigation(lat: number | string, lng: number | string): Promise<boolean> {
  const native = Platform.select({
    ios: `maps:0,0?q=@${lat},${lng}`,
    android: `google.navigation:q=${lat},${lng}`,
  });
  const web = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return openExternal(native ?? web, {
    fallbackUrl: native ? web : undefined,
    failTitle: "Couldn't open navigation",
    failMessage: "No maps app or browser is available on this phone.",
  });
}

export function callNumber(phone: string): Promise<boolean> {
  return openExternal(`tel:${phone}`, {
    failTitle: "Couldn't start a call",
    failMessage: `No calling app is available on this phone. The number is ${phone}.`,
  });
}

export function openAppSettings(): void {
  Linking.openSettings().catch(() => {
    Alert.alert("Couldn't open Settings", "Open your phone's Settings app and find Near & Now there.");
  });
}

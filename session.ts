import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "nearandnow_delivery_session";
const TOKEN_KEY = "nearandnow_rider_token";
const SUPABASE_SESSION_KEY = "nearandnow_rider_supabase_session";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type UserSession = {
  token: string;
  expiresAt: number; // Unix ms timestamp
  /** OTP verified but /signup/complete not finished yet */
  needsSignupCompletion?: boolean;
  signupTicket?: string;
  /** Local flag set after successful KYC document upload */
  documentsSubmitted?: boolean;
  /**
   * A real, narrowly-scoped Supabase Auth session minted by the backend at
   * login (see backend/src/services/riderAuthBridge.service.ts) — used only
   * to populate auth.uid() so this rider's own delivery_partners row can be
   * subscribed to via Realtime. Never used for this app's own API calls,
   * which stay on `token` above. Optional: absent if the mint failed
   * server-side (non-fatal — the app just falls back to polling).
   */
  supabaseSession?: {
    accessToken: string;
    refreshToken: string;
  };
  user: {
    id: string;
    name: string;
    role: string;
    phone?: string;
    email?: string;
  };
};

// In-memory cache — eliminates AsyncStorage/SecureStore reads after the first load.
// undefined = not yet loaded; null = loaded, no session.
let _cache: UserSession | null | undefined = undefined;

export async function getSession(): Promise<UserSession | null> {
  if (_cache !== undefined) return _cache;
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) { _cache = null; return null; }
  try {
    const rest = JSON.parse(raw) as Partial<UserSession>;

    // `useRiderVerificationGate` calls getSession() extremely often (on
    // mount, on every screen focus, every 30s, and on every app-foreground),
    // so a rare but real transient SecureStore read failure (Android
    // Keystore hiccups are the known case — see the retry below) gets many
    // chances to fire per session. Previously any such failure was treated
    // identically to "definitely no token": clearSession() wiped the real,
    // still-valid token, and the caller immediately bounced the rider to
    // /phone for a fresh OTP login — a permanent logout over a momentary
    // glitch. A single quick retry absorbs most transient failures; if it
    // still fails, this call fails soft (returns null WITHOUT clearing the
    // real session or poisoning `_cache`), so the token survives for the
    // next check to find normally, instead of destroying a good session on
    // a bad read. Found 2026-08-14 from a direct user report ("apps keep
    // sending riders to the home/login screen randomly, increasing OTP
    // usage").
    let token: string | null = null;
    let secureStoreFailed = false;
    try {
      token = await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      try {
        await new Promise<void>((resolve) => setTimeout(() => resolve(), 150));
        token = await SecureStore.getItemAsync(TOKEN_KEY);
      } catch {
        secureStoreFailed = true;
        token = null;
      }
    }

    // One-time migration: installs from before this change have the token sitting
    // in the same AsyncStorage blob as the rest of the session. Move it to
    // SecureStore and rewrite the AsyncStorage entry without it.
    if (!token && !secureStoreFailed && rest.token) {
      token = rest.token;
      delete rest.token;
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(rest));
    }

    if (secureStoreFailed) {
      // Genuinely couldn't read the token this time — not the same as
      // confirming it doesn't exist. Fail this one call without touching
      // stored state; leave `_cache` as `undefined` so the very next call
      // (there will be one soon, given how often this runs) gets a full
      // fresh attempt rather than a cached negative.
      return null;
    }

    if (!token) {
      await clearSession();
      return null;
    }

    let supabaseSession: UserSession['supabaseSession'];
    try {
      const raw = await SecureStore.getItemAsync(SUPABASE_SESSION_KEY);
      if (raw) supabaseSession = JSON.parse(raw);
    } catch {
      supabaseSession = undefined;
    }

    const session: UserSession = { ...(rest as Omit<UserSession, 'token'>), token, supabaseSession };

    if (session.expiresAt && Date.now() > session.expiresAt) {
      await clearSession();
      return null;
    }
    _cache = session;
    return _cache;
  } catch {
    _cache = null;
    return null;
  }
}

export async function saveSession(session: Omit<UserSession, "expiresAt"> & { expiresAt?: number }) {
  const withExpiry: UserSession = {
    ...session,
    expiresAt: session.expiresAt ?? Date.now() + SESSION_TTL_MS,
  };
  _cache = withExpiry;
  // The auth token is the one field that lets someone impersonate this rider —
  // keep it in SecureStore (Android Keystore / iOS Keychain), not plain
  // AsyncStorage, which is trivially readable via filesystem access on a
  // rooted/jailbroken device or a device backup extraction. Everything else
  // (user id/name/role, expiry, signup flags) is non-sensitive and stays in
  // AsyncStorage.
  const { token, supabaseSession, ...rest } = withExpiry;
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    supabaseSession
      ? SecureStore.setItemAsync(SUPABASE_SESSION_KEY, JSON.stringify(supabaseSession))
      : SecureStore.deleteItemAsync(SUPABASE_SESSION_KEY).catch(() => {}),
    AsyncStorage.setItem(SESSION_KEY, JSON.stringify(rest)),
  ]);
}

export async function clearSession() {
  _cache = null;
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(SUPABASE_SESSION_KEY).catch(() => {}),
    AsyncStorage.removeItem(SESSION_KEY),
  ]);
}

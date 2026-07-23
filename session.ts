import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const SESSION_KEY = "nearandnow_delivery_session";
const TOKEN_KEY = "nearandnow_rider_token";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type UserSession = {
  token: string;
  expiresAt: number; // Unix ms timestamp
  /** OTP verified but /signup/complete not finished yet */
  needsSignupCompletion?: boolean;
  signupTicket?: string;
  /** Local flag set after successful KYC document upload */
  documentsSubmitted?: boolean;
  user: {
    id: string;
    name: string;
    role: string;
    isActivated: boolean;
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

    let token: string | null = null;
    try {
      token = await SecureStore.getItemAsync(TOKEN_KEY);
    } catch {
      // SecureStore itself can throw (e.g. an invalidated Android Keystore key) —
      // fall through to the legacy-migration check below rather than crashing.
      token = null;
    }

    // One-time migration: installs from before this change have the token sitting
    // in the same AsyncStorage blob as the rest of the session. Move it to
    // SecureStore and rewrite the AsyncStorage entry without it.
    if (!token && rest.token) {
      token = rest.token;
      delete rest.token;
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(rest));
    }

    if (!token) {
      await clearSession();
      return null;
    }

    const session: UserSession = { ...(rest as Omit<UserSession, 'token'>), token };

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
  const { token, ...rest } = withExpiry;
  await Promise.all([
    SecureStore.setItemAsync(TOKEN_KEY, token),
    AsyncStorage.setItem(SESSION_KEY, JSON.stringify(rest)),
  ]);
}

export async function clearSession() {
  _cache = null;
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {}),
    AsyncStorage.removeItem(SESSION_KEY),
  ]);
}

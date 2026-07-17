import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "nearandnow_delivery_session";

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

// In-memory cache — eliminates AsyncStorage reads after the first load.
// undefined = not yet loaded; null = loaded, no session.
let _cache: UserSession | null | undefined = undefined;

export async function getSession(): Promise<UserSession | null> {
  if (_cache !== undefined) return _cache;
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) { _cache = null; return null; }
  try {
    const session = JSON.parse(raw) as UserSession;
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
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(withExpiry));
}

export async function clearSession() {
  _cache = null;
  await AsyncStorage.removeItem(SESSION_KEY);
}

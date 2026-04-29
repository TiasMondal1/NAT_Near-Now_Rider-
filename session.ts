import AsyncStorage from "@react-native-async-storage/async-storage";

const SESSION_KEY = "nearandnow_delivery_session";

export type UserSession = {
  token: string;
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
    _cache = JSON.parse(raw) as UserSession;
    return _cache;
  } catch {
    _cache = null;
    return null;
  }
}

export async function saveSession(session: UserSession) {
  _cache = session;
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function clearSession() {
  _cache = null;
  await AsyncStorage.removeItem(SESSION_KEY);
}

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
  };
};

export async function saveSession(session: UserSession) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function getSession(): Promise<UserSession | null> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as UserSession;
  } catch {
    return null;
  }
}

export async function clearSession() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

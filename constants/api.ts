const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || "http://192.168.1.117:3001";

export { API_BASE };

type FetchOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    throw { status: res.status, ...data };
  }

  return data as T;
}

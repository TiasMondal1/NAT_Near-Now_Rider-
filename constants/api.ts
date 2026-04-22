import { API_CONFIG } from "./config";

const API_BASE = API_CONFIG.BASE_URL;

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

  const endpoint = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(endpoint, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const errorPayload =
      typeof data === "object" && data !== null
        ? data
        : { message: "Request failed" };
    throw { status: res.status, ...errorPayload };
  }

  return data as T;
}

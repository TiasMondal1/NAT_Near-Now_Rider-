import { API_CONFIG } from "./config";
import { clearSession } from "../session";

const API_BASE = API_CONFIG.BASE_URL;

export { API_BASE };

type FetchOptions = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
};

// Emits a global event so _layout.tsx can redirect to /phone on session expiry
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
  token?: string,
  retries = 2
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const endpoint = `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1500ms
      await sleep(500 * (2 ** (attempt - 1)));
    }

    try {
      const res = await fetch(endpoint, {
        method: options.method || "GET",
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      // Session expired — clear session and redirect
      if (res.status === 401) {
        await clearSession();
        onSessionExpired?.();
        const err: any = new Error("Session expired");
        err.status = 401;
        throw err;
      }

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
        const err: any = Object.assign(new Error((errorPayload as any).error || (errorPayload as any).message || "Request failed"), { status: res.status, ...errorPayload });
        // Don't retry 4xx errors (client mistakes)
        if (res.status >= 400 && res.status < 500) throw err;
        lastError = err;
        continue;
      }

      return data as T;
    } catch (err: any) {
      // Don't retry 4xx or session-expired errors
      if (err?.status && err.status >= 400 && err.status < 500) throw err;
      lastError = err;
      // Don't retry if we've used all attempts
      if (attempt === retries) throw err;
    }
  }

  throw lastError;
}

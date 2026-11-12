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

export type ApiRequestInfo = { method: string; path: string; body?: unknown };

/**
 * Developer tools only (lib/devTools.ts): lets the demo order answer its own
 * requests and show up in the real offer / active-order lists. Nothing sets
 * it in a production build, where apiFetch behaves exactly as before.
 */
export type ApiInterceptor = {
  /** Answer the request locally (or throw). Return undefined to send it to the network. */
  handle?: (req: ApiRequestInfo) => unknown;
  /** Rewrite a successful network response. */
  transform?: (req: ApiRequestInfo, data: unknown) => unknown;
};
let interceptor: ApiInterceptor | null = null;
export function setApiInterceptor(next: ApiInterceptor | null) {
  interceptor = next;
}

async function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Per-attempt request timeout. Without one a hung socket never resolves,
 *  and every poller in the app (bare setInterval, no in-flight guard) piles
 *  up concurrent requests behind it. */
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(input: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      const e: any = new Error("Request timed out");
      e.code = "TIMEOUT";
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Handle a 401 from a request that was NOT made through apiFetch (e.g. the
 * multipart document upload in lib/riderVerificationDocuments.ts).
 */
export async function handleUnauthorized(): Promise<void> {
  await clearSession();
  onSessionExpired?.();
}

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {},
  token?: string,
  // Default: retry idempotent GETs on 5xx/network failure; never auto-retry
  // a mutating request. A POST whose response was lost may already have
  // been applied server-side (OTP sent, offer accepted, delivery marked
  // done), and re-sending it burns rate limits / surfaces a false failure.
  // Callers that know a mutation is safe to repeat can pass `retries`
  // explicitly.
  retries?: number
): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const maxRetries = retries ?? (method === "GET" ? 2 : 0);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const endpoint = `${API_BASE}${normalizedPath}`;

  const requestInfo: ApiRequestInfo = { method, path: normalizedPath, body: options.body };
  if (interceptor?.handle) {
    const local = await interceptor.handle(requestInfo);
    if (local !== undefined) return local as T;
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 500ms, 1500ms
      await sleep(500 * (2 ** (attempt - 1)));
    }

    try {
      const res = await fetchWithTimeout(endpoint, {
        method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      // Session expired — but only when this request actually carried our
      // session token. Unauthenticated endpoints (send-otp / verify-otp) may
      // legitimately answer 401 for a wrong code, and that must not wipe
      // whatever session exists or fire the global logout handler.
      if (res.status === 401 && token) {
        await handleUnauthorized();
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
        // Spread the body first, then set `status` so a body field named
        // "status" (common in API payloads) can't clobber the HTTP status the
        // retry logic below depends on.
        const err: any = Object.assign(
          new Error((errorPayload as any).error || (errorPayload as any).message || "Request failed"),
          { ...errorPayload, status: res.status }
        );
        // express-rate-limit always sends this on a 429 — exact seconds until
        // the window resets, so callers (e.g. the pickup-code/delivery-OTP
        // rate-limit UI) can show a real countdown instead of a static
        // "wait 3 minutes" the rider has no way to act on.
        if (res.status === 429) {
          const retryAfter = res.headers.get("Retry-After");
          if (retryAfter) err.retryAfterSeconds = Number(retryAfter);
        }
        // Don't retry 4xx errors (client mistakes)
        if (res.status >= 400 && res.status < 500) throw err;
        lastError = err;
        continue;
      }

      return (interceptor?.transform ? interceptor.transform(requestInfo, data) : data) as T;
    } catch (err: any) {
      // Don't retry 4xx or session-expired errors
      if (err?.status && err.status >= 400 && err.status < 500) throw err;
      lastError = err;
      // Don't retry if we've used all attempts
      if (attempt === maxRetries) throw err;
    }
  }

  throw lastError;
}

import * as Sentry from "@sentry/react-native";

/**
 * Reports failed requests that the app catches and handles itself (an error
 * message, a retry, an empty list), which would otherwise never reach Sentry.
 * Called from the two network chokepoints: the backend API client and the
 * Supabase client's fetch.
 *
 * Priority: level "warning" → Sentry priority Medium. Recorded and grouped
 * (one issue per endpoint + status + code), but no alert email; crashes stay
 * "error"/"fatal" and do email.
 *
 * Cost: nothing on a successful request (callers check the status first).
 * A failure is sent at most once per 10 minutes per endpoint + status in an
 * app session, so a poller hitting a broken endpoint, or an outage, can't
 * flood the event quota or the phone's network. A Supabase response body is
 * read (from a clone, in the background) only when it will be reported.
 * Offline and timeout failures are never reported: that's the network, not a bug.
 *
 * Kept identical in the customer, shopkeeper and rider apps.
 */

const REPEAT_WINDOW_MS = 10 * 60 * 1000;
const lastSent = new Map<string, number>();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "https://x/api/orders/3f2b…/items?x=1" → "/api/orders/:id/items".
 * Ids, phone numbers and query strings are dropped so one endpoint groups as
 * one issue and no customer data ends up in Sentry.
 */
export function routeTemplate(urlOrPath: string): string {
  const path = urlOrPath.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split(/[?#]/)[0] || "/";
  // Storage paths end in a file name; keep "/storage/v1/object/<op or bucket>" only.
  if (path.includes("/storage/v1/")) return path.split("/").slice(0, 5).join("/");
  return path
    .split("/")
    .map((segment) => (UUID.test(segment) || /\d{4,}/.test(segment) ? ":id" : segment))
    .join("/");
}

export type RequestFailure = {
  source: "api" | "supabase";
  method: string;
  url: string;
  status: number;
  code?: string;
  message?: string;
  /** Backend request id: the same id is on the matching near-now/backend event. */
  requestId?: string;
};

export function reportRequestFailure(failure: RequestFailure): void {
  try {
    const route = routeTemplate(failure.url);
    const method = failure.method.toUpperCase();
    const key = `${failure.source} ${method} ${route} ${failure.status} ${failure.code ?? ""}`;
    const now = Date.now();
    const last = lastSent.get(key);
    if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
    if (lastSent.size > 200) lastSent.clear();
    lastSent.set(key, now);

    const detail = failure.message ? `: ${failure.message.slice(0, 200)}` : "";
    const error = new Error(`${method} ${route} → ${failure.status}${failure.code ? ` ${failure.code}` : ""}${detail}`);
    error.name = failure.source === "supabase" ? "SupabaseRequestFailed" : "ApiRequestFailed";
    const tags: Record<string, string> = {
      request_source: failure.source,
      http_status: String(failure.status),
      route,
      method,
    };
    if (failure.code) tags.error_code = failure.code;
    if (failure.requestId) tags.request_id = failure.requestId;
    Sentry.captureException(error, {
      level: "warning",
      tags,
      fingerprint: [error.name, method, route, String(failure.status), failure.code ?? ""],
    });
  } catch {
    // Reporting must never throw into the caller's own error handling.
  }
}

function urlOf(input: unknown): string {
  if (typeof input === "string") return input;
  const candidate = input as { url?: unknown; href?: unknown } | null;
  if (candidate && typeof candidate.url === "string") return candidate.url;
  if (candidate && typeof candidate.href === "string") return candidate.href;
  return String(input);
}

/**
 * For the Supabase client's fetch. Decides from the status alone whether the
 * response can be worth reporting, and only then reads the error code.
 *
 * Reported: any 5xx; data API (/rest/v1) 400 (bad query), 403 and
 * 401-with-42501 (row-level security denied), 404 (missing table or
 * function); storage 400/403. Not reported, as expected outcomes: other 401s
 * (expired token, refreshed and retried), 406 (.single() found no row), 409
 * conflicts, 416, and auth-endpoint 4xx.
 */
export function reportSupabaseResponse(input: unknown, init: RequestInit | undefined, response: Response): void {
  const status = response.status;
  if (status < 400) return;
  const url = urlOf(input);
  const isRest = url.includes("/rest/v1/");
  const isStorage = url.includes("/storage/v1/");
  const candidate =
    status >= 500 ||
    (isRest && (status === 400 || status === 401 || status === 403 || status === 404)) ||
    (isStorage && (status === 400 || status === 403));
  if (!candidate) return;

  const method = String(init?.method ?? (input as { method?: unknown } | null)?.method ?? "GET");
  let body: Promise<string>;
  try {
    body = response.clone().text();
  } catch {
    body = Promise.resolve("");
  }
  body
    .catch(() => "")
    .then((text) => {
      let code: string | undefined;
      let message: string | undefined;
      try {
        const parsed = JSON.parse(text) as { code?: unknown; error?: unknown; message?: unknown; msg?: unknown };
        const rawCode = parsed.code ?? parsed.error;
        if (rawCode != null) code = String(rawCode);
        const rawMessage = parsed.message ?? parsed.msg;
        if (typeof rawMessage === "string") message = rawMessage;
      } catch {
        // Not JSON: report status only.
      }
      if (status === 401 && code !== "42501") return;
      reportRequestFailure({ source: "supabase", method, url, status, code, message });
    });
}

import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { APP_ENV } from "../constants/config";

/**
 * Crash reporting. Enabled only when EXPO_PUBLIC_SENTRY_DSN is set at build
 * time (or `extra.sentryDsn` in app.config.js); without a DSN every call here
 * is a no-op, so dev builds and forks stay silent. The ErrorBoundary and the
 * root layout call `captureException`; Sentry's own native handlers pick up
 * uncaught JS errors and native crashes once `initCrashReporting()` has run.
 *
 * Source-map upload (for readable production stack traces) needs the
 * `@sentry/react-native/expo` config plugin plus SENTRY_AUTH_TOKEN on the
 * build machine — see README.
 */
const extra = (Constants.expoConfig?.extra ?? {}) as { sentryDsn?: string };
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN || extra.sentryDsn || "";

let initialised = false;

export function initCrashReporting(): void {
  if (initialised || !DSN) return;
  initialised = true;
  Sentry.init({
    dsn: DSN,
    enabled: !__DEV__,
    // "preview" for tester builds, so their crashes can be filtered out.
    environment: APP_ENV,
    release: `${Constants.expoConfig?.slug ?? "rider"}@${Constants.expoConfig?.version ?? "0"}`,
    tracesSampleRate: 0.1,
    // Rider accounts are keyed by phone number; never send PII by default.
    sendDefaultPii: false,
  });
}

/** True when a DSN was configured and events are actually sent (never in a dev client). */
export function isCrashReportingActive(): boolean {
  return initialised && !__DEV__;
}

export function captureException(error: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function setCrashUser(id: string | null): void {
  if (!initialised) return;
  Sentry.setUser(id ? { id } : null);
}

# Near & Now — Delivery Partner app

Expo (SDK 54) / React Native app for Near & Now riders: go online, receive
order offers, pick up from stores, collect cash or UPI at the door, and get
paid. Android is the primary target; iOS builds from the same config.

## Setup

```bash
npm ci
cp .env.example .env     # fill in the EXPO_PUBLIC_* values
npm start                # Expo dev server (push notifications need a dev build, not Expo Go)
```

Only `EXPO_PUBLIC_*` variables are read. Everything with that prefix is baked
into the app bundle, so never put a secret there.

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Backend base URL |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Realtime subscriptions and signed-URL photo uploads |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Native maps |
| `EXPO_PUBLIC_SENTRY_DSN` | Optional. Crash reporting is off when unset |
| `EXPO_PUBLIC_ENV` | Optional. `preview` marks a tester build that includes the developer tools. Release builds set it themselves (see Building) |

Without the Supabase values the app still starts and runs on polling alone;
live updates and profile-photo uploads are off.

## Checks

```bash
npm run check            # typecheck + lint + unit checks (what CI runs)
npm run typecheck
npm run lint
npm test
```

## Project layout

| Path | What lives there |
|---|---|
| `app/` | Expo Router screens. `(tabs)/` is the signed-in shell (home, orders, earnings, profile); `delivery/[orderId]` is the live delivery flow |
| `components/` | Shared UI: COD collection box, error boundary, permission modal, banners |
| `lib/` | Non-UI logic: session gate, order polling, background location task, Supabase client, logout, paging, geo helpers |
| `constants/` | `api.ts` (fetch wrapper), `config.ts` (env), `theme.ts` |
| `session.ts` | Session storage. Auth token lives in SecureStore, everything else in AsyncStorage |
| `plugins/` | Expo config plugins for release signing, ABI splits, tablet manifest |
| `scripts/` | Local Android build helpers and the plain-Node checks (`check-order-polling.mjs`, `check-dev-tools.mjs`) |

## How the important bits work

**Auth.** Phone + OTP via the backend. The returned token is stored in
SecureStore and sent as a Bearer header by `apiFetch`. A 401 on an
authenticated request clears the session and routes to `/phone`.

**Verification gate.** `lib/useRiderVerificationGate.ts` polls the profile and
documents and redirects unverified riders to the onboarding screens. It never
redirects on a failed network check; the tabs layout shows a retry state
instead.

**API client.** `constants/api.ts` retries GETs on 5xx/network errors and never
auto-retries mutations. Every request has a 15 s timeout.

**Location.** Home runs a foreground GPS watcher while online. A TaskManager
background task (registered at app start in `lib/backgroundLocationTask.ts`)
keeps tracking alive when the app is backgrounded or killed while online,
which is intended: an active delivery must stay visible to the customer until
it is submitted. The task is stopped on go-offline, logout, session expiry,
and on a cold start with no session.

**Realtime.** One shared Supabase client (`lib/supabase.ts`). The backend mints
a narrow Supabase Auth session at login that `lib/riderRealtimeAuth.ts` restores
so Realtime RLS can evaluate `auth.uid()`. Realtime is best-effort; every screen
also polls.

**Support contacts.** `lib/supportContacts.ts` loads admin phone numbers from
`GET /delivery-partner/support-contacts` (`{ contacts: [{ name, phone }] }`)
and falls back to the list in `constants/config.ts`.

## Developer tools

Testing aids for dev clients and tester builds. A production build does not
contain them: `DEV_TOOLS_AVAILABLE` (`lib/devTools.ts`, rule in
`lib/devToolsRules.ts`) is true only in a dev client or a release built with
`EXPO_PUBLIC_ENV=preview`.

They start hidden. Tap the build number seven times — at the bottom of the
Profile tab, or at the bottom of the login screen — and a **Developer tools**
entry appears next to it. The switch at the bottom of the tools screen hides
them again.

| Tool | What it does |
|---|---|
| This build / Login | Version, build number, environment, backend, which keys are present, who is signed in |
| Functional checks | Runs every check in `lib/diagnostics.ts` and lists pass / look at / failed: connection, backend, each endpoint the tabs read, Realtime, location permission and GPS, the background task, notification permission, channel and push token. Read-only |
| Demo order | A pretend delivery (`lib/demoDelivery.ts`) that runs through the real screens: offer on Home, accept, two pickups (code `1234`, then a store that confirms by itself), delivery OTP `4321`, payment, Mark Delivered. Scenarios: COD paid by UPI QR, COD in cash (QR expires), prepaid, and an offer another rider takes first. Three wrong codes show the retry countdown; cancelling after accepting shows the "order was cancelled" path. Go online on Home to see the offer |
| Test notification | A local notification on the order-alert channel with the order chime |
| Crash handling | Throws during render to show the crash screen and its Retry; sends a test report when Sentry is on |
| Saved demo login | Stores the current real login so the login screen can restore it without another OTP SMS |

The demo order is plugged into `apiFetch` (`setApiInterceptor` in
`constants/api.ts`): requests for a demo id are answered on the phone and never
sent, and the demo offer / active order are added to the real lists. It refuses
to start while a real delivery is in progress, and real active orders are always
listed first. `npm test` covers the rules and the whole demo flow
(`scripts/check-dev-tools.mjs`).

## Building

Play releases go through EAS; `eas.json` uses remote version codes with
auto-increment, so the `versionCode` in `app.config.js` only affects local
builds.

```bash
npm run prebuild:android
npm run build:apk                     # production APK (or build:aab for Play)
npm run build:apk -- --env=preview    # tester APK with the developer tools
```

A local release is a production build unless `--env=preview` is passed, whatever
`EXPO_PUBLIC_ENV` the `.env` holds. On EAS, the `preview` profile builds the
tester APK and `production` builds the Play bundle.

Local release builds refuse to run without `credentials/release.keystore` and
`credentials/keystore.properties` (both gitignored). Set
`ALLOW_DEBUG_SIGNING=1` for a throwaway debug-signed build. Override the local
version code with `ANDROID_VERSION_CODE=<n>`.

Push notifications on Android need `google-services.json` from the Firebase
console in the repo root (gitignored), or the `GOOGLE_SERVICES_JSON` file
environment variable on EAS.

## Crash reporting

Set `EXPO_PUBLIC_SENTRY_DSN` to enable Sentry. Uncaught JS errors, native
crashes and errors caught by the `ErrorBoundary` are reported. For readable
production stack traces add the `@sentry/react-native/expo` config plugin with
your org and project and provide `SENTRY_AUTH_TOKEN` on the build machine.

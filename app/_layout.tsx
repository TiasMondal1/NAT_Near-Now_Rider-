import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import { Colors } from "../constants/theme";
import { validateConfig } from "../constants/config";
import { getSession } from "../session";
import { setSessionExpiredHandler } from "../constants/api";
import { resolveAuthenticatedRoute } from "../lib/riderVerification";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useProfileChangeOutcomeGate } from "../lib/useProfileChangeOutcomeGate";
import ProfileChangeOutcomeModal from "../components/ProfileChangeOutcomeModal";
import { UpdateRequiredGate } from "../components/UpdateRequiredGate";
// Side-effect import: registers the background location TaskManager task at
// module load, before any component mounts. Required so a location update
// that relaunches the app after it was killed still has a task definition
// to run against — defining it lazily inside a screen would be too late.
import { stopBackgroundLocationTracking } from "../lib/backgroundLocationTask";
import { initCrashReporting, setCrashUser } from "../lib/crashReporting";
import { registerForOrderPushes } from "../lib/pushRegistration";
import { notifyOfferPush, ORDER_OFFER_PUSH_TYPE } from "../lib/orderRing";

// Before any component mounts so early render errors are captured too.
initCrashReporting();

// expo-notifications is unsupported in Expo Go (SDK 53+); skip in that environment
const isExpoGo = Constants.executionEnvironment === "storeClient";

let Notifications: typeof import("expo-notifications") | null = null;
if (!isExpoGo) {
  // Must stay a conditional require(), not a static import: a static import
  // is hoisted and would always execute regardless of `isExpoGo`, loading a
  // module that's unsupported (and can throw) in Expo Go.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");
  Notifications!.setNotificationHandler({
    // Only runs while the app is on screen. An order request is rung there
    // by the in-app loop (lib/orderRing.ts), which stops the moment the rider
    // answers; the notification's own 15 s sound cannot be stopped, so it is
    // muted here and left to play only when the app is not on screen.
    handleNotification: async (notification) => ({
      shouldShowAlert: true,
      shouldPlaySound:
        (notification.request.content.data as { type?: string } | null)?.type !== ORDER_OFFER_PUSH_TYPE,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [authReady, setAuthReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const notificationListener = useRef<{ remove: () => void } | null>(null);
  const responseListener = useRef<{ remove: () => void } | null>(null);

  useEffect(() => {
    validateConfig();
  }, []);

  // Register session-expired handler so api.ts can trigger logout. Also stops
  // the background GPS task here: home.tsx's own cleanup only runs while it's
  // mounted, but a 401 can arrive (and unmount it) from any screen, and would
  // otherwise leave the foreground-service location task running for a rider
  // who's no longer authenticated. See bug_fixes doc, 2026-10-01.
  //
  // It also sends the rider to /phone itself. Previously nothing navigated on
  // a 401: the redirect effect below only re-runs when the route changes, so
  // the rider stayed on a screen where every action failed with "Session
  // expired" until the verification gate's 30 s poll noticed — and screens
  // without that gate (notifications, preferences, billing) never did.
  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setIsLoggedIn(false);
      setCrashUser(null);
      stopBackgroundLocationTracking().catch(() => {});
      const current = segmentsRef.current[0];
      if (current !== "phone" && current !== "otp") router.replace("/phone");
    });
  }, [router]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const session = await getSession();
      if (!mounted) return;
      const loggedIn = Boolean(session?.token);
      setIsLoggedIn(loggedIn);
      setAuthReady(true);
      setCrashUser(loggedIn ? session?.user?.id ?? null : null);
      // Cold start with no valid session (expired while killed, or a previous
      // install/session left the OS-level task registered) — the task would
      // otherwise only be noticed and stopped once a screen that imports it
      // mounts, which never happens on the logged-out path.
      if (!loggedIn) stopBackgroundLocationTracking().catch(() => {});
    })();
    return () => { mounted = false; };
  }, []);

  // Push notification setup after login (skipped in Expo Go)
  useEffect(() => {
    if (!isLoggedIn || isExpoGo || !Notifications) return;

    // Permission, channel and push token — lib/pushRegistration.ts.
    registerForOrderPushes({ prompt: true }).catch((err) => {
      console.warn("Push notification setup failed:", err);
    });

    // Tell Home the moment an order request's push lands, so the request
    // shows and rings without waiting for Realtime or the next poll.
    notificationListener.current = Notifications!.addNotificationReceivedListener((notification) => {
      const type = (notification.request.content.data as { type?: string } | null)?.type;
      if (type === ORDER_OFFER_PUSH_TYPE) notifyOfferPush();
    });

    responseListener.current = Notifications!.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string>;
      // "new_order" (assignDeliveryAgent) means this order is already assigned
      // to this rider, so it can be opened directly. Every other push type
      // (new_order_offer, profile_change_reviewed, document_rejected,
      // rider_approved) has no single order to deep-link to and previously
      // did nothing on tap — preserved here so tapping one of those doesn't
      // yank the rider off an active delivery screen they're mid-flow on.
      if (data?.type === "new_order" && data?.orderId) {
        router.push({ pathname: "/delivery/[orderId]", params: { orderId: data.orderId } });
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isLoggedIn, router]);

  // Read a fresh session on every segment change to avoid stale-state race conditions
  // (e.g. phone.tsx saves session then navigates — isLoggedIn may not have updated yet)
  useEffect(() => {
    if (!authReady) return;

    let mounted = true;
    (async () => {
      const session = await getSession();
      if (!mounted) return;

      const loggedIn = Boolean(session?.token);
      setIsLoggedIn(loggedIn);
      // Keeps crash reports tied to the rider after a login or logout in this
      // run, not only to whoever was signed in at cold start.
      setCrashUser(loggedIn ? session?.user?.id ?? null : null);

      const current = segments[0];
      const inAuthFlow = current === "phone" || current === "otp";
      const inSignupFlow = current === "signup";
      const inVerificationFlow =
        current === "pending-verification" || current === "documents";
      const inProtectedFlow =
        current === "(tabs)" || current === "delivery" || inVerificationFlow;

      // OTP done but profile form not finished — keep them on /signup.
      if (loggedIn && session?.needsSignupCompletion) {
        if (!inSignupFlow && current !== "otp") {
          router.replace({
            pathname: "/signup",
            params: {
              phone: session.user?.phone || "",
              signupTicket: session.signupTicket || "",
            },
          });
        }
        return;
      }

      if (loggedIn && inAuthFlow && session?.token) {
        try {
          router.replace(await resolveAuthenticatedRoute(session.token, { forceDetailsLanding: true }));
        } catch {
          router.replace("/signup");
        }
      } else if (!loggedIn && (inProtectedFlow || inSignupFlow)) {
        // Signup without a session (ticket-only) is allowed; only kick protected screens.
        if (inProtectedFlow) router.replace("/phone");
      }
    })();

    return () => { mounted = false; };
  }, [authReady, segments, router]);

  // Mounted once above the whole Stack (not inside a single screen) so a
  // profile-change outcome is surfaced no matter which tab/screen the rider
  // happens to be on when the admin reviews it.
  const { outcome, dismiss } = useProfileChangeOutcomeGate(isLoggedIn);

  return (
    <ErrorBoundary>
      <View style={{ flex: 1, backgroundColor: Colors.bg }}>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: Colors.bg },
            animation: "slide_from_right",
          }}
        />
        <ProfileChangeOutcomeModal outcome={outcome} onDismiss={dismiss} />
        {/* Above everything: an install below the server's minimum build is asked to update (2026-11-17). */}
        <UpdateRequiredGate />
      </View>
    </ErrorBoundary>
  );
}

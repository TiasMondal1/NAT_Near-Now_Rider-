import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Platform } from "react-native";
import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import { Colors } from "../constants/theme";
import { validateConfig } from "../constants/config";
import { getSession } from "../session";
import { apiFetch, setSessionExpiredHandler } from "../constants/api";
import { resolveAuthenticatedRoute } from "../lib/riderVerification";

// expo-notifications is unsupported in Expo Go (SDK 53+); skip in that environment
const isExpoGo = Constants.executionEnvironment === "storeClient";

let Notifications: typeof import("expo-notifications") | null = null;
if (!isExpoGo) {
  Notifications = require("expo-notifications");
  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
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

  // Register session-expired handler so api.ts can trigger logout
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setIsLoggedIn(false);
    });
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const session = await getSession();
      if (!mounted) return;
      setIsLoggedIn(Boolean(session?.token));
      setAuthReady(true);
    })();
    return () => { mounted = false; };
  }, []);

  // Push notification setup after login (skipped in Expo Go)
  useEffect(() => {
    if (!isLoggedIn || isExpoGo || !Notifications) return;

    (async () => {
      try {
        const { status: existing } = await Notifications!.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await Notifications!.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

        if (Platform.OS === "android") {
          // Channel id bumped to _v2: Android locks a channel's sound at
          // creation time, so a previously-created "orders" channel can never
          // pick up order_chime.wav — only a new channel id does.
          await Notifications!.setNotificationChannelAsync("orders_v2", {
            name: "Order Alerts",
            importance: Notifications!.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: Colors.accent,
            sound: "order_chime.wav",
          });
        }

        const tokenData = await Notifications!.getExpoPushTokenAsync();
        const session = await getSession();
        if (session?.token) {
          apiFetch(
            "/delivery-partner/push-token",
            { method: "PATCH", body: { expo_push_token: tokenData.data } },
            session.token
          ).catch(() => {});
        }
      } catch (err) {
        console.warn("Push notification setup failed:", err);
      }
    })();

    notificationListener.current = Notifications!.addNotificationReceivedListener(() => {});

    responseListener.current = Notifications!.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, string>;
      if (data?.orderId) {
        router.push("/(tabs)/home");
      }
    });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, [isLoggedIn]);

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
          router.replace(await resolveAuthenticatedRoute(session.token));
        } catch {
          router.replace("/pending-verification");
        }
      } else if (!loggedIn && (inProtectedFlow || inSignupFlow)) {
        // Signup without a session (ticket-only) is allowed; only kick protected screens.
        if (inProtectedFlow) router.replace("/phone");
      }
    })();

    return () => { mounted = false; };
  }, [authReady, segments, router]);

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.bg },
          animation: "slide_from_right",
        }}
      />
    </View>
  );
}

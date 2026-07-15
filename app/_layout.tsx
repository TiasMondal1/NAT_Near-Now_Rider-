import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Platform } from "react-native";
import { useEffect, useRef, useState } from "react";
import Constants from "expo-constants";
import { Colors } from "../constants/theme";
import { validateConfig } from "../constants/config";
import { getSession } from "../session";
import { apiFetch, setSessionExpiredHandler } from "../constants/api";

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
          await Notifications!.setNotificationChannelAsync("orders", {
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
      const inAuthFlow = current === "phone" || current === "otp" || current === "signup";
      const inProtectedFlow = current === "(tabs)" || current === "delivery";

      if (loggedIn && inAuthFlow) {
        router.replace("/(tabs)/home");
      } else if (!loggedIn && inProtectedFlow) {
        router.replace("/phone");
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

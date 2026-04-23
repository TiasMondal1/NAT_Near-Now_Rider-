import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View, Platform } from "react-native";
import { useEffect, useRef, useState } from "react";
import * as Notifications from "expo-notifications";
import { Colors } from "../constants/theme";
import { validateConfig } from "../constants/config";
import { getSession } from "../session";
import { apiFetch, setSessionExpiredHandler } from "../constants/api";

// Show notifications when app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [authReady, setAuthReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const notificationListener = useRef<Notifications.EventSubscription | null>(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

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

  useEffect(() => {
    if (!authReady) return;
    (async () => {
      const session = await getSession();
      setIsLoggedIn(Boolean(session?.token));
    })();
  }, [segments, authReady]);

  // Push notification setup after login
  useEffect(() => {
    if (!isLoggedIn) return;

    (async () => {
      try {
        // Request permission
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;

        // Android channel
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("orders", {
            name: "Order Alerts",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: Colors.accent,
          });
        }

        // Get Expo push token and sync to backend
        const tokenData = await Notifications.getExpoPushTokenAsync();
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

    // Notification received while app is open (refresh home)
    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      // Screens will react to their own focus/polling; nothing extra needed here
    });

    // User tapped a notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
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

  useEffect(() => {
    if (!authReady) return;

    const current = segments[0];
    const inTabs = current === "(tabs)";
    const inAuthFlow = current === "phone" || current === "otp" || current === "signup";
    const inProtectedFlow = inTabs || current === "delivery";

    if (isLoggedIn && inAuthFlow) {
      router.replace("/(tabs)/home");
      return;
    }

    if (!isLoggedIn && inProtectedFlow) {
      router.replace("/phone");
    }
  }, [authReady, isLoggedIn, segments, router]);

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

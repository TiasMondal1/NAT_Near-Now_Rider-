import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { useEffect, useState } from "react";
import { Colors } from "../constants/theme";
import { validateConfig } from "../constants/config";
import { getSession } from "../session";

export default function RootLayout() {
  const router = useRouter();
  const segments = useSegments();
  const [authReady, setAuthReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    validateConfig();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const session = await getSession();
      if (!mounted) return;
      setIsLoggedIn(Boolean(session?.token));
      setAuthReady(true);
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!authReady) return;
    (async () => {
      const session = await getSession();
      setIsLoggedIn(Boolean(session?.token));
    })();
  }, [segments, authReady]);

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

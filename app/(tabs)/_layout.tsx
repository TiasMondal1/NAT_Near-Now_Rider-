import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View, Text, Platform, useWindowDimensions, ActivityIndicator, TouchableOpacity } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "../../constants/theme";
import OfflineBanner, { OFFLINE_BANNER_HEIGHT, useIsOffline } from "../../components/OfflineBanner";
import { useRiderVerificationGate } from "../../lib/useRiderVerificationGate";

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const iconSize = isTablet ? 28 : 24;
  const offline = useIsOffline();
  // Tab bar size. Two things were wrong with the old fixed 68 / 10 / 10:
  //
  //  1. Too little room. A tab needs 5 + 28 (icon) + 2 + ~15 (label) + 5 =
  //     55 of height, and 68 minus 20 of padding left 48, so the label was
  //     squeezed to 10 and its text cut off along the bottom. The padding is
  //     now 8 / 8 inside 72, which leaves 56.
  //  2. No allowance for the system navigation bar. The app draws edge to
  //     edge, so on Android the three buttons or the gesture handle lie over
  //     the bottom of the window, and a fixed height and padding replace the
  //     tab bar's own handling of that inset. It is added back here, and is 0
  //     where nothing overlaps. iOS keeps a fixed allowance for its home bar.
  const { bottom } = useSafeAreaInsets();
  const androidBottomInset = Platform.OS === "android" ? bottom : 0;
  const tabBarPaddingBottom = (Platform.OS === "ios" ? 24 : 8) + androidBottomInset;
  const tabBarHeight = (Platform.OS === "ios" ? 88 : 72) + (isTablet ? 12 : 0) + androidBottomInset;
  const { checking, verified, checkFailed, refresh } = useRiderVerificationGate("require-verified");

  // The gate never redirects on a failed network check (that used to bounce
  // verified riders to /documents on any blip). If we have no confirmed
  // verified state and the check failed, show a retry state instead of an
  // indefinite spinner.
  if (!checking && !verified && checkFailed) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.bg, padding: 24 }}>
        <MaterialCommunityIcons name="wifi-alert" size={40} color={Colors.accent} />
        <Text style={{ color: Colors.text, fontSize: 17, fontWeight: "700", marginTop: 16 }}>
          Couldn&apos;t verify your account
        </Text>
        <Text style={{ color: Colors.textSecondary, fontSize: 14, marginTop: 6, textAlign: "center" }}>
          Check your connection and try again.
        </Text>
        <TouchableOpacity
          onPress={() => void refresh()}
          style={{ marginTop: 20, backgroundColor: Colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
          activeOpacity={0.8}
        >
          <Text style={{ color: Colors.accentText, fontWeight: "700" }}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // !verified alone isn't a substitute for a real network re-check (see
  // useRiderVerificationGate's AppState handling for that) — this just
  // closes the narrower gap where `checking` is already false (cache warm)
  // but the cached result itself says not-yet-verified, so this screen
  // would otherwise render real tab content for one frame before evaluate()'s
  // redirect fires.
  if (checking || !verified) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: Colors.bg }}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <OfflineBanner offline={offline} />
      {/* Moves the screens below the offline strip instead of letting it cover their headers. */}
      <View style={{ flex: 1, marginTop: offline ? OFFLINE_BANNER_HEIGHT : 0 }}>
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.bg,
          borderTopWidth: 0,
          height: tabBarHeight,
          paddingBottom: tabBarPaddingBottom,
          paddingTop: 8,
          elevation: 0,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontSize: isTablet ? 13 : 11,
          fontWeight: "600",
          letterSpacing: 0.3,
        },
        tabBarItemStyle: {
          gap: 2,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "map-marker-radius" : "map-marker-radius-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "clipboard-list" : "clipboard-list-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: "Earnings",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "wallet" : "wallet-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "account-circle" : "account-circle-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
    </Tabs>
      </View>
    </View>
  );
}

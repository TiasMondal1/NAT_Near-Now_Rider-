import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import NetInfo from "@react-native-community/netinfo";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors } from "../constants/theme";

/** Height of the banner below the status bar. The tabs move down by this much while it shows. */
export const OFFLINE_BANNER_HEIGHT = 30;

export function useIsOffline(): boolean {
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
    });
    return unsubscribe;
  }, []);
  return isOffline;
}

/**
 * "No internet connection" strip across the top of the signed-in tabs.
 *
 * The app draws edge to edge, so y = 0 is behind the status bar: the strip
 * used to sit there with its text under the clock and battery icons. It now
 * starts below the status bar (and colours the area behind it), and
 * app/(tabs)/_layout.tsx moves the screens down by OFFLINE_BANNER_HEIGHT while
 * it shows, so it covers nothing.
 */
export default function OfflineBanner({ offline }: { offline: boolean }) {
  const { top } = useSafeAreaInsets();
  const hiddenY = -(OFFLINE_BANNER_HEIGHT + top);
  const slideAnim = useRef(new Animated.Value(hiddenY)).current;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: offline ? 0 : hiddenY,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [offline, hiddenY, slideAnim]);

  return (
    <Animated.View
      style={[styles.banner, { paddingTop: top, transform: [{ translateY: slideAnim }] }]}
      pointerEvents="none"
      accessibilityElementsHidden={!offline}
      importantForAccessibility={offline ? "yes" : "no-hide-descendants"}
    >
      <View style={styles.content}>
        <MaterialCommunityIcons name="wifi-off" size={14} color="#fff" />
        <Text style={styles.text}>No internet connection</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    backgroundColor: Colors.danger,
  },
  content: {
    height: OFFLINE_BANNER_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  text: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "600",
  },
});

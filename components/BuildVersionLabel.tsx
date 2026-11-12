import { useRef } from "react";
import { Alert, Pressable, StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";
import * as Haptics from "expo-haptics";
import { Colors } from "../constants/theme";
import { VERSION_LABEL } from "../lib/appVersion";
import { DEV_TOOLS_AVAILABLE, isDevToolsEnabled, setDevToolsEnabled } from "../lib/devTools";
import { registerUnlockTap, type UnlockTaps } from "../lib/devToolsRules";

/**
 * The installed version and build number, e.g. "Near & Now v1.0.0 (build 8)".
 *
 * In a dev client or a preview build, tapping it seven times in a row shows
 * the developer tools (lib/devTools.ts), which start hidden. In a production
 * build it is plain text and tapping does nothing.
 */
export default function BuildVersionLabel({ style }: { style?: StyleProp<TextStyle> }) {
  const taps = useRef<UnlockTaps>({ count: 0, lastAt: 0 });
  const label = <Text style={[styles.text, style]}>Near &amp; Now {VERSION_LABEL}</Text>;

  if (!DEV_TOOLS_AVAILABLE) return label;

  const onPress = async () => {
    const next = registerUnlockTap(taps.current, Date.now());
    taps.current = { count: next.count, lastAt: next.lastAt };
    if (!next.unlocked || (await isDevToolsEnabled())) return;
    await setDevToolsEnabled(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert("Developer tools are on", "A Developer tools entry now appears next to the build number.");
  };

  return (
    <Pressable onPress={onPress} hitSlop={12} accessible={false}>
      {label}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  text: { color: Colors.textMuted, fontSize: 12, textAlign: "center" },
});

import { useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { BorderRadius, Colors, Spacing } from "../constants/theme";
import { VERSION_LABEL } from "../lib/appVersion";
import { DEV_TOOLS_AVAILABLE, isDevToolsEnabled, setDevToolsEnabled } from "../lib/devTools";
import { isDevToolsPassword, registerUnlockTap, type UnlockTaps } from "../lib/devToolsRules";

/**
 * The installed version and build number, e.g. "Near & Now v1.0.0 (build 8)".
 *
 * In a dev client or a preview build, tapping it seven times in a row asks
 * for the developer tools password, and the right one shows the tools
 * (lib/devTools.ts), which start hidden. In a production build it is plain
 * text and tapping does nothing.
 */
export default function BuildVersionLabel({ style }: { style?: StyleProp<TextStyle> }) {
  const taps = useRef<UnlockTaps>({ count: 0, lastAt: 0 });
  const [asking, setAsking] = useState(false);
  const [password, setPassword] = useState("");
  const [wrong, setWrong] = useState(false);
  const label = <Text style={[styles.text, style]}>Near &amp; Now {VERSION_LABEL}</Text>;

  if (!DEV_TOOLS_AVAILABLE) return label;

  const onPress = async () => {
    const next = registerUnlockTap(taps.current, Date.now());
    taps.current = { count: next.count, lastAt: next.lastAt };
    if (!next.unlocked || (await isDevToolsEnabled())) return;
    setPassword("");
    setWrong(false);
    setAsking(true);
  };

  const close = () => {
    setAsking(false);
    setPassword("");
    setWrong(false);
  };

  const submit = async () => {
    if (!isDevToolsPassword(password)) {
      setWrong(true);
      setPassword("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    close();
    await setDevToolsEnabled(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    Alert.alert("Developer tools are on", "A Developer tools entry now appears next to the build number.");
  };

  return (
    <>
      <Pressable onPress={onPress} hitSlop={12} accessible={false}>
        {label}
      </Pressable>
      <Modal visible={asking} transparent animationType="fade" onRequestClose={close}>
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.card}>
            <Text style={styles.title}>Developer tools</Text>
            <Text style={styles.body}>Enter the password to turn them on.</Text>
            <TextInput
              style={[styles.input, wrong && styles.inputWrong]}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setWrong(false);
              }}
              placeholder="Password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submit}
              accessibilityLabel="Developer tools password"
            />
            {wrong ? <Text style={styles.wrongText}>Wrong password</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={close} activeOpacity={0.7}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.okBtn, !password && styles.okBtnDisabled]}
                onPress={submit}
                disabled={!password}
                activeOpacity={0.8}
              >
                <Text style={styles.okText}>Unlock</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  text: { color: Colors.textMuted, fontSize: 12, textAlign: "center" },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: { color: Colors.text, fontSize: 17, fontWeight: "700" },
  body: { color: Colors.textSecondary, fontSize: 13 },
  input: {
    height: 46,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    color: Colors.text,
    backgroundColor: Colors.bg,
    fontSize: 15,
  },
  inputWrong: { borderColor: Colors.danger },
  wrongText: { color: Colors.danger, fontSize: 12 },
  actions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.xs },
  cancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  okBtn: {
    flex: 1,
    height: 44,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  okBtnDisabled: { opacity: 0.5 },
  okText: { color: Colors.accentText, fontSize: 14, fontWeight: "700" },
});

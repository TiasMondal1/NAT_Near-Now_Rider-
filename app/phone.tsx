import { useState, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { saveSession } from "../session";
import { DEV_TOOLS_AVAILABLE, clearDemoSession, loadDemoSession, useDevToolsEnabled } from "../lib/devTools";
import BuildVersionLabel from "../components/BuildVersionLabel";

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [selectedFlow, setSelectedFlow] = useState<"existing" | "new" | null>(null);
  // Synchronous guard for both buttons: the `disabled` prop only applies
  // after a re-render, so two quick taps each sent an OTP SMS (and opened
  // two OTP screens).
  const sendingRef = useRef(false);

  // Developer tools (lib/devTools.ts) — dev and preview builds only. A saved
  // real login can be restored here without another OTP SMS.
  const devToolsOn = useDevToolsEnabled();
  const [demoName, setDemoName] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);
  useEffect(() => {
    if (!devToolsOn) {
      setDemoName(null);
      return;
    }
    let cancelled = false;
    void loadDemoSession().then((s) => {
      if (!cancelled) setDemoName(s ? s.user.name || "Saved rider" : null);
    });
    return () => {
      cancelled = true;
    };
  }, [devToolsOn]);

  const restoreSavedLogin = useCallback(async () => {
    if (demoBusy) return;
    setDemoBusy(true);
    try {
      const saved = await loadDemoSession();
      if (!saved) {
        setDemoName(null);
        return;
      }
      // Make sure the server still accepts the token before signing in with it.
      try {
        await apiFetch("/delivery-partner/profile", {}, saved.token, 0);
      } catch (err: any) {
        if (err?.status === 401) {
          await clearDemoSession();
          setDemoName(null);
          Alert.alert("Saved login expired", "Log in with OTP once, then save the login again from Developer tools.");
        } else {
          Alert.alert("Couldn't reach the server", "Check your connection and try again.");
        }
        return;
      }
      await saveSession(saved);
      // The splash screen works out where this rider belongs.
      router.replace("/");
    } finally {
      setDemoBusy(false);
    }
  }, [demoBusy, router]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const logoScale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    ]).start();
  }, [fadeAnim, slideAnim, logoScale]);

  // Indian mobile: exactly 10 digits starting 6-9. The phone-pad keyboard
  // also offers + # * ( ), so strip everything non-numeric before checking —
  // previously "+91123456" passed a bare length check and was sent as
  // "+91+91123456".
  const digits = phone.replace(/\D/g, "");
  const isValid = /^[6-9]\d{9}$/.test(digits);
  const fullPhone = `+91${digits}`;
  const disabled = !isValid || checkingExisting || registering;

  const handleExistingUser = async () => {
    if (!isValid || sendingRef.current) return;
    sendingRef.current = true;
    setCheckingExisting(true);
    try {
      const res = await apiFetch<{ success: boolean }>("/api/auth/send-otp", {
        method: "POST",
        body: { phone: fullPhone },
      });
      if (!res.success) {
        Alert.alert("Error", "Unable to send OTP right now. Please try again.");
        return;
      }
      // Registration is enforced after OTP verify — unregistered numbers cannot log in.
      router.push({ pathname: "/otp", params: { phone: fullPhone, flow: "existing" } });
    } catch (err: unknown) {
      const error = err as { message?: string };
      Alert.alert("Error", error?.message || "Unable to send OTP right now.");
    } finally {
      sendingRef.current = false;
      setCheckingExisting(false);
    }
  };

  const handleNewRegistration = async () => {
    if (!isValid || sendingRef.current) return;
    sendingRef.current = true;
    setRegistering(true);
    try {
      const res = await apiFetch<{ success: boolean }>("/api/auth/send-otp", {
        method: "POST",
        body: { phone: fullPhone },
      });
      if (!res.success) {
        Alert.alert("Error", "Unable to send OTP right now. Please try again.");
        return;
      }
      router.push({ pathname: "/otp", params: { phone: fullPhone, flow: "new" } });
    } catch (err: unknown) {
      const error = err as { message?: string };
      Alert.alert("Error", error?.message || "Unable to send OTP right now.");
    } finally {
      sendingRef.current = false;
      setRegistering(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        // Android already resizes via AndroidManifest's
        // windowSoftInputMode="adjustResize" — stacking "height" behavior on
        // top of that double-shrinks the content on Android.
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          <Animated.View style={[styles.header, { transform: [{ scale: logoScale }] }]}>
            <View style={styles.iconCircle}>
              <MaterialCommunityIcons name="truck-fast" size={28} color={Colors.accentText} />
            </View>
            <Text style={styles.brand}>NEAR & NOW</Text>
            <Text style={styles.brandSub}>DELIVERY PARTNER</Text>
          </Animated.View>

          <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
            {selectedFlow === null ? (
              <>
                <Text style={styles.title}>Welcome Rider</Text>
                <Text style={styles.subtitle}>Choose how you want to continue.</Text>

                <TouchableOpacity
                  style={styles.button}
                  onPress={() => setSelectedFlow("existing")}
                  activeOpacity={0.8}
                >
                  <View style={styles.buttonInner}>
                    <MaterialCommunityIcons name="account-check" size={20} color={Colors.accentText} />
                    <Text style={styles.buttonText}>Existing User</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setSelectedFlow("new")}
                  activeOpacity={0.8}
                >
                  <View style={styles.buttonInner}>
                    <MaterialCommunityIcons name="account-plus" size={20} color={Colors.accent} />
                    <Text style={styles.secondaryButtonText}>New User Registration</Text>
                  </View>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.title}>
                  {selectedFlow === "existing" ? "Existing User" : "New User Registration"}
                </Text>
                <Text style={styles.subtitle}>Enter your phone number to continue.</Text>

                <View style={styles.inputCard}>
                  <View style={styles.inputRow}>
                    <View style={styles.prefix}>
                      <Text style={styles.prefixText}>+91</Text>
                    </View>
                    <TextInput
                      style={styles.input}
                      placeholder="Phone number"
                      placeholderTextColor={Colors.textMuted}
                      keyboardType="phone-pad"
                      maxLength={10}
                      value={phone}
                      onChangeText={setPhone}
                      autoFocus
                    />
                  </View>
                </View>

                {selectedFlow === "existing" ? (
                  <TouchableOpacity
                    style={[styles.button, disabled && styles.buttonDisabled]}
                    onPress={handleExistingUser}
                    disabled={disabled}
                    activeOpacity={0.8}
                  >
                    {checkingExisting ? (
                      <ActivityIndicator color={Colors.accentText} />
                    ) : (
                      <View style={styles.buttonInner}>
                        <MaterialCommunityIcons name="account-check" size={20} color={Colors.accentText} />
                        <Text style={styles.buttonText}>Continue as Existing User</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.secondaryButton, disabled && styles.buttonDisabled]}
                    onPress={handleNewRegistration}
                    disabled={disabled}
                    activeOpacity={0.8}
                  >
                    {registering ? (
                      <ActivityIndicator color={Colors.accent} />
                    ) : (
                      <View style={styles.buttonInner}>
                        <MaterialCommunityIcons name="account-plus" size={20} color={Colors.accent} />
                        <Text style={styles.secondaryButtonText}>Continue to Registration</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.backLink}
                  onPress={() => {
                    setSelectedFlow(null);
                    setPhone("");
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.backLinkText}>Back to options</Text>
                </TouchableOpacity>
              </>
            )}

            <Text style={styles.terms}>
              Existing users must already be registered. New users register first, then upload documents for verification.
            </Text>

            {DEV_TOOLS_AVAILABLE && (
              <View style={styles.devArea}>
                {demoName && (
                  <TouchableOpacity
                    style={[styles.devButton, demoBusy && styles.buttonDisabled]}
                    onPress={restoreSavedLogin}
                    disabled={demoBusy}
                    activeOpacity={0.8}
                  >
                    {demoBusy ? (
                      <ActivityIndicator color={Colors.accent} size="small" />
                    ) : (
                      <MaterialCommunityIcons name="key-outline" size={16} color={Colors.accent} />
                    )}
                    <Text style={styles.devButtonText}>Use saved demo login ({demoName})</Text>
                  </TouchableOpacity>
                )}
                {devToolsOn && (
                  <TouchableOpacity style={styles.devButton} onPress={() => router.push("/dev-tools")} activeOpacity={0.8}>
                    <MaterialCommunityIcons name="wrench-outline" size={16} color={Colors.accent} />
                    <Text style={styles.devButtonText}>Developer tools</Text>
                  </TouchableOpacity>
                )}
                <BuildVersionLabel />
              </View>
            )}
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: 120,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  header: { paddingTop: Spacing.xxl + 16, alignItems: "center" },
  iconCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.accent,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  brand: { color: Colors.text, fontSize: 22, fontWeight: "800", letterSpacing: 4 },
  brandSub: { color: Colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 3, marginTop: 4 },
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: Spacing.xl },
  title: { color: Colors.text, fontSize: 30, fontWeight: "800", marginBottom: Spacing.sm },
  subtitle: { color: Colors.textSecondary, fontSize: 15, marginBottom: Spacing.xl, lineHeight: 22 },
  inputCard: {
    backgroundColor: Colors.surface, borderRadius: BorderRadius.lg, padding: Spacing.md,
    marginBottom: Spacing.lg, borderWidth: 1, borderColor: Colors.border,
  },
  inputRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  prefix: {
    backgroundColor: Colors.bg, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md,
    height: 52, justifyContent: "center", borderWidth: 1, borderColor: Colors.border,
  },
  prefixText: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  input: {
    flex: 1, backgroundColor: Colors.bg, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md,
    height: 52, color: Colors.text, fontSize: 18, fontWeight: "600", letterSpacing: 1, borderWidth: 1, borderColor: Colors.border,
  },
  button: {
    backgroundColor: Colors.accent, borderRadius: BorderRadius.lg, height: 56,
    alignItems: "center", justifyContent: "center",
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6,
  },
  secondaryButton: {
    marginTop: Spacing.md,
    borderRadius: BorderRadius.lg,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: Colors.accent,
    backgroundColor: Colors.surface,
  },
  secondaryButtonText: { color: Colors.accent, fontSize: 16, fontWeight: "700" },
  buttonDisabled: { opacity: 0.4, shadowOpacity: 0 },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  backLink: { alignItems: "center", marginTop: Spacing.md },
  backLinkText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  terms: { color: Colors.textMuted, fontSize: 12, textAlign: "center", marginTop: Spacing.lg },
  devArea: { marginTop: Spacing.xl, gap: Spacing.sm, alignItems: "center" },
  devButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "stretch",
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  devButtonText: { color: Colors.accent, fontSize: 13, fontWeight: "700", flexShrink: 1 },
});

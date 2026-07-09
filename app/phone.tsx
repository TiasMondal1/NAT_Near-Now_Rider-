import { useState, useRef, useEffect } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { apiFetch } from "../constants/api";

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [selectedFlow, setSelectedFlow] = useState<"existing" | "new" | null>(null);

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
  }, []);

  const isValid = phone.replace(/\s/g, "").length === 10;
  const fullPhone = `+91${phone.replace(/\s/g, "")}`;
  const disabled = !isValid || checkingExisting || registering;

  const handleExistingUser = async () => {
    if (!isValid) return;
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
      // verify-otp resolves login vs. "no account yet" by (phone, role) — otp.tsx
      // routes to signup automatically if this phone has no delivery_partner account.
      router.push({ pathname: "/otp", params: { phone: fullPhone, flow: "existing" } });
    } catch (err: unknown) {
      const error = err as { message?: string };
      Alert.alert("Error", error?.message || "Unable to send OTP right now.");
    } finally {
      setCheckingExisting(false);
    }
  };

  const handleNewRegistration = async () => {
    if (!isValid) return;
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
      setRegistering(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
            Existing users go to Home. Missing profile goes to registration.
          </Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  container: { flex: 1, paddingHorizontal: Spacing.lg, width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
  header: { paddingTop: Spacing.xxl + 16, alignItems: "center" },
  iconCircle: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.accent,
    alignItems: "center", justifyContent: "center", marginBottom: 14,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  brand: { color: Colors.text, fontSize: 22, fontWeight: "800", letterSpacing: 4 },
  brandSub: { color: Colors.textMuted, fontSize: 11, fontWeight: "600", letterSpacing: 3, marginTop: 4 },
  content: { flex: 1, justifyContent: "center", marginTop: -60 },
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
});

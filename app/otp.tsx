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
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { saveSession } from "../session";

const OTP_LENGTH = 6;

export default function OTPScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone: string; flow?: "new" | "existing" }>();
  const phone = params.phone;
  const flow = params.flow;

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inputsRef = useRef<Array<TextInput | null>>(Array(OTP_LENGTH).fill(null));

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const otp = digits.join("");
  const isComplete = otp.length === OTP_LENGTH;

  // Auto-submit when all 6 digits are filled (handles autofill + manual entry)
  useEffect(() => {
    if (isComplete && !loading) {
      handleVerify(otp);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  const handleDigitChange = (index: number, value: string) => {
    const only = value.replace(/[^0-9]/g, "");

    if (only.length > 1) {
      // SMS autofill or paste — distribute across all boxes from position 0
      const next = Array(OTP_LENGTH).fill("");
      for (let i = 0; i < OTP_LENGTH; i++) next[i] = only[i] ?? "";
      setDigits(next);
      inputsRef.current[Math.min(only.length - 1, OTP_LENGTH - 1)]?.focus();
      return;
    }

    const next = [...digits];
    next[index] = only;
    setDigits(next);

    if (only && index < OTP_LENGTH - 1) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (index: number, key: string) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleVerify = async (code = otp) => {
    if (code.length !== OTP_LENGTH || loading) return;
    setLoading(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        mode?: string;
        token?: string;
        phone?: string;
        user?: {
          id: string;
          name: string;
          role: "customer" | "shopkeeper" | "delivery_partner";
          isActivated: boolean;
          phone?: string;
          email?: string;
        };
      }>("/api/auth/verify-otp", {
        method: "POST",
        body: { phone, otp: code, role: "delivery_partner", name: "Delivery Partner" },
      });

      if (flow === "new") {
        router.replace({ pathname: "/signup", params: { phone: res.phone || phone } });
        return;
      }

      if (res.token && res.user?.role === "delivery_partner") {
        await saveSession({
          token: res.token,
          user: { ...res.user, role: "delivery_partner", isActivated: res.user.isActivated ?? true },
        });
        router.replace("/(tabs)/home");
      } else if (res.mode === "signup" || !res.token || res.user?.role !== "delivery_partner") {
        router.replace({ pathname: "/signup", params: { phone: res.phone || phone } });
      }
    } catch (err: unknown) {
      const error = err as { error?: string };
      Alert.alert(
        "Verification Failed",
        error?.error === "INVALID_OTP"
          ? "Invalid code. Please try again."
          : error?.error === "OTP_EXPIRED"
          ? "Code expired. Please request a new one."
          : error?.error === "MAX_ATTEMPTS_EXCEEDED"
          ? "Too many attempts. Request a new code."
          : "Something went wrong. Try again."
      );
      setDigits(Array(OTP_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    try {
      await apiFetch<{ success: boolean }>("/api/auth/send-otp", {
        method: "POST",
        body: { phone },
      });
      setCountdown(60);
      setDigits(Array(OTP_LENGTH).fill(""));
      inputsRef.current[0]?.focus();
    } catch {
      Alert.alert("Error", "Failed to resend code.");
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={Colors.text} />
        </TouchableOpacity>

        <Animated.View
          style={[styles.content, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        >
          <View style={styles.lockIcon}>
            <MaterialCommunityIcons name="shield-lock-outline" size={32} color={Colors.accent} />
          </View>
          <Text style={styles.title}>Verification</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code sent to{"\n"}
            <Text style={styles.phoneHighlight}>{phone}</Text>
          </Text>

          <View style={styles.otpRow}>
            {digits.map((d, idx) => (
              <TextInput
                key={idx}
                ref={(el) => { inputsRef.current[idx] = el; }}
                style={[styles.otpInput, d ? styles.otpInputFilled : null]}
                keyboardType="number-pad"
                value={d}
                onChangeText={(v) => handleDigitChange(idx, v)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(idx, nativeEvent.key)}
                autoFocus={idx === 0}
                textContentType="oneTimeCode"
                autoComplete={idx === 0 ? "sms-otp" : "off"}
                importantForAutofill={idx === 0 ? "yes" : "no"}
                selectTextOnFocus
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, !isComplete && styles.buttonDisabled]}
            onPress={() => handleVerify()}
            disabled={!isComplete || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.accentText} />
            ) : (
              <Text style={styles.buttonText}>Verify Code</Text>
            )}
          </TouchableOpacity>

          <View style={styles.resendRow}>
            {countdown > 0 ? (
              <Text style={styles.resendText}>
                Resend code in <Text style={styles.timerText}>{countdown}s</Text>
              </Text>
            ) : (
              <TouchableOpacity onPress={handleResend}>
                <Text style={styles.resendLink}>Resend Code</Text>
              </TouchableOpacity>
            )}
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  container: { flex: 1, paddingHorizontal: Spacing.lg },
  backBtn: {
    marginTop: Spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flex: 1, justifyContent: "center", marginTop: -60 },
  lockIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
    marginBottom: Spacing.sm,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 15,
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  phoneHighlight: { color: Colors.accent, fontWeight: "700" },
  otpRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: Spacing.xl,
  },
  otpInput: {
    flex: 1,
    height: 58,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    textAlign: "center",
    fontSize: 24,
    fontWeight: "800",
    color: Colors.text,
    // Removes Android's extra font padding that shifts the cursor vertically
    includeFontPadding: false,
    paddingTop: 0,
    paddingBottom: 0,
  },
  otpInputFilled: {
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight,
  },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.lg,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  buttonDisabled: { opacity: 0.4, shadowOpacity: 0 },
  buttonText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  resendRow: { alignItems: "center", marginTop: Spacing.lg },
  resendText: { color: Colors.textMuted, fontSize: 14 },
  timerText: { color: Colors.accent, fontWeight: "700" },
  resendLink: { color: Colors.accent, fontSize: 15, fontWeight: "700" },
});

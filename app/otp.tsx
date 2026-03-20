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

export default function OTPScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    phone: string;
    sessionId: string;
  }>();
  const phone = params.phone;
  const [currentSessionId, setCurrentSessionId] = useState(params.sessionId);

  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inputRefs = useRef<(TextInput | null)[]>([]);

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

  const handleDigitChange = (text: string, index: number) => {
    const newDigits = [...digits];
    newDigits[index] = text;
    setDigits(newDigits);
    if (text && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (key: string, index: number) => {
    if (key === "Backspace" && !digits[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
      const newDigits = [...digits];
      newDigits[index - 1] = "";
      setDigits(newDigits);
    }
  };

  const otp = digits.join("");
  const isComplete = otp.length === 6;

  const handleVerify = async () => {
    if (!isComplete) return;
    setLoading(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        mode: string;
        token?: string;
        phone?: string;
        user?: {
          id: string;
          name: string;
          role: string;
          isActivated: boolean;
          phone?: string;
          email?: string;
        };
      }>("/auth/phone/verify", {
        method: "POST",
        body: { phone, sessionId: currentSessionId, otp },
      });

      if (res.mode === "login" && res.token && res.user) {
        await saveSession({ token: res.token, user: res.user });
        router.replace("/(tabs)/home");
      } else if (res.mode === "signup") {
        router.replace({
          pathname: "/signup",
          params: { phone: res.phone || phone },
        });
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
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    try {
      const res = await apiFetch<{ success: boolean; sessionId?: string }>("/auth/phone/start", { method: "POST", body: { phone } });
      if (res.sessionId) setCurrentSessionId(res.sessionId);
      setCountdown(60);
      setDigits(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
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
            {digits.map((digit, i) => (
              <TextInput
                key={i}
                ref={(r) => { inputRefs.current[i] = r; }}
                style={[styles.otpInput, digit ? styles.otpInputFilled : null]}
                keyboardType="number-pad"
                maxLength={1}
                value={digit}
                onChangeText={(t) => handleDigitChange(t, i)}
                onKeyPress={({ nativeEvent }) => handleKeyPress(nativeEvent.key, i)}
                autoFocus={i === 0}
              />
            ))}
          </View>

          <TouchableOpacity
            style={[styles.button, !isComplete && styles.buttonDisabled]}
            onPress={handleVerify}
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
  phoneHighlight: {
    color: Colors.accent,
    fontWeight: "700",
  },
  otpRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    marginBottom: Spacing.xl,
  },
  otpInput: {
    width: 50,
    height: 58,
    backgroundColor: Colors.surface,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    color: Colors.text,
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
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
  resendLink: {
    color: Colors.accent,
    fontSize: 15,
    fontWeight: "700",
  },
});

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
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { saveSession } from "../session";

export default function PhoneScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

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

  const handleContinue = async () => {
    if (!isValid) return;
    setLoading(true);
    const fullPhone = `+91${phone.replace(/\s/g, "")}`;
    try {
      const res = await apiFetch<{
        success: boolean; sessionId: string; exists: boolean; bypass?: boolean;
      }>("/auth/phone/start", { method: "POST", body: { phone: fullPhone } });

      if (res.success && res.bypass) {
        const verifyRes = await apiFetch<{
          success: boolean; mode: string; token?: string; phone?: string;
          user?: { id: string; name: string; role: string; isActivated: boolean; phone?: string; email?: string };
        }>("/auth/phone/verify", { method: "POST", body: { phone: fullPhone, sessionId: "bypass", otp: "000000" } });

        if (verifyRes.mode === "login" && verifyRes.token && verifyRes.user) {
          await saveSession({ token: verifyRes.token, user: verifyRes.user });
          router.replace("/(tabs)/home");
        } else if (verifyRes.mode === "signup") {
          router.replace({ pathname: "/signup", params: { phone: verifyRes.phone || fullPhone } });
        }
      } else if (res.success) {
        router.push({ pathname: "/otp", params: { phone: fullPhone, sessionId: res.sessionId } });
      }
    } catch (err: unknown) {
      const error = err as { error?: string };
      Alert.alert("Error", error?.error || "Failed to send OTP. Try again.");
    } finally {
      setLoading(false);
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
          <Text style={styles.title}>Start delivering</Text>
          <Text style={styles.subtitle}>Enter your mobile number to continue</Text>

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

          <TouchableOpacity
            style={[styles.button, !isValid && styles.buttonDisabled]}
            onPress={handleContinue}
            disabled={!isValid || loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color={Colors.accentText} />
            ) : (
              <View style={styles.buttonInner}>
                <Text style={styles.buttonText}>Continue</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color={Colors.accentText} />
              </View>
            )}
          </TouchableOpacity>

          <Text style={styles.terms}>By continuing, you agree to our Terms of Service</Text>
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  container: { flex: 1, paddingHorizontal: Spacing.lg },
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
  buttonDisabled: { opacity: 0.4, shadowOpacity: 0 },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  terms: { color: Colors.textMuted, fontSize: 12, textAlign: "center", marginTop: Spacing.lg },
});

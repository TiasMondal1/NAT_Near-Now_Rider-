import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { clearSession, getSession, saveSession } from "../session";
import { resolveAuthenticatedRoute } from "../lib/riderVerification";
import type { VehicleType } from "../lib/riderVerificationDocuments";

const VEHICLE_OPTIONS: { value: VehicleType; label: string; icon: string }[] = [
  { value: "cycle", label: "Cycle", icon: "bike" },
  { value: "e-bike", label: "E-Bike", icon: "bicycle-electric" },
  { value: "bike", label: "Bike", icon: "motorbike" },
  { value: "scooty", label: "Scooty", icon: "scooter" },
];

export default function SignupScreen() {
  const router = useRouter();
  const { phone: phoneParam, signupTicket } = useLocalSearchParams<{ phone: string; signupTicket?: string }>();

  const [phone, setPhone] = useState(String(phoneParam || ""));
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(null);
  const [loading, setLoading] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    (async () => {
      if (phoneParam) {
        setPhone(String(phoneParam));
        return;
      }
      const session = await getSession();
      if (session?.user?.phone) setPhone(session.user.phone);
    })();
  }, [phoneParam]);

  const isValid = name.trim().length >= 2 && !!vehicleType;
  const isEmailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const normalizedPhone = String(phone || "").trim();

  const handleGoBack = async () => {
    await clearSession();
    router.replace("/phone");
  };

  const handleSignup = async () => {
    if (!isValid || !vehicleType) return;
    setLoading(true);
    try {
      const session = await getSession();
      const ticket = String(signupTicket || session?.signupTicket || "").trim();

      const res = await apiFetch<{
        success: boolean;
        error?: string;
        token?: string;
        user?: { id: string; name?: string; phone?: string; email?: string };
        supabaseSession?: { access_token: string; refresh_token: string };
      }>(
        "/delivery-partner/signup/complete",
        {
          method: "POST",
          body: {
            phone: normalizedPhone,
            signupTicket: ticket || undefined,
            name: name.trim(),
            email: email.trim() || undefined,
            address: address.trim() || undefined,
            vehicle_type: vehicleType,
          },
        },
        // Bearer from OTP verify — required by backend (403 without it)
        session?.token
      );

      if (!res.success || !res.token || !res.user) {
        Alert.alert("Signup Failed", res.error || "Could not complete registration. Please try again.");
        return;
      }

      await saveSession({
        token: res.token,
        supabaseSession: res.supabaseSession
          ? { accessToken: res.supabaseSession.access_token, refreshToken: res.supabaseSession.refresh_token }
          : undefined,
        user: {
          id: res.user.id,
          name: res.user.name || name.trim() || "Delivery Partner",
          role: "delivery_partner",
          isActivated: false,
          phone: res.user.phone || normalizedPhone,
          email: res.user.email || email.trim() || undefined,
        },
        needsSignupCompletion: false,
        signupTicket: undefined,
      });

      // New riders must upload docs next (Aadhaar / PAN / vehicle).
      router.replace(await resolveAuthenticatedRoute(res.token));
    } catch (err: unknown) {
      const error = err as { error?: string; message?: string; status?: number };
      const details = error?.error || error?.message || "Something went wrong.";
      Alert.alert(
        "Signup Failed",
        `${details}${error?.status ? `\n\nStatus: ${error.status}` : ""}`
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
        >
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={styles.headerIcon}>
              <MaterialCommunityIcons name="account-check" size={32} color={Colors.accent} />
            </View>
            <Text style={styles.title}>Complete your profile</Text>
            <Text style={styles.subtitle}>Set up your delivery partner account</Text>

            <View style={styles.card}>
              <Text style={styles.label}>Phone</Text>
              <View style={styles.readOnlyField}>
                <MaterialCommunityIcons name="phone" size={18} color={Colors.textMuted} />
                <Text style={styles.readOnlyText}>{phone}</Text>
              </View>

              <Text style={styles.label}>Full Name *</Text>
              <TextInput
                style={styles.input}
                placeholder="Your full name"
                placeholderTextColor={Colors.textMuted}
                value={name}
                onChangeText={setName}
                autoFocus
              />

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={[styles.input, email.trim() && !isEmailValid && styles.inputError]}
                placeholder="email@example.com"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />
              {email.trim() && !isEmailValid && (
                <Text style={styles.errorHint}>Please enter a valid email address</Text>
              )}

              <Text style={styles.label}>Address</Text>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: "top", paddingTop: 12 }]}
                placeholder="Your address"
                placeholderTextColor={Colors.textMuted}
                multiline
                value={address}
                onChangeText={setAddress}
              />

              <Text style={styles.label}>Vehicle Type *</Text>
              <View style={styles.vehicleGrid}>
                {VEHICLE_OPTIONS.map((vehicle) => {
                  const active = vehicleType === vehicle.value;
                  return (
                    <TouchableOpacity
                      key={vehicle.value}
                      style={[styles.vehicleOption, active && styles.vehicleOptionActive]}
                      onPress={() => setVehicleType(vehicle.value)}
                      activeOpacity={0.8}
                    >
                      <MaterialCommunityIcons
                        name={vehicle.icon as any}
                        size={22}
                        color={active ? Colors.accent : Colors.textMuted}
                      />
                      <Text style={[styles.vehicleLabel, active && styles.vehicleLabelActive]}>
                        {vehicle.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.vehicleHint}>
                Vehicle Registration is only required for Bike/Scooty — not Cycle/E-Bike.
              </Text>
            </View>

            <View style={styles.nextStepCard}>
              <View style={styles.nextStepIcon}>
                <MaterialCommunityIcons name="file-document-edit-outline" size={22} color={Colors.accent} />
              </View>
              <View style={styles.nextStepCopy}>
                <Text style={styles.nextStepTitle}>Document verification is next</Text>
                <Text style={styles.nextStepText}>
                  After signup, upload your Aadhaar card, PAN card and vehicle details on the secure document page.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.button, (!isValid || !isEmailValid) && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={!isValid || !isEmailValid || loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={Colors.accentText} />
              ) : (
                <View style={styles.buttonInner}>
                  <Text style={styles.buttonText}>Complete Signup</Text>
                  <MaterialCommunityIcons name="check" size={20} color={Colors.accentText} />
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.backRow} onPress={handleGoBack} disabled={loading}>
              <Text style={styles.backText}>Go back</Text>
            </TouchableOpacity>
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
    padding: Spacing.lg,
    paddingBottom: 120,
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
  },
  headerIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
  },
  title: { color: Colors.text, fontSize: 26, fontWeight: "800", marginBottom: Spacing.xs },
  subtitle: { color: Colors.textSecondary, fontSize: 15, marginBottom: Spacing.lg },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
  },
  label: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
    marginTop: Spacing.md,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: Colors.bg,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    height: 48,
    color: Colors.text,
    fontSize: 15,
  },
  readOnlyField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    height: 48,
  },
  readOnlyText: { color: Colors.textSecondary, fontSize: 15 },
  nextStepCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accent + "30",
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  nextStepIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bg,
  },
  nextStepCopy: { flex: 1 },
  nextStepTitle: { color: Colors.accentDark, fontSize: 14, fontWeight: "700" },
  nextStepText: { color: Colors.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 3 },
  button: {
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.lg,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    marginTop: Spacing.lg,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  buttonDisabled: { opacity: 0.4, shadowOpacity: 0 },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  buttonText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  inputError: { borderColor: Colors.danger, borderWidth: 1.5 },
  errorHint: { color: Colors.danger, fontSize: 12, marginTop: 4, marginLeft: 2 },
  vehicleGrid: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm, marginTop: Spacing.sm },
  vehicleOption: {
    flexBasis: "47%",
    flexGrow: 1,
    height: 76,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  vehicleOptionActive: { borderColor: Colors.accent, backgroundColor: Colors.accentLight },
  vehicleLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: "600" },
  vehicleLabelActive: { color: Colors.accentDark },
  vehicleHint: { color: Colors.textMuted, fontSize: 11, marginTop: Spacing.sm, lineHeight: 15 },
  backRow: { alignItems: "center", marginTop: Spacing.lg },
  backText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
});

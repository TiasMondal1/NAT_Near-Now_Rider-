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
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { saveSession } from "../session";

const DOC_TYPES = ["Aadhaar", "PAN", "Driving License"];

export default function SignupScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [address, setAddress] = useState("");
  const [docType, setDocType] = useState("Aadhaar");
  const [docNumber, setDocNumber] = useState("");
  const [loading, setLoading] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }).start();
  }, []);

  const isValid = name.trim().length >= 2;

  const handleSignup = async () => {
    if (!isValid) return;
    setLoading(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        token: string;
        user: { id: string; name: string; role: string; isActivated: boolean; phone?: string };
      }>("/delivery-partner/signup/complete", {
        method: "POST",
        body: {
          phone,
          name: name.trim(),
          email: email.trim() || undefined,
          password: password || undefined,
          address: address.trim() || undefined,
          verificationDocument: docType,
          verificationNumber: docNumber.trim() || undefined,
        },
      });

      if (res.success && res.token) {
        await saveSession({ token: res.token, user: res.user });
        router.replace("/(tabs)/home");
      }
    } catch (err: unknown) {
      const error = err as { error?: string };
      Alert.alert("Signup Failed", error?.error || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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
                style={styles.input}
                placeholder="email@example.com"
                placeholderTextColor={Colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
              />

              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Create a password"
                placeholderTextColor={Colors.textMuted}
                secureTextEntry
                value={password}
                onChangeText={setPassword}
              />

              <Text style={styles.label}>Address</Text>
              <TextInput
                style={[styles.input, { height: 80, textAlignVertical: "top", paddingTop: 12 }]}
                placeholder="Your address"
                placeholderTextColor={Colors.textMuted}
                multiline
                value={address}
                onChangeText={setAddress}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Verification Document</Text>
              <View style={styles.docRow}>
                {DOC_TYPES.map((dt) => (
                  <TouchableOpacity
                    key={dt}
                    style={[styles.docChip, docType === dt && styles.docChipActive]}
                    onPress={() => setDocType(dt)}
                  >
                    <Text style={[styles.docChipText, docType === dt && styles.docChipTextActive]}>
                      {dt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Document Number</Text>
              <TextInput
                style={styles.input}
                placeholder={`Enter ${docType} number`}
                placeholderTextColor={Colors.textMuted}
                value={docNumber}
                onChangeText={setDocNumber}
                autoCapitalize="characters"
              />
            </View>

            <TouchableOpacity
              style={[styles.button, !isValid && styles.buttonDisabled]}
              onPress={handleSignup}
              disabled={!isValid || loading}
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
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
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
  docRow: { flexDirection: "row", gap: Spacing.sm },
  docChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.round,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  docChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  docChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  docChipTextActive: { color: Colors.accentText },
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
});

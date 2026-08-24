import { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { clearSession, saveSession } from "../session";
import { resolveAuthenticatedRoute } from "../lib/riderVerification";

const OTP_LENGTH = 6;

type VerifyOtpResponse = {
  success: boolean;
  mode?: string;
  token?: string;
  phone?: string;
  signupTicket?: string;
  supabaseSession?: { access_token: string; refresh_token: string };
  user?: {
    id: string;
    name: string;
    role: "customer" | "shopkeeper" | "delivery_partner";
    phone?: string;
    email?: string;
  };
};

function toStoredSupabaseSession(supabaseSession?: { access_token: string; refresh_token: string }) {
  return supabaseSession
    ? { accessToken: supabaseSession.access_token, refreshToken: supabaseSession.refresh_token }
    : undefined;
}

async function hasRegisteredRiderProfile(token: string): Promise<boolean> {
  const profileRes = await apiFetch<{
    success?: boolean;
    profile?: {
      user_id?: string;
      name?: string;
      status?: string | null;
      verification_document?: string | null;
      address?: string | null;
    };
  }>("/delivery-partner/profile", {}, token);

  const profile = profileRes?.profile;
  if (!profileRes?.success || !profile) return false;

  // Registration and document upload are separate steps. A rider profile
  // created by /signup/complete counts as registered even before KYC upload.
  // Only `user_id` is checked (not `name`, which comes from a separate
  // app_users join in getProfile) — `user_id` is always populated directly
  // from the authenticated session's own riderId regardless of whether that
  // join succeeds, so it's the reliable signal here. Found 2026-07-31: a
  // production issue where that app_users join was silently failing made
  // `name` always undefined, so requiring it here permanently rejected every
  // real, registered rider as "not registered" — see getProfile's own fix.
  return Boolean(profile.user_id);
}

export default function OTPScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ phone: string; flow?: "new" | "existing" }>();
  const phone = params.phone;
  const flow = params.flow;

  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""));
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(60);
  const inputsRef = useRef<(TextInput | null)[]>(Array(OTP_LENGTH).fill(null));
  // React state alone can't guard against a double-submit: `loading` doesn't
  // take effect until the next render commits, so a fast double-tap (or the
  // auto-submit effect below firing right alongside a manual tap) can pass
  // the `loading` check twice before the button actually disables. Same
  // pattern/fix as the accept-offer race in the rider home screen.
  const verifyingRef = useRef(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, tension: 50, friction: 8, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

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
      Keyboard.dismiss();
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

  const rejectUnregisteredExistingUser = async () => {
    await clearSession();
    Alert.alert(
      "Not registered",
      "This phone number is not registered as a delivery partner. Please use New User Registration first.",
      [{ text: "OK", onPress: () => router.replace("/phone") }]
    );
  };

  const handleVerify = async (code = otp) => {
    if (code.length !== OTP_LENGTH || verifyingRef.current) return;
    verifyingRef.current = true;
    setLoading(true);
    try {
      const res = await apiFetch<VerifyOtpResponse>("/api/auth/verify-otp", {
        method: "POST",
        body: { phone, otp: code, role: "delivery_partner", name: "Delivery Partner" },
      });

      const mode = String(res.mode || "").toLowerCase();
      const isSignupMode = mode === "signup" || Boolean(res.signupTicket && !res.token);
      const isDeliveryPartner = res.user?.role === "delivery_partner";

      // ── New registration flow ──────────────────────────────────────────
      if (flow === "new") {
        // Already fully registered → log them in instead of opening signup again
        if (res.token && isDeliveryPartner) {
          // The OTP itself is already verified at this point (res.token was
          // issued by the backend) — a failure in this registration-status
          // check is a transient network/lookup problem, not proof the OTP
          // was wrong. Previously any throw here (e.g. a blip in the
          // profile fetch) fell through to the generic "Verification
          // Failed" handler below, which is misleading once the OTP itself
          // has already succeeded. Treat "couldn't check" as "assume not
          // yet registered" and fall through to the signup branch below,
          // rather than surfacing a false OTP-failure error.
          let registered = false;
          try {
            registered = await hasRegisteredRiderProfile(res.token);
          } catch (checkErr) {
            console.warn("[otp] hasRegisteredRiderProfile check failed:", checkErr);
          }
          if (registered) {
            try {
              await saveSession({
                token: res.token,
                supabaseSession: toStoredSupabaseSession(res.supabaseSession),
                user: {
                  ...res.user!,
                  role: "delivery_partner",
                },
                needsSignupCompletion: false,
              });
              router.replace(await resolveAuthenticatedRoute(res.token));
              return;
            } catch (routeErr) {
              // Session is already saved by this point (or saveSession itself
              // failed, in which case the session-restore on next app launch
              // will retry) — a routing-resolution failure here means we
              // genuinely don't know where to send them, but they ARE
              // logged in. Land on a safe, always-reachable screen instead
              // of reporting a fake OTP failure and clearing their code.
              console.warn("[otp] post-login route resolution failed:", routeErr);
              router.replace("/documents");
              return;
            }
          }
        }

        // Keep the OTP token — signup/complete needs it (returns 403 without auth).
        // Mark incomplete so splash/root layout force /signup until registration finishes.
        if (res.token && res.user) {
          await saveSession({
            token: res.token,
            user: {
              ...res.user,
              role: "delivery_partner",
              phone: res.user.phone || phone,
            },
            needsSignupCompletion: true,
            signupTicket: res.signupTicket || "",
          });
        } else {
          await clearSession();
        }

        router.replace({
          pathname: "/signup",
          params: {
            phone: res.phone || phone,
            signupTicket: res.signupTicket || "",
          },
        });
        return;
      }

      // ── Existing user login flow ───────────────────────────────────────
      // Unregistered phones must not log in — force New User Registration.
      if (isSignupMode || !res.token || !isDeliveryPartner) {
        await rejectUnregisteredExistingUser();
        return;
      }

      // The OTP is already verified at this point (res.token was issued by
      // the backend for this exact phone+role) — only a *clean, successful*
      // check that genuinely finds no profile should reject the login as
      // "not registered". A THROWN error here (transient network/timeout)
      // must not be treated the same way — that previously bounced a real,
      // fully-registered rider to "Not registered, use New User
      // Registration" (via the outer catch's generic error) purely because
      // of a network blip, which is actively misleading given their OTP
      // and account are both genuinely valid. On a throw, proceed with
      // login instead — resolveAuthenticatedRoute below will correctly
      // route them once real data is reachable, and falls back safely if
      // it isn't.
      let registered = true;
      try {
        registered = await hasRegisteredRiderProfile(res.token);
      } catch (checkErr) {
        console.warn("[otp] hasRegisteredRiderProfile check failed, proceeding with login:", checkErr);
      }
      if (!registered) {
        await rejectUnregisteredExistingUser();
        return;
      }

      await saveSession({
        token: res.token,
        supabaseSession: toStoredSupabaseSession(res.supabaseSession),
        user: {
          ...res.user!,
          role: "delivery_partner",
        },
        needsSignupCompletion: false,
      });
      // Registered but unverified → pending-verification (docs). Verified → home.
      try {
        router.replace(await resolveAuthenticatedRoute(res.token));
      } catch (routeErr) {
        // Session is already saved above — a routing-resolution failure
        // here (e.g. the profile fetch inside checkRiderVerification
        // timing out) means we genuinely don't know which screen to send
        // them to, but they ARE logged in. Land on a safe, always-reachable
        // screen instead of reporting a fake OTP/verification failure and
        // clearing their code — this is the exact failure mode a real user
        // reported (backend login succeeded per session_token_issued_at,
        // but the app showed "Verification Failed").
        console.warn("[otp] post-login route resolution failed:", routeErr);
        router.replace("/documents");
      }
      return;
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
      verifyingRef.current = false;
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
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        // Android already resizes the window when the keyboard opens
        // (AndroidManifest's windowSoftInputMode="adjustResize") — adding
        // KeyboardAvoidingView's own "height" compensation on top of that
        // double-shrinks the content, which is what made the keyboard look
        // like it was swallowing the whole screen instead of just its own
        // space. No behavior needed on Android; iOS still needs "padding"
        // since it has no equivalent native resize.
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
  backBtn: {
    marginTop: Spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { flexGrow: 1, justifyContent: "center", paddingVertical: Spacing.xl },
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

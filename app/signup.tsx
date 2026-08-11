import { useState, useEffect, useCallback, useRef } from "react";
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
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { clearSession, getSession, saveSession } from "../session";
import { resolveAuthenticatedRoute } from "../lib/riderVerification";
import type { VehicleType } from "../lib/riderVerificationDocuments";
import { peekRiderVerification } from "../lib/riderVerificationCache";
import { uploadRiderImage } from "../lib/storage";
import VerificationNavBar from "../components/VerificationNavBar";

const VEHICLE_OPTIONS: { value: VehicleType; label: string; icon: string }[] = [
  { value: "cycle", label: "Cycle", icon: "bike" },
  { value: "e-bike", label: "E-Bike", icon: "bicycle-electric" },
  { value: "bike", label: "Bike", icon: "motorbike" },
  { value: "scooty", label: "Scooty", icon: "scooter" },
];

export default function SignupScreen() {
  const router = useRouter();
  const { phone: phoneParam, signupTicket } = useLocalSearchParams<{ phone: string; signupTicket?: string }>();

  // Reached via direct navigation (the verification nav bar, or the back
  // button from documents/pending-verification) rather than fresh off OTP
  // verify — if signup was already completed, this screen shows the
  // submitted details read-only instead of a blank editable form. Riders
  // can only actually change these values later, from the Profile page,
  // via the existing admin-reviewed change-request flow.
  //
  // `phoneParam` is available synchronously (route params, no AsyncStorage
  // read needed), so viewOnly can be decided on the very first render
  // instead of waiting for an async session check — that's what let
  // Documents/Status render instantly while this screen still sat behind a
  // blank spinner. Seeded the same way from the shared verification cache
  // (populated by whichever of the 3 screens the rider hit first this
  // session) so name/vehicle type also appear immediately; only
  // email/address (not in that cache) and a corrected phone come in
  // slightly later from the network, without blocking the rest of the page.
  const cached = !phoneParam ? peekRiderVerification() : null;
  const [viewOnly, setViewOnly] = useState(!phoneParam);
  const [phone, setPhone] = useState(String(phoneParam || ""));
  const [name, setName] = useState(cached?.profile?.name || "");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [vehicleType, setVehicleType] = useState<VehicleType | null>(
    (cached?.profile?.vehicle_type as VehicleType | null) ?? null
  );
  const [loading, setLoading] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [profileFetchFailed, setProfileFetchFailed] = useState(false);
  // Tracks whether the network profile fetch has ever completed (success or
  // failure) so useFocusEffect knows to retry a fetch that silently failed
  // on first mount instead of re-fetching on every tab switch unnecessarily.
  const profileFetchedRef = useRef(false);

  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(
    cached?.profile?.profile_image_url ?? null
  );
  const [uploadingImage, setUploadingImage] = useState(false);
  // Set only on the fresh (pre-signup) form — there's no account yet to
  // attach the photo to, so the actual upload is deferred until handleSignup
  // succeeds and a real user id exists (see there for the upload call).
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    const session = await getSession();
    if (session?.user?.phone) setPhone(session.user.phone);
    if (!session?.token || session.needsSignupCompletion) {
      setViewOnly(false);
      return;
    }
    setViewOnly(true);

    // Only show a blocking spinner if nothing was available from cache —
    // otherwise the page already has real content on screen and this
    // fetch just fills in email/address/phone in the background.
    if (!cached?.profile) setLoadingProfile(true);
    try {
      const res = await apiFetch<{
        success: boolean;
        profile?: {
          name?: string;
          email?: string;
          address?: string;
          phone?: string;
          vehicle_type?: string;
          profile_image_url?: string | null;
        };
      }>("/delivery-partner/profile", {}, session.token);
      if (res.success && res.profile) {
        setName(res.profile.name || "");
        setEmail(res.profile.email || "");
        setAddress(res.profile.address || "");
        if (res.profile.phone) setPhone(res.profile.phone);
        if (res.profile.vehicle_type) setVehicleType(res.profile.vehicle_type as VehicleType);
        if (res.profile.profile_image_url !== undefined) setProfileImageUrl(res.profile.profile_image_url ?? null);
      }
      profileFetchedRef.current = true;
      setProfileFetchFailed(false);
    } catch {
      // Previously swallowed silently, leaving the screen stuck blank until
      // the rider happened to bounce to another tab and back (which forces a
      // fresh mount). profileFetchedRef stays false so the useFocusEffect
      // below retries automatically on the next focus instead of relying on
      // that manual workaround.
      setProfileFetchFailed(true);
    } finally {
      setLoadingProfile(false);
    }
    // `cached` is intentionally read only once at mount to decide whether to
    // show a spinner, not re-evaluated reactively — re-running this whole
    // effect on every cache mutation elsewhere in the app would refetch the
    // profile unnecessarily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phoneParam) {
      setPhone(String(phoneParam));
      return; // fresh from OTP verify — editable mode, nothing else to load
    }
    fetchProfile();
  }, [phoneParam, fetchProfile]);

  // Self-heals a failed (or not-yet-attempted) first fetch the moment this
  // screen regains focus — e.g. the rider switching to Status and back,
  // which is exactly the manual workaround that used to be required to see
  // Your Details populate after a transient cold-start network failure.
  useFocusEffect(
    useCallback(() => {
      if (!phoneParam && profileFetchedRef.current === false) {
        fetchProfile();
      }
    }, [phoneParam, fetchProfile])
  );

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to add your photo.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;

    if (!viewOnly) {
      // Fresh, pre-signup form — no account exists yet to upload against.
      // Just preview it locally; handleSignup uploads it for real once
      // signup succeeds and a real user id exists.
      setPendingImageUri(uri);
      setProfileImageUrl(uri);
      return;
    }
    if (profileImageUrl) return; // already set — read-only from here on

    const session = await getSession();
    if (!session?.token || !session?.user?.id) return;
    setUploadingImage(true);
    try {
      const res = await uploadRiderImage(session.user.id, uri);
      if (!res.ok) {
        Alert.alert("Upload failed", res.error);
        return;
      }
      await apiFetch("/delivery-partner/photo-urls", { method: "PATCH", body: { profile_image_url: res.url } }, session.token);
      setProfileImageUrl(res.url);
    } finally {
      setUploadingImage(false);
    }
  };

  const isValid = name.trim().length >= 2 && !!vehicleType;
  const isEmailValid = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const normalizedPhone = String(phone || "").trim();

  // Clear the push token before wiping the session (needs the auth token to
  // authenticate the call) — otherwise a shared device kept this rider's
  // expo_push_token registered indefinitely, so the next rider logging in
  // on the same device would receive this rider's order offers/status
  // pushes until it happened to get overwritten. Same guard profile.tsx
  // already has; this screen and pending-verification.tsx were missed.
  const clearPushTokenBeforeLogout = async () => {
    try {
      const session = await getSession();
      if (session?.token) {
        await apiFetch("/delivery-partner/push-token", { method: "PATCH", body: { expo_push_token: null } }, session.token);
      }
    } catch {
      // Non-fatal — logging out should never be blocked by this.
    }
  };

  const handleGoBack = async () => {
    await clearPushTokenBeforeLogout();
    await clearSession();
    router.replace("/phone");
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await clearPushTokenBeforeLogout();
          await clearSession();
          router.replace("/phone");
        },
      },
    ]);
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
          phone: res.user.phone || normalizedPhone,
          email: res.user.email || email.trim() || undefined,
        },
        needsSignupCompletion: false,
        signupTicket: undefined,
      });

      // Best-effort, fire-and-forget — a photo picked before the account
      // existed gets uploaded now that a real user id/token exists. Doesn't
      // block navigation; if it fails, the rider can add it later from
      // Billing Info or Profile.
      if (pendingImageUri) {
        (async () => {
          try {
            const uploadRes = await uploadRiderImage(res.user!.id, pendingImageUri);
            if (!uploadRes.ok) return;
            await apiFetch(
              "/delivery-partner/photo-urls",
              { method: "PATCH", body: { profile_image_url: uploadRes.url } },
              res.token
            );
          } catch {
            /* non-fatal */
          }
        })();
      }

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
      <Stack.Screen options={{ animation: "fade" }} />
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
          <View>
            {viewOnly && <VerificationNavBar active="details" />}

            <View style={styles.avatarSection}>
              <TouchableOpacity
                style={styles.avatarTouch}
                onPress={pickImage}
                disabled={uploadingImage || (viewOnly && !!profileImageUrl)}
                activeOpacity={viewOnly && profileImageUrl ? 1 : 0.8}
              >
                {uploadingImage ? (
                  <View style={styles.avatar}>
                    <ActivityIndicator color={Colors.accent} />
                  </View>
                ) : profileImageUrl ? (
                  <Image source={{ uri: profileImageUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatar}>
                    <MaterialCommunityIcons name="account" size={32} color={Colors.accent} />
                  </View>
                )}
                {viewOnly && profileImageUrl ? (
                  <View style={styles.lockBadge}>
                    <MaterialCommunityIcons name="lock" size={11} color="#fff" />
                  </View>
                ) : (
                  <View style={styles.camBadge}>
                    <MaterialCommunityIcons name="camera" size={12} color="#fff" />
                  </View>
                )}
              </TouchableOpacity>
              <Text style={styles.avatarHint}>
                {viewOnly && profileImageUrl
                  ? "Photo already on file — locked"
                  : profileImageUrl
                    ? "Tap to change your photo"
                    : "Tap to add your photo"}
              </Text>
            </View>
            <Text style={styles.title}>{viewOnly ? "Your Details" : "Complete your profile"}</Text>
            <Text style={styles.subtitle}>
              {viewOnly ? "Submitted — shown read-only until you're verified" : "Set up your delivery partner account"}
            </Text>

            {loadingProfile ? (
              <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.xl }} />
            ) : (
              <>
                {viewOnly && profileFetchFailed && !email && (
                  <TouchableOpacity
                    style={styles.retryBanner}
                    onPress={fetchProfile}
                  >
                    <MaterialCommunityIcons name="reload" size={16} color={Colors.accent} />
                    <Text style={styles.retryBannerText}>Couldn&apos;t load your details — tap to retry</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.card}>
                  <Text style={styles.label}>Phone</Text>
                  <View style={styles.readOnlyField}>
                    <MaterialCommunityIcons name="phone" size={18} color={Colors.textMuted} />
                    <Text style={styles.readOnlyText}>{phone}</Text>
                  </View>

                  <Text style={styles.label}>Full Name *</Text>
                  <TextInput
                    style={[styles.input, viewOnly && styles.inputReadOnly]}
                    placeholder="Your full name"
                    placeholderTextColor={Colors.textMuted}
                    value={name}
                    onChangeText={setName}
                    autoFocus={!viewOnly}
                    editable={!viewOnly}
                  />

                  <Text style={styles.label}>Email</Text>
                  <TextInput
                    style={[styles.input, viewOnly && styles.inputReadOnly, email.trim() && !isEmailValid && styles.inputError]}
                    placeholder="email@example.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onChangeText={setEmail}
                    editable={!viewOnly}
                  />
                  {email.trim() && !isEmailValid && (
                    <Text style={styles.errorHint}>Please enter a valid email address</Text>
                  )}

                  <Text style={styles.label}>Address</Text>
                  <TextInput
                    style={[styles.input, viewOnly && styles.inputReadOnly, { height: 80, textAlignVertical: "top", paddingTop: 12 }]}
                    placeholder="Your address"
                    placeholderTextColor={Colors.textMuted}
                    multiline
                    value={address}
                    onChangeText={setAddress}
                    editable={!viewOnly}
                  />

                  <Text style={styles.label}>Vehicle Type *</Text>
                  <View style={styles.vehicleGrid}>
                    {VEHICLE_OPTIONS.map((vehicle) => {
                      const active = vehicleType === vehicle.value;
                      return (
                        <TouchableOpacity
                          key={vehicle.value}
                          style={[styles.vehicleOption, active && styles.vehicleOptionActive, viewOnly && !active && styles.vehicleOptionDisabled]}
                          onPress={() => !viewOnly && setVehicleType(vehicle.value)}
                          activeOpacity={viewOnly ? 1 : 0.8}
                          disabled={viewOnly}
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

                {viewOnly ? (
                  <View style={styles.nextStepCard}>
                    <View style={styles.nextStepIcon}>
                      <MaterialCommunityIcons name="lock-outline" size={22} color={Colors.accent} />
                    </View>
                    <View style={styles.nextStepCopy}>
                      <Text style={styles.nextStepTitle}>These details are locked for now</Text>
                      <Text style={styles.nextStepText}>
                        Changes aren&apos;t possible here. Once you&apos;re verified, you can update your name, email, and address from your Profile page.
                      </Text>
                    </View>
                  </View>
                ) : (
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
                )}
              </>
            )}

            {!viewOnly && (
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
            )}

            {!viewOnly && (
              <TouchableOpacity style={styles.backRow} onPress={handleGoBack} disabled={loading}>
                <Text style={styles.backText}>Go back</Text>
              </TouchableOpacity>
            )}

            {viewOnly && (
              <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
                <MaterialCommunityIcons name="logout" size={18} color={Colors.danger} />
                <Text style={styles.logoutText}>Logout</Text>
              </TouchableOpacity>
            )}
          </View>
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
  retryBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.md,
  },
  retryBannerText: { color: Colors.accent, fontSize: 13, fontWeight: "600" },
  avatarSection: { alignItems: "center", marginTop: Spacing.md, marginBottom: Spacing.md },
  avatarTouch: { position: "relative" },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: Colors.card,
    overflow: "hidden",
  },
  camBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.card,
  },
  lockBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.card,
  },
  avatarHint: { fontSize: 12, color: Colors.textMuted, marginTop: Spacing.sm },
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
  inputReadOnly: { backgroundColor: Colors.surfaceLight, color: Colors.textSecondary },
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
  vehicleOptionDisabled: { opacity: 0.5 },
  vehicleLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: "600" },
  vehicleLabelActive: { color: Colors.accentDark },
  vehicleHint: { color: Colors.textMuted, fontSize: 11, marginTop: Spacing.sm, lineHeight: 15 },
  backRow: { alignItems: "center", marginTop: Spacing.lg },
  backText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    marginTop: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.dangerLight,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.dangerLight,
  },
  logoutText: { color: Colors.danger, fontSize: 15, fontWeight: "600" },
});

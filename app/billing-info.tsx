import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { getSession } from "../session";
import { uploadRiderImage } from "../lib/storage";
import { fetchBillingInfo, saveBillingInfo } from "../lib/billingInfo";
import VerificationNavBar from "../components/VerificationNavBar";

type PendingChangeRequest = { changes: Record<string, { old: string | null; new: string }> } | null;

export default function BillingInfoScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState<string | null>(null);

  const [name, setName] = useState<string | null>(null);
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [upiId, setUpiId] = useState("");
  const originalUpiIdRef = useRef("");
  const [saving, setSaving] = useState(false);
  const [pendingChangeRequest, setPendingChangeRequest] = useState<PendingChangeRequest>(null);

  const loadPendingChangeRequest = async (t: string) => {
    try {
      const json = await apiFetch<{ success: boolean; request: PendingChangeRequest }>(
        "/delivery-partner/profile-change-request",
        {},
        t
      );
      // profile.tsx's identity-field edits (name/email/address) share this
      // same request queue — only surface it here if it actually contains
      // upi_id, otherwise this screen would show a "pending review" banner
      // for a change it has nothing to do with.
      if (json?.request && "upi_id" in json.request.changes) {
        setPendingChangeRequest(json.request);
      } else {
        setPendingChangeRequest(null);
      }
    } catch {
      /* non-fatal — banner just doesn't show */
    }
  };

  // While a billing change is pending, poll for the admin's decision so the
  // banner clears without needing to leave and re-enter this screen — mirrors
  // profile.tsx's identical pattern for identity-field pending requests.
  useEffect(() => {
    if (!pendingChangeRequest || !token) return;
    const interval = setInterval(() => loadPendingChangeRequest(token), 20_000);
    return () => clearInterval(interval);
  }, [pendingChangeRequest, token]);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) {
        router.replace("/phone");
        return;
      }
      setToken(session.token);
      try {
        const info = await fetchBillingInfo(session.token);
        setName(info.name);
        setProfileImageUrl(info.profileImageUrl);
        setUpiId(info.upiId ?? "");
        originalUpiIdRef.current = info.upiId ?? "";
      } catch {
        /* non-fatal — screen still renders with empty state */
      } finally {
        setLoading(false);
      }
      void loadPendingChangeRequest(session.token);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickProfileImage = async () => {
    if (profileImageUrl) return; // already set — read-only from here on
    if (!token) return;
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

    const session = await getSession();
    if (!session?.user?.id) return;
    setUploadingImage(true);
    try {
      const res = await uploadRiderImage(session.user.id, result.assets[0].uri);
      if (!res.ok) {
        Alert.alert("Upload failed", res.error);
        return;
      }
      // The file is already in storage at this point — if this save fails,
      // it's orphaned there with nothing pointing at it. Previously
      // uncaught: any failure here (network blip, expired session, 500)
      // threw silently past the button's onPress with no alert at all, and
      // profileImageUrl was never set, so the avatar just reverted to the
      // placeholder with no indication anything had gone wrong.
      try {
        await apiFetch("/delivery-partner/photo-urls", { method: "PATCH", body: { profile_image_url: res.url } }, token);
        setProfileImageUrl(res.url);
      } catch {
        Alert.alert(
          "Save failed",
          "Your photo uploaded but we couldn't save it to your profile. Please try again."
        );
      }
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSave = async () => {
    if (!token) return;
    const trimmed = upiId.trim();
    if (trimmed && !/^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,64}$/.test(trimmed)) {
      Alert.alert("Invalid UPI ID", "Expected format e.g. name@bank.");
      return;
    }
    // The profile photo already saves immediately on pick — this button only
    // ever submits the UPI field, so tapping it without having edited UPI
    // (e.g. after just changing the photo, or a habitual re-tap) previously
    // surfaced the backend's generic "No changes to submit" error, easy to
    // trigger unintentionally since the photo picker and this button aren't
    // visually linked.
    if (trimmed === originalUpiIdRef.current) {
      Alert.alert("Nothing to save", "Your UPI ID hasn't changed.");
      return;
    }
    setSaving(true);
    try {
      const res = await saveBillingInfo(token, trimmed);
      if (!res.ok) {
        Alert.alert("Error", res.error);
        return;
      }
      Alert.alert("Submitted for review", "Your billing info change has been sent to the admin team for review before it takes effect.");
      originalUpiIdRef.current = trimmed;
      void loadPendingChangeRequest(token);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ animation: "fade" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <Stack.Screen options={{ animation: "fade" }} />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <VerificationNavBar active="billing" />

        <View style={styles.notice}>
          <MaterialCommunityIcons name="credit-card-outline" size={22} color={Colors.accent} />
          <Text style={styles.noticeText}>Billing info is used to pay out your delivery earnings.</Text>
        </View>

        {pendingChangeRequest && (
          <View style={styles.pendingBanner}>
            <MaterialCommunityIcons name="clock-outline" size={18} color={Colors.warning} />
            <View style={{ flex: 1, marginLeft: Spacing.sm }}>
              <Text style={styles.pendingBannerTitle}>Change pending admin review</Text>
              <Text style={styles.pendingBannerLine}>UPI ID: {pendingChangeRequest.changes.upi_id?.new}</Text>
            </View>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.avatarRow}>
            <TouchableOpacity
              style={styles.avatarTouch}
              onPress={pickProfileImage}
              disabled={uploadingImage || !!profileImageUrl}
              activeOpacity={profileImageUrl ? 1 : 0.8}
            >
              {uploadingImage ? (
                <View style={styles.avatar}>
                  <ActivityIndicator color={Colors.accent} />
                </View>
              ) : profileImageUrl ? (
                <Image source={{ uri: profileImageUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatar}>
                  <MaterialCommunityIcons name="account" size={30} color={Colors.accent} />
                </View>
              )}
              {!profileImageUrl && (
                <View style={styles.camBadge}>
                  <MaterialCommunityIcons name="camera" size={12} color="#fff" />
                </View>
              )}
              {!!profileImageUrl && (
                <View style={styles.lockBadge}>
                  <MaterialCommunityIcons name="lock" size={11} color="#fff" />
                </View>
              )}
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Driver Name</Text>
              <View style={styles.readOnlyField}>
                <Text style={styles.readOnlyText}>{name || "—"}</Text>
              </View>
              <Text style={styles.formatHintText}>
                {profileImageUrl
                  ? "Photo already on file — locked."
                  : "Tap the circle to add your photo (one-time, becomes read-only after)."}
              </Text>
            </View>
          </View>

          <Text style={[styles.inputLabel, { marginTop: Spacing.md }]}>UPI ID</Text>
          <TextInput
            style={styles.input}
            value={upiId}
            onChangeText={setUpiId}
            placeholder="e.g. name@bank"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
          />
        </View>

        <TouchableOpacity
          style={[styles.submitButton, saving && styles.disabled]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving ? (
            <ActivityIndicator color={Colors.accentText} />
          ) : (
            <>
              <MaterialCommunityIcons name="check-circle-outline" size={21} color={Colors.accentText} />
              <Text style={styles.submitText}>Save Billing Info</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.md,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accent + "25",
  },
  noticeText: { flex: 1, color: Colors.accentDark, fontSize: 13, lineHeight: 18 },
  pendingBanner: { flexDirection: "row", alignItems: "flex-start", backgroundColor: Colors.warningLight, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.warning, padding: Spacing.md, marginTop: Spacing.md },
  pendingBannerTitle: { fontWeight: "700", fontSize: 13, color: Colors.text, marginBottom: 2 },
  pendingBannerLine: { fontSize: 12, color: Colors.textSecondary },
  card: {
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  avatarRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  avatarTouch: { position: "relative" },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
    width: 22,
    height: 22,
    borderRadius: 11,
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
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.textMuted,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.card,
  },
  inputLabel: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  readOnlyField: {
    justifyContent: "center",
    backgroundColor: Colors.surfaceLight,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    height: 44,
  },
  readOnlyText: { color: Colors.text, fontSize: 15, fontWeight: "600" },
  formatHintText: { color: Colors.textMuted, fontSize: 11, fontWeight: "500", marginTop: 6 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    color: Colors.text,
    fontSize: 15,
  },
  submitButton: {
    height: 54,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  submitText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  disabled: { opacity: 0.55 },
});

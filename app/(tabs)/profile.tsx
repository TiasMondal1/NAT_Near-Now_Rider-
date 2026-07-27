import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../../constants/theme";
import { apiFetch } from "../../constants/api";
import { getSession, clearSession } from "../../session";
import { uploadRiderImage, uploadVehicleImage } from "../../lib/storage";

type Profile = {
  user_id: string;
  name: string;
  email: string | null;
  phone: string;
  address: string | null;
  verification_document: string | null;
  verification_number: string | null;
  is_online: boolean;
  profile_image_url: string | null;
  vehicle_image_url: string | null;
  vehicle_type: string | null;
  vehicle_number: string | null;
  created_at: string;
};

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [token, setToken] = useState("");
  const [totalDeliveries, setTotalDeliveries] = useState(0);
  const [totalEarnings, setTotalEarnings] = useState(0);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  // name/email/address edits now go through admin review instead of applying
  // immediately — see requestProfileChange() on the backend. pendingRef
  // mirrors the state for the transition check in loadPendingChangeRequest
  // without reading state inside a setState updater (a real side effect
  // there would violate React's purity requirement for updaters — see the
  // shopkeeper app's equivalent fix for why). pollSeqRef guards against an
  // in-flight poll resolving out of order and clobbering fresher state.
  const [pendingChangeRequest, setPendingChangeRequest] = useState<{
    id: string;
    changes: Record<string, { old: string | null; new: string }>;
  } | null>(null);
  const pendingChangeRequestRef = useRef<typeof pendingChangeRequest>(null);
  const pollSeqRef = useRef(0);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const fetchProfile = useCallback(async (t: string) => {
    try {
      const profileRes = await apiFetch<{ success: boolean; profile: Profile }>(
        "/delivery-partner/profile",
        {},
        t
      );
      if (profileRes.success) {
        setProfile(profileRes.profile);
        setName(profileRes.profile.name);
        setEmail(profileRes.profile.email || "");
        setAddress(profileRes.profile.address || "");
        setLoadError(false);
        return;
      }
      setLoadError(true);
    } catch {
      setLoadError(true);
    }
  }, []);

  const fetchStats = useCallback(async (t: string) => {
    try {
      const res = await apiFetch<{ success: boolean; orders: { total_amount: number; payout_amount: number | null }[] }>(
        "/delivery-partner/orders?status=completed",
        {},
        t
      );
      if (res.success) {
        setTotalDeliveries(res.orders.length);
        // Real payout amount (flat fee + tip) from delivery_partners_payouts, not
        // the old hardcoded 15% of total_amount with nothing server-side behind it.
        setTotalEarnings(res.orders.reduce((sum, o) => sum + (o.payout_amount ?? 0), 0));
      }
    } catch {}
  }, []);

  const loadPendingChangeRequest = useCallback(async (t: string) => {
    // Stale-response guard: only the most recently-issued fetch's result is
    // ever applied, so an earlier poll tick's response can't clobber fresher
    // state (e.g. one issued just before a submit, resolving just after).
    const seq = ++pollSeqRef.current;
    try {
      const res = await apiFetch<{ success: boolean; request: typeof pendingChangeRequest }>(
        "/delivery-partner/profile-change-request",
        {},
        t
      );
      if (seq !== pollSeqRef.current) return;
      if (!res.success) return;

      const nextRequest = res.request ?? null;
      const prev = pendingChangeRequestRef.current;
      pendingChangeRequestRef.current = nextRequest;
      setPendingChangeRequest(nextRequest);

      // A previously-pending request just resolved (approved/rejected) —
      // re-fetch the profile so an approved name/email/address shows up
      // without needing to leave and re-enter this screen.
      if (prev && !nextRequest) {
        fetchProfile(t).catch(() => {});
      }
    } catch {
      /* non-fatal */
    }
  }, [fetchProfile]);

  // While a change request is pending, poll for the admin's decision so the
  // banner clears (and the approved values refresh in) without needing to
  // leave and re-enter this screen.
  useEffect(() => {
    if (!pendingChangeRequest || !token) return;
    const interval = setInterval(() => loadPendingChangeRequest(token), 20_000);
    return () => clearInterval(interval);
  }, [pendingChangeRequest, token, loadPendingChangeRequest]);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) {
        setLoading(false);
        return;
      }
      setToken(session.token);
      await Promise.all([
        fetchProfile(session.token),
        fetchStats(session.token),
        loadPendingChangeRequest(session.token),
      ]);
      setLoading(false);
    })();
  }, [fetchProfile, fetchStats, loadPendingChangeRequest]);

  useFocusEffect(
    useCallback(() => {
      if (token) {
        fetchStats(token);
        loadPendingChangeRequest(token);
      }
    }, [token, fetchStats, loadPendingChangeRequest])
  );

  // Uploads directly to the delivery_partner_image bucket (anon-direct, same
  // pattern as the shopkeeper app's lib/storage.ts) instead of the old
  // PATCH /delivery-partner/profile-image base64-to-backend flow — the
  // backend only stores the resulting public URL now.
  const handlePickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to change your profile picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const session = await getSession();
    if (!session?.user?.id) return;

    setUploadingImage(true);
    try {
      const uploadRes = await uploadRiderImage(session.user.id, result.assets[0].uri);
      if (!uploadRes.ok) {
        Alert.alert("Error", uploadRes.error || "Failed to upload image. Please try again.");
        return;
      }
      await apiFetch(
        "/delivery-partner/photo-urls",
        { method: "PATCH", body: { profile_image_url: uploadRes.url } },
        token
      );
      setProfile((prev) => (prev ? { ...prev, profile_image_url: uploadRes.url } : prev));
    } catch {
      Alert.alert("Error", "Failed to upload image. Please try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  const [uploadingVehicleImage, setUploadingVehicleImage] = useState(false);
  const handlePickVehicleImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photo library access to change your vehicle picture.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]) return;

    const session = await getSession();
    if (!session?.user?.id) return;

    setUploadingVehicleImage(true);
    try {
      const uploadRes = await uploadVehicleImage(session.user.id, result.assets[0].uri);
      if (!uploadRes.ok) {
        Alert.alert("Error", uploadRes.error || "Failed to upload image. Please try again.");
        return;
      }
      await apiFetch(
        "/delivery-partner/photo-urls",
        { method: "PATCH", body: { vehicle_image_url: uploadRes.url } },
        token
      );
      setProfile((prev) => (prev ? { ...prev, vehicle_image_url: uploadRes.url } : prev));
    } catch {
      Alert.alert("Error", "Failed to upload image. Please try again.");
    } finally {
      setUploadingVehicleImage(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const session = await getSession();
      if (!session?.user?.id) {
        Alert.alert("Error", "Session expired. Please login again.");
        return;
      }

      const patch: Record<string, string> = {};
      const trimmedName = name.trim() || "Delivery Partner";
      if (trimmedName !== (profile?.name ?? "")) patch.name = trimmedName;
      if (email.trim() !== (profile?.email ?? "")) patch.email = email.trim();
      if (address.trim() !== (profile?.address ?? "")) patch.address = address.trim();

      if (Object.keys(patch).length === 0) {
        setEditing(false);
        return;
      }

      // Name/email/address no longer apply immediately — they go through
      // admin review (requestProfileChange on the backend). Revert the
      // visible fields to the still-current approved values; the pending
      // banner below shows what was actually submitted.
      const res = await apiFetch<{ success: boolean; request: typeof pendingChangeRequest; error?: string }>(
        "/delivery-partner/profile-change-request",
        { method: "POST", body: patch },
        token
      );
      if (!res.success) {
        throw new Error(res.error || "Failed to submit changes");
      }

      pollSeqRef.current++; // invalidate any in-flight poll issued before this submit
      pendingChangeRequestRef.current = res.request;
      setPendingChangeRequest(res.request);
      if (profile) {
        setName(profile.name);
        setEmail(profile.email || "");
        setAddress(profile.address || "");
      }
      setEditing(false);
      Alert.alert("Submitted for review", "Your requested changes have been sent to the admin team and will apply once approved.");
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Failed to save profile.");
    }
    setSaving(false);
  };

  const handleLogout = () => {
    Alert.alert("Logout", "Are you sure you want to logout?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await clearSession();
          router.replace("/phone");
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </SafeAreaView>
    );
  }

  if (loadError && !profile) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={{ color: Colors.text, fontSize: 15, marginBottom: Spacing.md }}>
          Couldn&apos;t load your profile.
        </Text>
        <TouchableOpacity
          style={styles.editBtn}
          onPress={async () => {
            setLoading(true);
            const session = await getSession();
            if (session?.token) await fetchProfile(session.token);
            setLoading(false);
          }}
        >
          <Text style={styles.editBtnText}>Retry</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const initial = profile?.name?.charAt(0)?.toUpperCase() || "?";

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 8 : 0}
      >
      <View style={styles.responsiveWrap}>
      <Animated.View style={[styles.headerRow, { opacity: fadeAnim }]}>
        <Text style={styles.header}>Profile</Text>
        {!editing ? (
          <TouchableOpacity
            style={styles.editBtn}
            onPress={() => setEditing(true)}
          >
            <MaterialCommunityIcons name="pencil" size={16} color={Colors.accent} />
            <Text style={styles.editBtnText}>Edit</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => setEditing(false)}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
      </Animated.View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          <View style={styles.avatarSection}>
            <TouchableOpacity
              style={styles.avatarOuter}
              onPress={editing ? handlePickImage : undefined}
              disabled={uploadingImage}
              activeOpacity={editing ? 0.7 : 1}
            >
              {profile?.profile_image_url ? (
                <Image source={{ uri: profile.profile_image_url }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial}</Text>
                </View>
              )}

              {/* Camera overlay shown in edit mode */}
              {editing && (
                <View style={styles.avatarEditOverlay}>
                  {uploadingImage ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialCommunityIcons name="camera" size={22} color="#fff" />
                  )}
                </View>
              )}

              {/* Online/offline dot */}
              <View
                style={[
                  styles.onlineDot,
                  { backgroundColor: profile?.is_online ? Colors.online : Colors.offline },
                ]}
              />
            </TouchableOpacity>
            <Text style={styles.displayName}>{profile?.name}</Text>
            <View style={styles.roleBadge}>
              <MaterialCommunityIcons name="truck-delivery" size={12} color={Colors.accent} style={{ marginRight: 4 }} />
              <Text style={styles.roleText}>Delivery Partner</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.accentLight }]}>
                <MaterialCommunityIcons name="package-variant-closed" size={18} color={Colors.accent} />
              </View>
              <Text style={styles.statValue}>{totalDeliveries}</Text>
              <Text style={styles.statLabel}>Deliveries</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.successLight }]}>
                <MaterialCommunityIcons name="currency-inr" size={18} color={Colors.success} />
              </View>
              <Text style={styles.statValue}>{"₹"}{totalEarnings.toFixed(0)}</Text>
              <Text style={styles.statLabel}>Earned</Text>
            </View>
          </View>

          {pendingChangeRequest && (
            <View style={styles.pendingBanner}>
              <MaterialCommunityIcons name="clock-outline" size={18} color={Colors.warning} />
              <View style={{ flex: 1, marginLeft: Spacing.sm }}>
                <Text style={styles.pendingBannerTitle}>Changes pending admin review</Text>
                {Object.entries(pendingChangeRequest.changes).map(([field, diff]) => (
                  <Text key={field} style={styles.pendingBannerLine}>
                    {field === "name" ? "Name" : field === "email" ? "Email" : "Address"}: {diff.new}
                  </Text>
                ))}
              </View>
            </View>
          )}

          <View style={styles.infoCard}>
            <FieldRow label="Full Name" editing={editing} value={name} displayValue={profile?.name || ""} onChangeText={setName} icon="account" />
            <View style={styles.fieldDivider} />
            <FieldRow label="Phone" displayValue={profile?.phone || ""} readOnly icon="phone" />
            <View style={styles.fieldDivider} />
            <FieldRow label="Email" editing={editing} value={email} displayValue={profile?.email || "Not provided"} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="email@example.com" icon="email" />
            <View style={styles.fieldDivider} />
            <FieldRow label="Address" editing={editing} value={address} displayValue={profile?.address || "Not provided"} onChangeText={setAddress} multiline placeholder="Your address" icon="map-marker" />
          </View>

          <View style={styles.infoCard}>
            <View style={styles.vehiclePhotoRow}>
              <TouchableOpacity
                style={styles.vehiclePhotoThumb}
                onPress={handlePickVehicleImage}
                disabled={uploadingVehicleImage}
                activeOpacity={0.8}
              >
                {profile?.vehicle_image_url ? (
                  <Image source={{ uri: profile.vehicle_image_url }} style={styles.vehiclePhotoImage} />
                ) : (
                  <MaterialCommunityIcons name="motorbike" size={24} color={Colors.textMuted} />
                )}
                <View style={styles.vehiclePhotoOverlay}>
                  {uploadingVehicleImage ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <MaterialCommunityIcons name="camera" size={16} color="#fff" />
                  )}
                </View>
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.fieldLabel}>Vehicle Photo</Text>
                <Text style={styles.fieldValueMuted}>
                  {profile?.vehicle_image_url ? "Tap to change" : "Tap to add a photo of your vehicle"}
                </Text>
              </View>
            </View>
            <View style={styles.fieldDivider} />
            <FieldRow
              label="Vehicle Type"
              displayValue={
                profile?.vehicle_type
                  ? profile.vehicle_type.charAt(0).toUpperCase() + profile.vehicle_type.slice(1)
                  : "Not set"
              }
              readOnly
              icon="motorbike"
            />
            <View style={styles.fieldDivider} />
            <FieldRow
              label="Vehicle Number"
              displayValue={profile?.vehicle_number || "Not provided"}
              readOnly
              icon="card-text-outline"
            />
            <View style={styles.fieldDivider} />
            <View style={styles.fieldRowView}>
              <View style={styles.fieldLabelRow}>
                <MaterialCommunityIcons name="calendar-clock" size={14} color={Colors.accent} />
                <Text style={styles.fieldLabel}>Member Since</Text>
              </View>
              <Text style={styles.fieldValueMuted}>
                {profile?.created_at
                  ? new Date(profile.created_at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "---"}
              </Text>
            </View>
          </View>

          {editing && (
            <TouchableOpacity
              style={[styles.saveButton, saving && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={Colors.accentText} />
              ) : (
                <View style={styles.saveInner}>
                  <MaterialCommunityIcons name="check" size={20} color={Colors.accentText} />
                  <Text style={styles.saveText}>Save Changes</Text>
                </View>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.quickActions}>
            <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push("/documents")}>
              <MaterialCommunityIcons name="file-document-edit-outline" size={20} color={Colors.accent} />
              <View style={styles.quickActionCopy}>
                <Text style={styles.quickActionText}>Upload Documents</Text>
                <Text style={styles.quickActionSubtext}>Aadhaar, PAN, Driving License, Vehicle RC</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.fieldDivider} />
            <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push("/(tabs)/earnings")}>
              <MaterialCommunityIcons name="chart-line" size={20} color={Colors.accent} />
              <Text style={styles.quickActionText}>View Earnings</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.fieldDivider} />
            <TouchableOpacity style={styles.quickActionBtn} onPress={() => router.push("/(tabs)/orders")}>
              <MaterialCommunityIcons name="clipboard-list" size={20} color={Colors.accent} />
              <Text style={styles.quickActionText}>Order History</Text>
              <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={18} color={Colors.danger} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>

          <Text style={styles.version}>Near & Now v1.0.0</Text>
        </Animated.View>
      </ScrollView>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FieldRow({ label, editing, value, displayValue, onChangeText, readOnly, keyboardType, autoCapitalize, multiline, placeholder, icon }: {
  label: string; editing?: boolean; value?: string; displayValue: string; onChangeText?: (t: string) => void; readOnly?: boolean; keyboardType?: any; autoCapitalize?: any; multiline?: boolean; placeholder?: string; icon?: string;
}) {
  return (
    <View style={{ paddingVertical: Spacing.sm }}>
      <View style={styles.fieldLabelRow}>
        {icon && <MaterialCommunityIcons name={icon as any} size={14} color={Colors.accent} />}
        <Text style={styles.fieldLabel}>{label}</Text>
        {readOnly && (
          <View style={styles.readOnlyBadge}>
            <MaterialCommunityIcons name="lock" size={10} color={Colors.textMuted} />
          </View>
        )}
      </View>
      {editing && !readOnly ? (
        <TextInput
          style={[styles.fieldInput, multiline && { height: 60, textAlignVertical: "top", paddingTop: 10 }]}
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          placeholder={placeholder}
          placeholderTextColor={Colors.textMuted}
        />
      ) : (
        <Text style={readOnly ? styles.fieldValueMuted : styles.fieldValue}>{displayValue}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  responsiveWrap: { flex: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
  safe: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  centered: { flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  header: { color: Colors.text, fontSize: 28, fontWeight: "800" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: Colors.accentLight, borderRadius: BorderRadius.round, paddingHorizontal: Spacing.md, paddingVertical: 6, backgroundColor: Colors.accentLight },
  editBtnText: { color: Colors.accent, fontSize: 13, fontWeight: "600" },
  cancelText: { color: Colors.textSecondary, fontSize: 15, fontWeight: "600" },
  scroll: { padding: Spacing.lg, paddingBottom: 140 },

  avatarSection: { alignItems: "center", marginBottom: Spacing.lg },
  avatarOuter: { position: "relative", marginBottom: Spacing.md, width: 88, height: 88 },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: Colors.accentLight, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: 88, height: 88, borderRadius: 44 },
  avatarText: { color: Colors.accent, fontSize: 34, fontWeight: "800" },
  avatarEditOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: 44,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  onlineDot: { position: "absolute", bottom: 2, right: 2, width: 18, height: 18, borderRadius: 9, borderWidth: 3, borderColor: Colors.bg },
  displayName: { color: Colors.text, fontSize: 22, fontWeight: "700" },
  roleBadge: { flexDirection: "row", alignItems: "center", marginTop: 6, borderWidth: 1, borderColor: Colors.accentLight, borderRadius: BorderRadius.round, paddingHorizontal: Spacing.md, paddingVertical: 4, backgroundColor: Colors.accentLight },
  roleText: { color: Colors.accent, fontSize: 12, fontWeight: "600" },

  statsRow: {
    flexDirection: "row",
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  statItem: { flex: 1, alignItems: "center" },
  statIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: "800" },
  statLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: "600", marginTop: 2 },
  statDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },

  infoCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md, shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  pendingBanner: { flexDirection: "row", alignItems: "flex-start", backgroundColor: Colors.warningLight, borderRadius: BorderRadius.lg, borderWidth: 1, borderColor: Colors.warning, padding: Spacing.md, marginBottom: Spacing.md },
  pendingBannerTitle: { fontWeight: "700", fontSize: 13, color: Colors.text, marginBottom: 2 },
  pendingBannerLine: { fontSize: 12, color: Colors.textSecondary },
  fieldRowView: { paddingVertical: Spacing.sm },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  fieldLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  readOnlyBadge: { marginLeft: 4 },
  fieldValue: { color: Colors.text, fontSize: 16 },
  fieldValueMuted: { color: Colors.textSecondary, fontSize: 16 },
  fieldInput: { backgroundColor: Colors.surface, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, height: 42, color: Colors.text, fontSize: 15, borderWidth: 1, borderColor: Colors.accent + "40" },
  fieldDivider: { height: 1, backgroundColor: Colors.border },

  vehiclePhotoRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingVertical: Spacing.sm },
  vehiclePhotoThumb: {
    width: 64,
    height: 64,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    position: "relative",
  },
  vehiclePhotoImage: { width: 64, height: 64 },
  vehiclePhotoOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 22,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },

  quickActions: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: Spacing.md,
    overflow: "hidden",
  },
  quickActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.lg,
  },
  quickActionCopy: { flex: 1 },
  quickActionText: { flex: 1, color: Colors.text, fontSize: 15, fontWeight: "600" },
  quickActionSubtext: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },

  saveButton: { backgroundColor: Colors.accent, borderRadius: BorderRadius.md, height: 52, alignItems: "center", justifyContent: "center", marginTop: Spacing.sm, marginBottom: Spacing.md, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  saveInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  saveText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  logoutButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.dangerLight, borderRadius: BorderRadius.md, backgroundColor: Colors.dangerLight },
  logoutText: { color: Colors.danger, fontSize: 15, fontWeight: "600" },
  version: { color: Colors.textMuted, fontSize: 12, textAlign: "center", marginTop: Spacing.lg },
});

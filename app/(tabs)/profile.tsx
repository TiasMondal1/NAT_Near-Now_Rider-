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
import { getSession, clearSession, UserSession } from "../../session";

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
  created_at: string;
};

type DeliveryPartnerListItem = {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string;
  profile?: {
    user_id?: string;
    phone?: string | null;
    address?: string | null;
    verification_document?: string | null;
    verification_number?: string | null;
    is_online?: boolean;
    profile_image_url?: string | null;
    created_at?: string;
  } | null;
};

const normalizePhone = (value?: string | null) => String(value || "").replace(/\D/g, "");

const mapPartnerToProfile = (partner: DeliveryPartnerListItem): Profile => ({
  user_id: partner.profile?.user_id || partner.id,
  name: partner.name || "Delivery Partner",
  email: partner.email || null,
  phone: partner.phone || partner.profile?.phone || "",
  address: partner.profile?.address || null,
  verification_document: partner.profile?.verification_document || null,
  verification_number: partner.profile?.verification_number || null,
  is_online: Boolean(partner.profile?.is_online),
  profile_image_url: partner.profile?.profile_image_url || null,
  created_at: partner.profile?.created_at || partner.created_at || "",
});

const findPartnerForSession = (partners: DeliveryPartnerListItem[], session: UserSession) => {
  const sessionId = String(session.user?.id || "");
  const sessionPhone = normalizePhone(session.user?.phone);

  return partners.find((partner) => {
    const partnerId = String(partner.id || "");
    const userId = String(partner.profile?.user_id || "");
    const appUserPhone = normalizePhone(partner.phone);
    const profilePhone = normalizePhone(partner.profile?.phone);

    return (
      (sessionId && (partnerId === sessionId || userId === sessionId)) ||
      (sessionPhone && (appUserPhone === sessionPhone || profilePhone === sessionPhone))
    );
  });
};

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [token, setToken] = useState("");
  const [totalDeliveries, setTotalDeliveries] = useState(0);
  const [totalEarnings, setTotalEarnings] = useState(0);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, []);

  const fetchProfile = useCallback(async (t: string, session: UserSession) => {
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
        return;
      }

      // Fallback
      const partners = await apiFetch<DeliveryPartnerListItem[]>("/api/delivery/partners");
      const matchedPartner = findPartnerForSession(partners, session);
      if (matchedPartner) {
        const mappedProfile = mapPartnerToProfile(matchedPartner);
        setProfile(mappedProfile);
        setName(mappedProfile.name);
        setEmail(mappedProfile.email || "");
        setAddress(mappedProfile.address || "");
      }
    } catch {}
  }, []);

  const fetchStats = useCallback(async (t: string) => {
    try {
      const res = await apiFetch<{ success: boolean; orders: { total_amount: number }[] }>(
        "/delivery-partner/orders?status=completed",
        {},
        t
      );
      if (res.success) {
        setTotalDeliveries(res.orders.length);
        setTotalEarnings(res.orders.reduce((sum, o) => sum + Number(o.total_amount) * 0.15, 0));
      }
    } catch {}
  }, []);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) {
        setLoading(false);
        return;
      }
      setToken(session.token);
      await Promise.all([fetchProfile(session.token, session), fetchStats(session.token)]);
      setLoading(false);
    })();
  }, [fetchProfile, fetchStats]);

  useFocusEffect(
    useCallback(() => {
      if (token) fetchStats(token);
    }, [token, fetchStats])
  );

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
      base64: true,
    });

    if (result.canceled || !result.assets?.[0]?.base64) return;

    const asset = result.assets[0];
    setUploadingImage(true);
    try {
      const res = await apiFetch<{ success: boolean; profile_image_url: string }>(
        "/delivery-partner/profile-image",
        {
          method: "PATCH",
          body: {
            image_base64: asset.base64,
            mime_type: asset.mimeType || "image/jpeg",
          },
        },
        token
      );
      if (res.success) {
        setProfile((prev) => prev ? { ...prev, profile_image_url: res.profile_image_url } : prev);
      }
    } catch {
      Alert.alert("Error", "Failed to upload image. Please try again.");
    } finally {
      setUploadingImage(false);
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

      const res = await apiFetch<{ success: boolean; profile: Profile }>(
        "/delivery-partner/profile",
        {
          method: "PATCH",
          body: {
            name: name.trim() || "Delivery Partner",
            email: email.trim() || undefined,
            address: address.trim() || undefined,
          },
        },
        token
      );
      if (res.success) {
        setProfile(res.profile);
        setName(res.profile.name);
        setEmail(res.profile.email || "");
        setAddress(res.profile.address || "");
        setEditing(false);
      }
    } catch {
      Alert.alert("Error", "Failed to save profile.");
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
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.warningLight }]}>
                <MaterialCommunityIcons name="star" size={18} color={Colors.warning} />
              </View>
              <Text style={styles.statValue}>4.8</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
          </View>

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
            <View style={styles.fieldRowView}>
              <View style={styles.fieldLabelRow}>
                <MaterialCommunityIcons name="shield-check" size={14} color={Colors.accent} />
                <Text style={styles.fieldLabel}>Verification Document</Text>
              </View>
              <Text style={styles.fieldValue}>
                {profile?.verification_document || "---"}
              </Text>
            </View>
            <View style={styles.fieldDivider} />
            <View style={styles.fieldRowView}>
              <View style={styles.fieldLabelRow}>
                <MaterialCommunityIcons name="card-account-details" size={14} color={Colors.accent} />
                <Text style={styles.fieldLabel}>Verification Number</Text>
              </View>
              <Text style={styles.fieldValue}>
                {profile?.verification_number || "---"}
              </Text>
            </View>
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
                <Text style={styles.quickActionSubtext}>Aadhaar, PAN and vehicle details</Text>
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
  fieldRowView: { paddingVertical: Spacing.sm },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  fieldLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  readOnlyBadge: { marginLeft: 4 },
  fieldValue: { color: Colors.text, fontSize: 16 },
  fieldValueMuted: { color: Colors.textSecondary, fontSize: 16 },
  fieldInput: { backgroundColor: Colors.surface, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, height: 42, color: Colors.text, fontSize: 15, borderWidth: 1, borderColor: Colors.accent + "40" },
  fieldDivider: { height: 1, backgroundColor: Colors.border },

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

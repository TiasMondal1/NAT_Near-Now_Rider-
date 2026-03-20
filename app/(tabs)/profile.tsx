import { useState, useEffect, useRef } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../../constants/theme";
import { apiFetch } from "../../constants/api";
import { getSession, clearSession } from "../../session";

type Profile = {
  user_id: string;
  name: string;
  email: string | null;
  phone: string;
  address: string | null;
  verification_document: string | null;
  verification_number: string | null;
  is_online: boolean;
  created_at: string;
};

export default function ProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [token, setToken] = useState("");

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

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) return;
      setToken(session.token);

      try {
        const res = await apiFetch<{ success: boolean; profile: Profile }>(
          "/delivery-partner/profile",
          {},
          session.token
        );
        if (res.success) {
          setProfile(res.profile);
          setName(res.profile.name);
          setEmail(res.profile.email || "");
          setAddress(res.profile.address || "");
        }
      } catch {}

      setLoading(false);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ success: boolean; profile: Profile }>(
        "/delivery-partner/profile",
        {
          method: "PATCH",
          body: {
            name: name.trim(),
            email: email.trim() || undefined,
            address: address.trim() || undefined,
          },
        },
        token
      );
      if (res.success) {
        setProfile(res.profile);
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
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  const initial = profile?.name?.charAt(0)?.toUpperCase() || "?";

  return (
    <SafeAreaView style={styles.safe}>
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

      <ScrollView contentContainerStyle={styles.scroll}>
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <Text style={styles.displayName}>{profile?.name}</Text>
            <View style={styles.roleBadge}>
              <MaterialCommunityIcons name="truck-delivery" size={12} color={Colors.accent} style={{ marginRight: 4 }} />
              <Text style={styles.roleText}>Delivery Partner</Text>
            </View>
          </View>

          {/* Info cards */}
          <View style={styles.infoCard}>
            <FieldRow label="Full Name" editing={editing} value={name} displayValue={profile?.name || ""} onChangeText={setName} icon="account" />
            <View style={styles.fieldDivider} />
            <FieldRow label="Phone" displayValue={profile?.phone || ""} readOnly icon="phone" />
            <View style={styles.fieldDivider} />
            <FieldRow label="Email" editing={editing} value={email} displayValue={profile?.email || "Not provided"} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="email@example.com" icon="email" />
            <View style={styles.fieldDivider} />
            <FieldRow label="Address" editing={editing} value={address} displayValue={profile?.address || "Not provided"} onChangeText={setAddress} multiline placeholder="Your address" icon="map-marker" />
          </View>

          {/* Verification card */}
          <View style={styles.infoCard}>
            <View style={styles.fieldRowView}>
              <View style={styles.fieldLabelRow}>
                <MaterialCommunityIcons name="shield-check" size={14} color={Colors.accent} />
                <Text style={styles.fieldLabel}>Verification</Text>
              </View>
              <Text style={styles.fieldValue}>
                {profile?.verification_document || "---"}{" "}
                {profile?.verification_number ? ` · ${profile.verification_number}` : ""}
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

          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <MaterialCommunityIcons name="logout" size={18} color={Colors.danger} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>

          <Text style={styles.version}>Near & Now v1.0.0</Text>
        </Animated.View>
      </ScrollView>
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
      </View>
      {editing && !readOnly ? (
        <TextInput
          style={[styles.fieldInput, multiline && { height: 60, textAlignVertical: "top" }]}
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
  safe: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  header: { color: Colors.text, fontSize: 28, fontWeight: "800" },
  editBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: Colors.accentLight, borderRadius: BorderRadius.round, paddingHorizontal: Spacing.md, paddingVertical: 6, backgroundColor: Colors.accentLight },
  editBtnText: { color: Colors.accent, fontSize: 13, fontWeight: "600" },
  cancelText: { color: Colors.textSecondary, fontSize: 15, fontWeight: "600" },
  scroll: { padding: Spacing.lg, paddingBottom: 60 },
  avatarSection: { alignItems: "center", marginBottom: Spacing.xl },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.accentLight, borderWidth: 2, borderColor: Colors.accent, alignItems: "center", justifyContent: "center", marginBottom: Spacing.md },
  avatarText: { color: Colors.accent, fontSize: 32, fontWeight: "800" },
  displayName: { color: Colors.text, fontSize: 20, fontWeight: "700" },
  roleBadge: { flexDirection: "row", alignItems: "center", marginTop: 6, borderWidth: 1, borderColor: Colors.accentLight, borderRadius: BorderRadius.round, paddingHorizontal: Spacing.md, paddingVertical: 4, backgroundColor: Colors.accentLight },
  roleText: { color: Colors.accent, fontSize: 12, fontWeight: "600" },
  infoCard: { backgroundColor: Colors.card, borderRadius: BorderRadius.lg, padding: Spacing.lg, borderWidth: 1, borderColor: Colors.border, marginBottom: Spacing.md, shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 1, shadowRadius: 8, elevation: 2 },
  fieldRowView: { paddingVertical: Spacing.sm },
  fieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  fieldLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  fieldValue: { color: Colors.text, fontSize: 16 },
  fieldValueMuted: { color: Colors.textSecondary, fontSize: 16 },
  fieldInput: { backgroundColor: Colors.surface, borderRadius: BorderRadius.sm, paddingHorizontal: Spacing.md, height: 42, color: Colors.text, fontSize: 15, borderWidth: 1, borderColor: Colors.border },
  fieldDivider: { height: 1, backgroundColor: Colors.border },
  saveButton: { backgroundColor: Colors.accent, borderRadius: BorderRadius.md, height: 52, alignItems: "center", justifyContent: "center", marginTop: Spacing.sm, shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  saveInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  saveText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  logoutButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: Spacing.sm, marginTop: Spacing.xl, paddingVertical: Spacing.md, borderWidth: 1, borderColor: Colors.dangerLight, borderRadius: BorderRadius.md, backgroundColor: Colors.dangerLight },
  logoutText: { color: Colors.danger, fontSize: 15, fontWeight: "600" },
  version: { color: Colors.textMuted, fontSize: 12, textAlign: "center", marginTop: Spacing.lg },
});

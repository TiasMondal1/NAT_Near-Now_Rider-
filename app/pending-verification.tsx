import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { clearSession } from "../session";
import { supabase } from "../lib/supabase";
import { restoreRiderRealtimeSession } from "../lib/riderRealtimeAuth";
import { useRiderVerificationGate } from "../lib/useRiderVerificationGate";
import { isVehicleRegistrationRequired, REQUIRED_DOC_KEYS, type RequiredDocKey } from "../lib/riderVerificationDocuments";
import { ADMIN_CONTACTS, formatPhoneForDisplay } from "../constants/config";
import VerificationNavBar from "../components/VerificationNavBar";

const STEPS = [
  { key: "upload", label: "Upload documents", icon: "cloud-upload-outline" as const },
  { key: "review", label: "Admin verification", icon: "shield-check-outline" as const },
  { key: "live", label: "Start delivering", icon: "truck-fast-outline" as const },
];

const DOC_LABELS: Record<RequiredDocKey, string> = {
  aadhaar_front: "Aadhaar Card (Front)",
  aadhaar_back: "Aadhaar Card (Back)",
  pan_front: "PAN Card (Front)",
  pan_back: "PAN Card (Back)",
  driving_license_front: "Driving License (Front)",
  driving_license_back: "Driving License (Back)",
  vehicle_registration: "Vehicle Registration (RC)",
  vehicle_photo_front: "Vehicle Photo (Front)",
  vehicle_photo_side: "Vehicle Photo (Side)",
  vehicle_photo_rear: "Vehicle Photo (Rear)",
};

export default function PendingVerificationScreen() {
  const router = useRouter();
  // The gate hook is already the single source of truth for profile/doc
  // state — it fetches on mount, on every screen focus, and every 30s. This
  // screen used to run a second, fully independent profile+docs fetch of its
  // own (plus its own separate 10s poll) on top of that, which meant every
  // visit — especially now that the nav bar makes jumping between
  // Details/Status/Documents common — fired 2x the network round-trips it
  // needed to, which is what made navigating between these screens feel slow.
  // Consolidated onto the hook's own `refresh`/`verified` so there's exactly
  // one fetch path, driven by exactly one 30s poll plus Realtime.
  const { checking, profile, documents, documentsUploaded, verified, refresh } =
    useRiderVerificationGate("require-pending");
  const [refreshing, setRefreshing] = useState(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const hasSubmittedDocs = documentsUploaded;

  const checkApprovalNow = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      await refresh();
    } catch {
      if (!silent) Alert.alert("Could not refresh", "Check your connection and try again.");
    } finally {
      if (!silent) setRefreshing(false);
    }
  }, [refresh]);

  // Deliberately no auto-redirect to /documents when docs are incomplete —
  // this screen must stay freely reachable via the back button while docs
  // are still in progress (the rider tapped back from /documents on
  // purpose). The one-time "Account Verified" alert below is the only
  // navigation this screen ever triggers on its own.
  const verifiedAlertShownRef = useRef(false);
  useEffect(() => {
    if (verified && !verifiedAlertShownRef.current) {
      verifiedAlertShownRef.current = true;
      Alert.alert(
        "Account Verified",
        "Your documents have been approved. You can now use the app and go online for deliveries.",
        [{ text: "Continue", onPress: () => router.replace("/(tabs)/home") }]
      );
    }
  }, [verified, router]);

  // Realtime: near-instant notice the moment an admin approves this rider,
  // via the narrowly-scoped Supabase Auth bridge session the backend mints
  // at login/signup solely so Realtime's RLS check (auth.uid()) has
  // something real to evaluate for this rider's own row — see
  // riderAuthBridge.service.ts / partner_own_record RLS policy. Absent
  // session.supabaseSession just means the mint failed server-side; the
  // gate hook's own 30s poll still covers that case.
  useEffect(() => {
    let cancelled = false;
    restoreRiderRealtimeSession(supabase).then((driverUserId) => {
      if (cancelled || !driverUserId) return;

      realtimeChannelRef.current = supabase
        .channel(`rider-status:${driverUserId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "delivery_partners",
            filter: `user_id=eq.${driverUserId}`,
          },
          () => {
            void refresh();
          }
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      realtimeChannelRef.current?.unsubscribe();
      realtimeChannelRef.current = null;
    };
  }, [refresh]);

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

  if (checking) {
    return (
      <SafeAreaView style={styles.safe}>
        <Stack.Screen options={{ animation: "fade" }} />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const currentStep = hasSubmittedDocs ? 1 : 0;
  const status = profile?.status || "pending_verification";
  const isSuspended = status === "suspended" || status === "offboarded";

  const requiredKeys = REQUIRED_DOC_KEYS.filter(
    (key) => key !== "vehicle_registration" || isVehicleRegistrationRequired(profile?.vehicle_type)
  );
  const uploadedCount = documents.filter((d) => requiredKeys.includes(d.doc_type) && !!d.url).length;
  const docsComplete = uploadedCount >= requiredKeys.length;
  const rejectedDocs = documents.filter((d) => requiredKeys.includes(d.doc_type) && d.status === "rejected");

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ animation: "fade" }} />
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: fadeAnim }}>
          <VerificationNavBar active="status" />

          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <MaterialCommunityIcons
                name={isSuspended ? "alert-circle-outline" : "timer-sand"}
                size={34}
                color={isSuspended ? Colors.danger : Colors.accent}
              />
            </View>
            <Text style={styles.heroTitle}>
              {isSuspended ? "Account Restricted" : "Verification Pending"}
            </Text>
            <Text style={styles.heroSub}>
              {isSuspended
                ? "Your account is not active. Contact support for assistance."
                : "You can access deliveries only after our team verifies your documents."}
            </Text>
          </View>

          {profile?.name ? (
            <View style={styles.nameCard}>
              <MaterialCommunityIcons name="account-circle-outline" size={22} color={Colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.nameText}>{profile.name}</Text>
                <Text style={styles.nameMeta}>
                  {isSuspended ? "Not allowed to go online" : "Not verified yet"}
                </Text>
              </View>
            </View>
          ) : null}

          {!isSuspended && (
            <>
              <View style={styles.stepsCard}>
                <Text style={styles.sectionTitle}>What happens next</Text>
                {STEPS.map((step, index) => {
                  const done = index < currentStep;
                  const active = index === currentStep;
                  return (
                    <View key={step.key} style={styles.stepRow}>
                      <View
                        style={[
                          styles.stepDot,
                          done && styles.stepDotDone,
                          active && styles.stepDotActive,
                        ]}
                      >
                        <MaterialCommunityIcons
                          name={done ? "check" : step.icon}
                          size={14}
                          color={done ? "#fff" : active ? Colors.accent : Colors.textMuted}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>
                          {step.label}
                        </Text>
                        {active && step.key === "upload" && (
                          <Text style={styles.stepHint}>
                            Upload Aadhaar, PAN, Driving License and vehicle details
                          </Text>
                        )}
                        {active && step.key === "review" && (
                          <Text style={styles.stepHint}>
                            Our admins are reviewing your submission
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>

              <View style={styles.docsCard}>
                <View style={styles.docsHeader}>
                  <Text style={styles.sectionTitle}>Required documents</Text>
                  <View style={[styles.countBadge, docsComplete && styles.countBadgeDone]}>
                    <Text style={[styles.countText, docsComplete && styles.countTextDone]}>
                      {uploadedCount}/{requiredKeys.length}
                    </Text>
                  </View>
                </View>
                <Text style={styles.docsDesc}>
                  Upload Aadhaar (front &amp; back), PAN (front &amp; back), Driving License (front &amp; back), and Vehicle Registration — Vehicle Registration isn&apos;t required for cycles or e-bikes.
                </Text>

                {rejectedDocs.map((doc) => (
                  <View key={doc.doc_type} style={styles.rejectionRow}>
                    <MaterialCommunityIcons name="close-circle" size={15} color={Colors.danger} />
                    <Text style={styles.rejectionRowText}>
                      {DOC_LABELS[doc.doc_type]} needs to be re-uploaded
                      {doc.rejection_reason ? ` — ${doc.rejection_reason}` : ""}
                    </Text>
                  </View>
                ))}

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => router.push("/documents")}
                  activeOpacity={0.85}
                >
                  <MaterialCommunityIcons name="cloud-upload-outline" size={18} color="#fff" />
                  <Text style={styles.primaryBtnText}>
                    {docsComplete ? "Review Uploaded Documents" : "Upload Documents"}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <TouchableOpacity
            style={[styles.secondaryBtn, refreshing && { opacity: 0.6 }]}
            onPress={() => checkApprovalNow(false)}
            disabled={refreshing}
            activeOpacity={0.85}
          >
            {refreshing ? (
              <ActivityIndicator color={Colors.accent} />
            ) : (
              <>
                <MaterialCommunityIcons name="refresh" size={18} color={Colors.accent} />
                <Text style={styles.secondaryBtnText}>Check Verification Status</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.linkBtnText}>Need help? Contact an admin:</Text>
          {ADMIN_CONTACTS.map((admin) => (
            <TouchableOpacity
              key={admin.phone}
              style={styles.linkBtn}
              onPress={() => Linking.openURL(`tel:${admin.phone}`)}
              activeOpacity={0.7}
            >
              <Text style={styles.linkBtnText}>
                {admin.name} — {formatPhoneForDisplay(admin.phone)}
              </Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
            <MaterialCommunityIcons name="logout" size={18} color={Colors.danger} />
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </Animated.View>
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
  },
  hero: { alignItems: "center", marginBottom: Spacing.xl, paddingTop: Spacing.md },
  heroIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  heroTitle: { color: Colors.text, fontSize: 24, fontWeight: "800" },
  heroSub: {
    color: Colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  nameCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  nameText: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  nameMeta: { color: Colors.warning, fontSize: 12, fontWeight: "600", marginTop: 2 },
  stepsCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  sectionTitle: { color: Colors.text, fontSize: 15, fontWeight: "700", marginBottom: Spacing.md },
  stepRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  stepDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDotActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent + "55" },
  stepDotDone: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  stepLabel: { color: Colors.textSecondary, fontSize: 14, fontWeight: "600" },
  stepLabelActive: { color: Colors.text, fontWeight: "700" },
  stepHint: { color: Colors.textMuted, fontSize: 12, marginTop: 2, lineHeight: 17 },
  docsCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  docsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  countBadge: {
    backgroundColor: Colors.warning + "22",
    borderRadius: BorderRadius.round,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  countBadgeDone: { backgroundColor: Colors.success + "22" },
  countText: { color: Colors.warning, fontSize: 12, fontWeight: "700" },
  countTextDone: { color: Colors.success },
  docsDesc: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: Spacing.lg,
  },
  rejectionRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: Colors.dangerLight,
    borderWidth: 1,
    borderColor: Colors.danger + "30",
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  rejectionRowText: { color: Colors.danger, fontSize: 12, fontWeight: "600", flex: 1, lineHeight: 16 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.lg,
    paddingVertical: 15,
  },
  primaryBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.accent + "30",
    paddingVertical: 14,
    marginBottom: Spacing.md,
  },
  secondaryBtnText: { color: Colors.accent, fontSize: 14, fontWeight: "700" },
  linkBtn: { alignItems: "center", paddingVertical: Spacing.sm, marginBottom: Spacing.sm },
  linkBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    borderWidth: 1.5,
    borderColor: Colors.danger + "35",
    borderRadius: BorderRadius.lg,
    paddingVertical: 14,
    backgroundColor: Colors.dangerLight,
  },
  logoutText: { color: Colors.danger, fontSize: 15, fontWeight: "700" },
});

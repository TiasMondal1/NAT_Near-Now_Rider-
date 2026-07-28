import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { getSession } from "../session";

// Same conditional-require pattern as _layout.tsx: expo-notifications is
// unsupported in Expo Go (SDK 53+) and must never be statically imported.
const isExpoGo = Constants.executionEnvironment === "storeClient";
let Notifications: typeof import("expo-notifications") | null = null;
if (!isExpoGo) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  Notifications = require("expo-notifications");
}

interface Preferences {
  newOrders: boolean;
  profileUpdates: boolean;
}

const DEFAULT_PREFERENCES: Preferences = { newOrders: true, profileUpdates: true };

export default function NotificationPreferencesScreen() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const load = useCallback(async () => {
    const session = await getSession();
    if (!session?.token) return;
    setToken(session.token);

    if (Notifications) {
      const { status } = await Notifications.getPermissionsAsync();
      setPermissionGranted(status === "granted");
    }

    try {
      const data = await apiFetch<{ success: boolean; preferences: Preferences }>(
        "/delivery-partner/notifications/preferences",
        {},
        session.token
      );
      if (data.success) setPrefs({ ...DEFAULT_PREFERENCES, ...data.preferences });
    } catch {
      // keep defaults — mobile still lets the rider set preferences locally
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh permission status whenever this screen regains focus — e.g. the
  // rider backed out to Settings via the "Open Settings" alert below and
  // toggled the OS permission there, then returned via the back button.
  useFocusEffect(
    useCallback(() => {
      if (!Notifications) return;
      Notifications.getPermissionsAsync().then(({ status }) => {
        setPermissionGranted(status === "granted");
      });
    }, [])
  );

  const toggle = useCallback(
    (key: keyof Preferences) => {
      if (!token) return;
      setPrefs((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        apiFetch("/delivery-partner/notifications/preferences", { method: "POST", body: next }, token).catch(() => {});
        return next;
      });
    },
    [token]
  );

  const requestPermission = useCallback(async () => {
    if (!Notifications) return;
    const existing = await Notifications.getPermissionsAsync();

    // Once the OS has recorded a prior denial (e.g. the auto-prompt in
    // _layout.tsx that fires right after login), it will never show the
    // request dialog again — requestPermissionsAsync() just silently
    // resolves with the same denied status, making this button look like
    // it does nothing. canAskAgain tells us which case we're in.
    if (existing.status !== "granted" && existing.canAskAgain === false) {
      Alert.alert(
        "Notifications disabled",
        "Notifications for this app are turned off at the device level. Open Settings to enable them.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }

    let finalStatus = existing.status;
    if (existing.status !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus === "granted") {
      setPermissionGranted(true);
    } else {
      Alert.alert(
        "Notifications disabled",
        "Enable notifications for this app in your device settings to receive order and update alerts.",
        [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Notification Preferences</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <MaterialCommunityIcons
                name={permissionGranted ? "bell-check-outline" : "bell-off-outline"}
                size={22}
                color={permissionGranted ? Colors.accent : Colors.textMuted}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.statusTitle}>
                  Notifications are {permissionGranted ? "on" : "off"}
                </Text>
                <Text style={styles.statusSubtext}>
                  {permissionGranted
                    ? "You'll be alerted about new orders and updates."
                    : "Turn on notifications to get order alerts."}
                </Text>
              </View>
              {!permissionGranted && (
                <TouchableOpacity style={styles.enableBtn} onPress={requestPermission}>
                  <Text style={styles.enableBtnText}>Enable</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <PrefRow
              icon="truck-fast-outline"
              title="New order requests"
              subtitle="Nearby delivery offers while you're online"
              value={prefs.newOrders}
              disabled={!permissionGranted}
              onToggle={() => toggle("newOrders")}
            />
            <View style={styles.divider} />
            <PrefRow
              icon="account-check-outline"
              title="Profile & document updates"
              subtitle="Approval status of profile or document changes"
              value={prefs.profileUpdates}
              disabled={!permissionGranted}
              onToggle={() => toggle("profileUpdates")}
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function PrefRow({
  icon,
  title,
  subtitle,
  value,
  disabled,
  onToggle,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
  value: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={styles.prefRow}>
      <MaterialCommunityIcons name={icon} size={20} color={Colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.prefTitle}>{title}</Text>
        <Text style={styles.prefSubtitle}>{subtitle}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: Colors.borderLight, true: Colors.accentLight }}
        thumbColor={value ? Colors.accent : Platform.OS === "android" ? Colors.surface : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, borderRadius: BorderRadius.md, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "700", color: Colors.text },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  body: { padding: Spacing.lg, gap: Spacing.md },

  statusCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  statusTitle: { fontSize: 14, fontWeight: "700", color: Colors.text },
  statusSubtext: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  enableBtn: {
    backgroundColor: Colors.accent,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
  },
  enableBtnText: { color: Colors.accentText, fontSize: 13, fontWeight: "700" },

  card: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: Spacing.md + 20 + Spacing.sm },
  prefRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  prefTitle: { fontSize: 14, fontWeight: "600", color: Colors.text },
  prefSubtitle: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
});

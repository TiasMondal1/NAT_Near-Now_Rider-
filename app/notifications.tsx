import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { apiFetch } from "../constants/api";
import { getSession } from "../session";

interface AppNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = useCallback(async (authToken: string, isRefresh = false) => {
    try {
      if (!isRefresh) setLoading(true);
      const data = await apiFetch<AppNotification[]>("/delivery-partner/notifications", {}, authToken);
      setNotifications(Array.isArray(data) ? data : []);
    } catch {
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) return;
      setToken(session.token);
      fetchNotifications(session.token);
    })();
  }, [fetchNotifications]);

  const onRefresh = useCallback(async () => {
    if (!token) return;
    setRefreshing(true);
    await fetchNotifications(token, true);
    setRefreshing(false);
  }, [token, fetchNotifications]);

  const markAllRead = useCallback(async () => {
    if (!token) return;
    // Snapshot before the optimistic update so a failed PUT can be reverted
    // instead of leaving this screen permanently out of sync with the real
    // server state (e.g. Home's bell badge, which always refetches fresh).
    const previous = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      await apiFetch("/delivery-partner/notifications/read-all", { method: "PUT" }, token);
    } catch {
      setNotifications(previous);
      Alert.alert("Couldn't mark all as read", "Please check your connection and try again.");
    }
  }, [token, notifications]);

  const markOneRead = useCallback(
    async (id: string) => {
      if (!token) return;
      const previous = notifications;
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      try {
        await apiFetch(`/delivery-partner/notifications/${id}/read`, { method: "PUT" }, token);
      } catch {
        setNotifications(previous);
        Alert.alert("Couldn't mark as read", "Please check your connection and try again.");
      }
    },
    [token, notifications]
  );

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Notifications</Text>
        {unreadCount > 0 ? (
          <TouchableOpacity onPress={markAllRead}>
            <Text style={styles.markAll}>Mark all read</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <MaterialCommunityIcons name="bell-outline" size={48} color={Colors.textMuted} />
              <Text style={styles.emptyTitle}>No notifications yet</Text>
              <Text style={styles.emptyText}>New order alerts will appear here</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, !item.is_read && styles.cardUnread]}
              activeOpacity={0.7}
              onPress={() => markOneRead(item.id)}
            >
              <View style={styles.iconWrap}>
                <MaterialCommunityIcons name="truck-fast-outline" size={18} color={Colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.cardHeaderRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
                  {!item.is_read && <View style={styles.dot} />}
                </View>
                <Text style={styles.cardMessage} numberOfLines={2}>{item.message}</Text>
                <Text style={styles.cardTime}>{timeAgo(item.created_at)}</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
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
  markAll: { fontSize: 13, fontWeight: "600", color: Colors.accent },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  list: { padding: Spacing.lg, paddingBottom: 60, gap: Spacing.sm },

  card: {
    flexDirection: "row",
    gap: Spacing.md,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  cardUnread: { backgroundColor: Colors.surface },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: Colors.text, flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.accent },
  cardMessage: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  cardTime: { fontSize: 11, color: Colors.textMuted, marginTop: 6 },

  empty: { marginTop: 80, alignItems: "center", gap: 10, padding: 32 },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: Colors.text },
  emptyText: { fontSize: 13, color: Colors.textMuted, textAlign: "center" },
});

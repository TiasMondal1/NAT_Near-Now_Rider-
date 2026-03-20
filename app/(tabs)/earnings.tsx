import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../../constants/theme";
import { apiFetch } from "../../constants/api";
import { getSession } from "../../session";

type Order = {
  id: string;
  order_code: string;
  status: string;
  total_amount: number;
  delivery_address: string;
  placed_at: string;
  stores?: { name: string } | null;
};

export default function EarningsScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [token, setToken] = useState("");

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
      if (session?.token) setToken(session.token);
    })();
  }, []);

  const fetchCompleted = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ success: boolean; orders: Order[] }>(
        "/delivery-partner/orders?status=completed",
        {},
        token
      );
      if (res.success) setOrders(res.orders);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  useEffect(() => {
    if (token) fetchCompleted();
  }, [token, fetchCompleted]);

  const todayStr = new Date().toDateString();
  const todayOrders = orders.filter(
    (o) => new Date(o.placed_at).toDateString() === todayStr
  );
  const todayEarnings = todayOrders.reduce(
    (sum, o) => sum + (Number(o.total_amount) * 0.15),
    0
  );
  const totalEarnings = orders.reduce(
    (sum, o) => sum + (Number(o.total_amount) * 0.15),
    0
  );

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={styles.header}>Earnings</Text>

        <View style={styles.statsRow}>
          <View style={[styles.statCard, styles.todayCard]}>
            <View style={styles.statIconWrap}>
              <MaterialCommunityIcons name="calendar-today" size={20} color={Colors.accent} />
            </View>
            <Text style={styles.statLabel}>TODAY</Text>
            <Text style={styles.statValue}>
              {"\u20B9"}{todayEarnings.toFixed(0)}
            </Text>
            <Text style={styles.statSub}>{todayOrders.length} deliveries</Text>
          </View>
          <View style={styles.statCard}>
            <View style={styles.statIconWrap}>
              <MaterialCommunityIcons name="wallet-outline" size={20} color={Colors.accent} />
            </View>
            <Text style={styles.statLabel}>TOTAL</Text>
            <Text style={styles.statValue}>
              {"\u20B9"}{totalEarnings.toFixed(0)}
            </Text>
            <Text style={styles.statSub}>{orders.length} deliveries</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Completed Deliveries</Text>
      </Animated.View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchCompleted();
            }}
            tintColor={Colors.accent}
          />
        }
        renderItem={({ item }) => (
          <Animated.View style={{ opacity: fadeAnim }}>
            <View style={styles.card}>
              <View style={styles.cardRow}>
                <View style={styles.cardIconWrap}>
                  <MaterialCommunityIcons name="check-circle" size={18} color={Colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.orderCode}>#{item.order_code || "---"}</Text>
                  <Text style={styles.storeName}>
                    {item.stores?.name || "Store"}
                  </Text>
                </View>
                <View style={styles.earningWrap}>
                  <Text style={styles.earning}>
                    +{"\u20B9"}{(Number(item.total_amount) * 0.15).toFixed(0)}
                  </Text>
                </View>
              </View>
              <Text style={styles.date}>{formatDate(item.placed_at)}</Text>
            </View>
          </Animated.View>
        )}
        ListEmptyComponent={
          <View style={styles.centered}>
            <View style={styles.emptyIconWrap}>
              <MaterialCommunityIcons
                name="cash-remove"
                size={40}
                color={Colors.accent}
              />
            </View>
            <Text style={styles.emptyText}>No earnings yet</Text>
            <Text style={styles.emptySub}>
              Complete deliveries to start earning
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    backgroundColor: Colors.bg,
  },
  header: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
  },
  statsRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  todayCard: {
    borderColor: Colors.accentLight,
    backgroundColor: Colors.accentLight,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  statLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.5,
    marginBottom: Spacing.xs,
  },
  statValue: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  statSub: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  sectionTitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    textTransform: "uppercase",
  },
  list: {
    padding: Spacing.lg,
    paddingTop: 0,
    gap: Spacing.sm,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 1,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: 4,
  },
  cardIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.successLight,
    alignItems: "center",
    justifyContent: "center",
  },
  orderCode: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  storeName: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 1,
  },
  earningWrap: {
    backgroundColor: Colors.successLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  earning: {
    color: Colors.success,
    fontSize: 16,
    fontWeight: "700",
  },
  date: {
    color: Colors.textMuted,
    fontSize: 12,
    paddingLeft: 46,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  emptyText: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  emptySub: {
    color: Colors.textMuted,
    fontSize: 13,
    marginTop: 4,
  },
});

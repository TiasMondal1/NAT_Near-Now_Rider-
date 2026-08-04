import { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Animated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../../constants/theme";
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
  /** Real payout amount for this order (flat fee + tip), from delivery_partners_payouts.
   * null for orders delivered before this was wired up — no payout row exists for those. */
  payout_amount: number | null;
};

/** Real earnings for this order, or 0 if no payout row exists yet (pre-fix orders). */
const orderEarning = (o: Order) => o.payout_amount ?? 0;

type Period = "today" | "week" | "all";

export default function EarningsScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [token, setToken] = useState("");
  const [period, setPeriod] = useState<Period>("today");

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

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
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
    setLoading(false);
    setRefreshing(false);
  }, [token]);

  useEffect(() => {
    if (token) fetchCompleted();
  }, [token, fetchCompleted]);

  useFocusEffect(
    useCallback(() => {
      if (token) fetchCompleted();
    }, [token, fetchCompleted])
  );

  const now = new Date();
  const todayStr = now.toDateString();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const todayOrders = orders.filter(
    (o) => new Date(o.placed_at).toDateString() === todayStr
  );
  const weekOrders = orders.filter(
    (o) => new Date(o.placed_at) >= weekAgo
  );

  const todayEarnings = todayOrders.reduce((sum, o) => sum + orderEarning(o), 0);
  const weekEarnings = weekOrders.reduce((sum, o) => sum + orderEarning(o), 0);
  const totalEarnings = orders.reduce((sum, o) => sum + orderEarning(o), 0);

  const filteredOrders = period === "today" ? todayOrders : period === "week" ? weekOrders : orders;
  const filteredEarnings = period === "today" ? todayEarnings : period === "week" ? weekEarnings : totalEarnings;

  // Orders with no payout row (pre-payout-fix deliveries) contribute ₹0 to
  // filteredEarnings but shouldn't count toward the average's divisor — doing
  // so silently drags "Avg ₹/delivery" down and could look like underpayment
  // for deliveries that simply predate payout tracking.
  const payoutKnownOrders = filteredOrders.filter((o) => o.payout_amount != null);
  const legacyOrderCount = filteredOrders.length - payoutKnownOrders.length;

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
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.responsiveWrap}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <Text style={styles.header}>Earnings</Text>

        {loadError && orders.length > 0 && (
          <View style={styles.staleBanner}>
            <MaterialCommunityIcons name="wifi-alert" size={14} color={Colors.warning} />
            <Text style={styles.staleBannerText}>Connection issue — figures may be outdated</Text>
          </View>
        )}

        <View style={styles.periodRow}>
          {(["today", "week", "all"] as const).map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodTab, period === p && styles.periodTabActive]}
              onPress={() => setPeriod(p)}
            >
              <Text style={[styles.periodTabText, period === p && styles.periodTabTextActive]}>
                {p === "today" ? "Today" : p === "week" ? "This Week" : "All Time"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <View style={styles.summaryIconWrap}>
              <MaterialCommunityIcons name="wallet" size={24} color={Colors.accent} />
            </View>
            <View>
              <Text style={styles.summaryLabel}>
                {period === "today" ? "Today's Earnings" : period === "week" ? "This Week" : "Total Earnings"}
              </Text>
              <Text style={styles.summaryValue}>{"\u20B9"}{filteredEarnings.toFixed(0)}</Text>
            </View>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryBottom}>
            <View style={styles.summaryMeta}>
              <MaterialCommunityIcons name="package-variant-closed" size={16} color={Colors.textMuted} />
              <Text style={styles.summaryMetaText}>{filteredOrders.length} deliveries</Text>
            </View>
            {payoutKnownOrders.length > 0 && (
              <View style={styles.summaryMeta}>
                <MaterialCommunityIcons name="trending-up" size={16} color={Colors.success} />
                <Text style={[styles.summaryMetaText, { color: Colors.success }]}>
                  Avg {"\u20B9"}{(filteredEarnings / payoutKnownOrders.length).toFixed(0)}/delivery
                </Text>
              </View>
            )}
          </View>
          {legacyOrderCount > 0 && (
            <Text style={styles.legacyNote}>
              {legacyOrderCount} {legacyOrderCount === 1 ? "delivery" : "deliveries"} shown as {"\u20B9"}0 \u2014 payout data unavailable for {legacyOrderCount === 1 ? "it" : "them"}, excluded from the average.
            </Text>
          )}
        </View>

        <View style={styles.quickStatsRow}>
          <View style={[styles.quickStat, { backgroundColor: Colors.accentLight }]}>
            <Text style={[styles.quickStatValue, { color: Colors.accent }]}>{todayOrders.length}</Text>
            <Text style={styles.quickStatLabel}>Today</Text>
          </View>
          <View style={[styles.quickStat, { backgroundColor: Colors.warningLight }]}>
            <Text style={[styles.quickStatValue, { color: Colors.warning }]}>{weekOrders.length}</Text>
            <Text style={styles.quickStatLabel}>This Week</Text>
          </View>
          <View style={[styles.quickStat, { backgroundColor: Colors.successLight }]}>
            <Text style={[styles.quickStatValue, { color: Colors.success }]}>{orders.length}</Text>
            <Text style={styles.quickStatLabel}>Total</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Delivery History</Text>
      </Animated.View>

      <FlatList
        data={filteredOrders}
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
                    {item.payout_amount != null ? `+${"\u20B9"}${item.payout_amount.toFixed(0)}` : "\u2014"}
                  </Text>
                </View>
              </View>
              <View style={styles.cardDateRow}>
                <MaterialCommunityIcons name="clock-outline" size={12} color={Colors.textMuted} />
                <Text style={styles.date}>{formatDate(item.placed_at)}</Text>
              </View>
            </View>
          </Animated.View>
        )}
        ListEmptyComponent={
          loadError ? (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconWrap, { backgroundColor: Colors.warningLight }]}>
                <MaterialCommunityIcons name="wifi-alert" size={40} color={Colors.warning} />
              </View>
              <Text style={styles.emptyText}>Couldn&apos;t load earnings</Text>
              <Text style={styles.emptySub}>Check your connection and try again.</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={() => fetchCompleted()}>
                <Text style={styles.retryBtnText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons
                  name="cash-remove"
                  size={40}
                  color={Colors.accent}
                />
              </View>
              <Text style={styles.emptyText}>
                {period === "today" ? "No earnings today" : period === "week" ? "No earnings this week" : "No earnings yet"}
              </Text>
              <Text style={styles.emptySub}>
                Complete deliveries to start earning
              </Text>
            </View>
          )
        }
      />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  responsiveWrap: { flex: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },
  safe: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.bg,
  },
  header: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.warningLight,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: BorderRadius.md,
  },
  staleBannerText: { color: Colors.warning, fontSize: 12, fontWeight: "600", flex: 1 },

  periodRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    alignItems: "center",
  },
  periodTabActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  periodTabText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  periodTabTextActive: {
    color: Colors.accentText,
  },

  summaryCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.accent + "25",
    marginBottom: Spacing.md,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  summaryIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  summaryValue: {
    color: Colors.text,
    fontSize: 32,
    fontWeight: "800",
  },
  summaryDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },
  summaryBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  summaryMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  summaryMetaText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: "500",
  },
  legacyNote: {
    color: Colors.textMuted,
    fontSize: 11,
    marginTop: Spacing.sm,
    lineHeight: 15,
  },

  quickStatsRow: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  quickStat: {
    flex: 1,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  quickStatValue: {
    fontSize: 22,
    fontWeight: "800",
  },
  quickStatLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
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
    marginBottom: 6,
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
  cardDateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 46,
  },
  date: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 60,
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
  retryBtn: {
    marginTop: Spacing.md,
    backgroundColor: Colors.warning,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  retryBtnText: { color: "#fff", fontWeight: "600" },
});

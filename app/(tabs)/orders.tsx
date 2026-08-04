import { useState, useEffect, useCallback, useRef, memo } from "react";
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
import { useRouter, useFocusEffect } from "expo-router";
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
  order_items?: { product_name: string; quantity: number }[];
};

// Must mirror mapDbStatusToRider() in backend/src/controllers/deliveryPartner.controller.ts —
// that function only ever returns rider_assigned/picking_up/picked_up/completed
// (or a raw, unmapped DB status as a last-resort fallback). en_route_delivery
// was never actually emitted; picking_up/picked_up were missing here entirely
// and fell through to the generic default below, showing the raw status
// string with an unstyled help-circle icon.
const STATUS_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  rider_assigned: { label: "Pickup", icon: "store", color: Colors.accent, bg: Colors.accentLight },
  picking_up: { label: "Picking Up", icon: "moped", color: Colors.warning, bg: Colors.warningLight },
  picked_up: { label: "Delivering", icon: "truck-delivery", color: Colors.warning, bg: Colors.warningLight },
  completed: { label: "Delivered", icon: "check-circle", color: Colors.success, bg: Colors.successLight },
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const OrderCard = memo(function OrderCard({ item, onPress }: { item: Order; onPress: () => void }) {
  const config = STATUS_CONFIG[item.status] || {
    label: item.status, icon: "help-circle", color: Colors.textMuted, bg: Colors.surfaceLight,
  };
  const itemCount = item.order_items?.length || 0;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.cardTop}>
        <View style={[styles.cardIconWrap, { backgroundColor: config.bg }]}>
          <MaterialCommunityIcons name={config.icon as any} size={20} color={config.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.orderCode}>#{item.order_code || "---"}</Text>
          <Text style={styles.storeName}>{item.stores?.name || "Store"}</Text>
        </View>
        <View style={styles.amountWrap}>
          <Text style={styles.amountText}>{"₹"}{item.total_amount}</Text>
        </View>
      </View>

      <View style={styles.cardMid}>
        <MaterialCommunityIcons name="map-marker-outline" size={14} color={Colors.textMuted} />
        <Text style={styles.address} numberOfLines={1}>{item.delivery_address}</Text>
      </View>

      <View style={styles.cardBottom}>
        <View style={[styles.statusBadge, { borderColor: config.color, backgroundColor: config.bg }]}>
          <Text style={[styles.statusText, { color: config.color }]}>{config.label}</Text>
        </View>
        <View style={styles.metaRow}>
          {itemCount > 0 && (
            <Text style={styles.metaText}>{itemCount} item{itemCount > 1 ? "s" : ""}</Text>
          )}
          <Text style={styles.metaText}>{formatDate(item.placed_at)}</Text>
        </View>
      </View>

      <View style={styles.cardArrow}>
        <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
});

export default function OrdersScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [token, setToken] = useState("");

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

  const fetchOrders = useCallback(
    async (showLoader = false) => {
      if (!token) return;
      if (showLoader) setLoading(true);

      try {
        // Capped — this list has no client-side aggregate depending on
        // completeness (unlike earnings.tsx's lifetime total, left
        // unbounded), so a page cap is safe and bounds payload size for a
        // long-tenured rider's order history.
        const res = await apiFetch<{ success: boolean; orders: Order[]; has_more?: boolean }>(
          `/delivery-partner/orders?status=${tab}&limit=50`,
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
    },
    [token, tab]
  );

  useEffect(() => {
    if (token) fetchOrders(true);
  }, [token, tab, fetchOrders]);

  useFocusEffect(
    useCallback(() => {
      if (token) fetchOrders(false);
    }, [token, fetchOrders])
  );

  const renderOrder = useCallback(({ item }: { item: Order }) => (
    <OrderCard
      item={item}
      onPress={() => router.push({ pathname: "/delivery/[orderId]", params: { orderId: item.id } })}
    />
  ), [router]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.responsiveWrap}>
      <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Orders</Text>
          {orders.length > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{orders.length}</Text>
            </View>
          )}
        </View>

        <View style={styles.tabs}>
          {(["active", "completed"] as const).map((t) => (
            <TouchableOpacity
              key={t}
              style={[styles.tab, tab === t && styles.tabActive]}
              onPress={() => setTab(t)}
            >
              <MaterialCommunityIcons
                name={t === "active" ? "truck-fast-outline" : "clipboard-check-outline"}
                size={16}
                color={tab === t ? Colors.accentText : Colors.textMuted}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
                {t === "active" ? "Active" : "Past"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Animated.View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={Colors.accent} size="large" />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          renderItem={renderOrder}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                fetchOrders();
              }}
              tintColor={Colors.accent}
            />
          }
          ListEmptyComponent={
            loadError ? (
              <View style={styles.centered}>
                <View style={[styles.emptyIconWrap, { backgroundColor: Colors.warningLight }]}>
                  <MaterialCommunityIcons name="wifi-alert" size={40} color={Colors.warning} />
                </View>
                <Text style={styles.emptyTitle}>Couldn&apos;t load orders</Text>
                <Text style={styles.emptySub}>Check your connection and try again.</Text>
                <TouchableOpacity style={styles.retryBtn} onPress={() => fetchOrders(true)}>
                  <Text style={styles.retryBtnText}>Try Again</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.centered}>
                <View style={styles.emptyIconWrap}>
                  <MaterialCommunityIcons
                    name={tab === "active" ? "truck-fast-outline" : "clipboard-check-outline"}
                    size={40}
                    color={Colors.accent}
                  />
                </View>
                <Text style={styles.emptyTitle}>
                  {tab === "active" ? "No active orders" : "No past orders"}
                </Text>
                <Text style={styles.emptySub}>
                  {tab === "active"
                    ? "Go online to start receiving orders"
                    : "Your completed deliveries will appear here"}
                </Text>
              </View>
            )
          }
        />
      )}
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
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  header: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
  },
  countBadge: {
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.round,
    minWidth: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  countBadgeText: {
    color: Colors.accentText,
    fontSize: 13,
    fontWeight: "700",
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  tabActive: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
  },
  tabText: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: "600",
  },
  tabTextActive: {
    color: Colors.accentText,
  },
  list: {
    padding: Spacing.lg,
    paddingTop: 0,
    gap: Spacing.sm,
  },
  card: {
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
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  cardIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  orderCode: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  storeName: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 1,
  },
  amountWrap: {
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  amountText: {
    color: Colors.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  cardMid: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: Spacing.sm,
    paddingLeft: 54,
  },
  address: {
    color: Colors.textMuted,
    fontSize: 13,
    flex: 1,
  },
  cardBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 54,
  },
  statusBadge: {
    borderWidth: 1,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: "600",
  },
  metaRow: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  metaText: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  cardArrow: {
    position: "absolute",
    right: Spacing.md,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 100,
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
  emptyTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: "700",
    marginTop: Spacing.sm,
  },
  emptySub: {
    color: Colors.textMuted,
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
    paddingHorizontal: Spacing.xl,
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

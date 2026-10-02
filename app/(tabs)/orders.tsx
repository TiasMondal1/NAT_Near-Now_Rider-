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
import { ORDERS_PAGE_SIZE, appendPage, mergeFirstPage } from "../../lib/orderPaging";

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
  // Paging (2026-10-02): the list used to stop at the newest 50 with no way
  // to reach older deliveries, although the server reports has_more.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;
  // Bumped by every first-page load (tab change, focus, pull-to-refresh). A
  // response — first page or older page — from an earlier generation is
  // dropped, so a slow request can't overwrite a newer list or append a
  // page from the other tab.
  const requestSeqRef = useRef(0);
  const loadingMoreRef = useRef(false);

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
      if (session?.token) {
        setToken(session.token);
      } else {
        // getSession() can transiently return null on a SecureStore read
        // glitch even with a valid session cached elsewhere — without this,
        // `token` never gets set, fetchOrders() (the only place that flips
        // `loading` to false) never runs, and this screen spins forever.
        // Found 2026-08-26 during a crash-risk audit.
        setLoading(false);
      }
    })();
  }, []);

  /**
   * Loads the newest page. `keepOlderPages` (focus refresh): on the Past tab,
   * merge it into what's already loaded instead of dropping the older pages
   * the rider paged to — opening an old delivery and coming back used to
   * reset the list to the newest 50. Tab change, pull-to-refresh and retry
   * start over from the newest page.
   */
  const fetchOrders = useCallback(
    async (showLoader = false, keepOlderPages = false) => {
      if (!token) return;
      const seq = ++requestSeqRef.current;
      if (showLoader) setLoading(true);

      try {
        // Paged — this list has no client-side aggregate depending on
        // completeness (unlike earnings.tsx's lifetime total, left
        // unbounded), so paging is safe and bounds payload size for a
        // long-tenured rider's order history.
        const res = await apiFetch<{ success: boolean; orders: Order[]; has_more?: boolean }>(
          `/delivery-partner/orders?status=${tab}&limit=${ORDERS_PAGE_SIZE}`,
          {},
          token
        );
        if (seq !== requestSeqRef.current) return;
        if (res.success) {
          const merge = keepOlderPages && tab === "completed" && ordersRef.current.length > ORDERS_PAGE_SIZE;
          if (merge) {
            // Older pages stay; whether more exist beyond them is unchanged.
            setOrders((prev) => mergeFirstPage(prev, res.orders));
          } else {
            setOrders(res.orders);
            setHasMore(!!res.has_more);
          }
          setLoadMoreError(false);
        }
        setLoadError(false);
      } catch {
        if (seq !== requestSeqRef.current) return;
        setLoadError(true);
      }

      setLoading(false);
      setRefreshing(false);
    },
    [token, tab]
  );

  /** Fetch the next older page and append it. */
  const loadMore = useCallback(async () => {
    if (!token || !hasMore || loading || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadMoreError(false);
    const seq = requestSeqRef.current;
    try {
      const res = await apiFetch<{ success: boolean; orders: Order[]; has_more?: boolean }>(
        `/delivery-partner/orders?status=${tab}&limit=${ORDERS_PAGE_SIZE}&offset=${ordersRef.current.length}`,
        {},
        token
      );
      if (seq !== requestSeqRef.current) return; // list was reloaded meanwhile
      if (res.success) {
        setOrders((prev) => appendPage(prev, res.orders));
        setHasMore(!!res.has_more);
      }
    } catch {
      if (seq === requestSeqRef.current) setLoadMoreError(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [token, hasMore, loading, tab]);

  useEffect(() => {
    if (token) fetchOrders(true);
  }, [token, tab, fetchOrders]);

  useFocusEffect(
    useCallback(() => {
      if (token) fetchOrders(false, true);
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
              <Text style={styles.countBadgeText}>{orders.length}{hasMore ? "+" : ""}</Text>
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

      {loadError && orders.length > 0 && (
        <View style={styles.staleBanner}>
          <MaterialCommunityIcons name="wifi-alert" size={14} color={Colors.warning} />
          <Text style={styles.staleBannerText}>Connection issue — this list may be outdated</Text>
        </View>
      )}

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
          ListFooterComponent={
            orders.length > 0 && (hasMore || loadMoreError) ? (
              <View style={styles.footer}>
                {loadingMore ? (
                  <ActivityIndicator color={Colors.accent} />
                ) : (
                  <TouchableOpacity
                    style={styles.loadMoreBtn}
                    onPress={loadMore}
                    disabled={loadingMore}
                    accessibilityRole="button"
                    accessibilityLabel={loadMoreError ? "Couldn't load more. Try again" : "Load older deliveries"}
                  >
                    <Text style={styles.loadMoreText}>
                      {loadMoreError ? "Couldn't load more — tap to try again" : "Load older deliveries"}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null
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
  footer: { alignItems: "center", paddingVertical: Spacing.lg },
  loadMoreBtn: {
    paddingVertical: 10,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent,
  },
  loadMoreText: { color: Colors.accent, fontSize: 14, fontWeight: "600" },
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
  staleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.warningLight,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
  },
  staleBannerText: { color: Colors.warning, fontSize: 12, fontWeight: "600", flex: 1 },
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

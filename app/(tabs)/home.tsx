import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
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
  stores?: { name: string; address: string; latitude: number; longitude: number } | null;
  order_items?: { product_name: string; quantity: number }[];
};

export default function HomeScreen() {
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeOrders, setActiveOrders] = useState<Order[]>([]);
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
  const [token, setToken] = useState("");
  const [userName, setUserName] = useState("");

  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOnline) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isOnline]);

  useEffect(() => {
    if (pendingOrder) {
      cardAnim.setValue(0);
      Animated.spring(cardAnim, { toValue: 1, tension: 50, friction: 8, useNativeDriver: true }).start();
    }
  }, [pendingOrder?.id]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
  }, []);

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) return;
      setToken(session.token);
      setUserName(session.user?.name || "");

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Location permission is required.");
      }

      try {
        const profileRes = await apiFetch<{ success: boolean; profile: { is_online: boolean } }>(
          "/delivery-partner/profile", {}, session.token
        );
        setIsOnline(profileRes.profile.is_online);
      } catch {}

      setLoading(false);
    })();

    return () => {
      locationSub.current?.remove();
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOnline || !token) {
      locationSub.current?.remove();
      locationSub.current = null;
      return;
    }

    (async () => {
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 50, timeInterval: 10000 },
        async (loc) => {
          try {
            await apiFetch("/delivery-partner/location", {
              method: "POST",
              body: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
            }, token);
          } catch {}
        }
      );
    })();

    return () => { locationSub.current?.remove(); locationSub.current = null; };
  }, [isOnline, token]);

  const fetchOrders = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ success: boolean; orders: Order[] }>(
        "/delivery-partner/orders?status=active", {}, token
      );
      if (res.success) {
        setActiveOrders(res.orders);
        const pending = res.orders.find((o) => o.status === "rider_assigned");
        const inProgress = res.orders.find((o) => o.status === "en_route_delivery");
        setPendingOrder(!inProgress ? pending || null : null);
      }
    } catch {}
  }, [token]);

  const fetchCompleted = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ success: boolean; orders: Order[] }>(
        "/delivery-partner/orders?status=completed", {}, token
      );
      if (res.success) setCompletedOrders(res.orders);
    } catch {}
  }, [token]);

  useEffect(() => {
    if (!isOnline || !token) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    fetchOrders();
    fetchCompleted();
    pollRef.current = setInterval(fetchOrders, 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isOnline, token, fetchOrders, fetchCompleted]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchOrders(), fetchCompleted()]);
    setRefreshing(false);
  };

  const handleToggle = async (value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsOnline(value);
    try {
      await apiFetch("/delivery-partner/status", { method: "PATCH", body: { is_online: value } }, token);
      if (value) {
        fetchOrders();
        fetchCompleted();
      }
    } catch { setIsOnline(!value); }
  };

  const handleAccept = async (orderId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await apiFetch(`/delivery-partner/orders/${orderId}/accept`, { method: "POST" }, token);
      fetchOrders();
    } catch { Alert.alert("Error", "Failed to accept order."); }
  };

  const handleReject = async (orderId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      await apiFetch(`/delivery-partner/orders/${orderId}/reject`, { method: "POST" }, token);
      setPendingOrder(null);
      fetchOrders();
    } catch { Alert.alert("Error", "Failed to reject order."); }
  };

  const activeDelivery = activeOrders.find(
    (o) => o.status === "rider_assigned" || o.status === "en_route_delivery" || o.status === "picked_up"
  );
  const todayStr = new Date().toDateString();
  const todayCompleted = completedOrders.filter(
    (o) => new Date(o.placed_at).toDateString() === todayStr
  );
  const todayEarnings = todayCompleted.reduce(
    (sum, o) => sum + Number(o.total_amount) * 0.15, 0
  );
  const recentOrders = completedOrders.slice(0, 5);

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.greetingSub}>
              {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening"}
            </Text>
            <Text style={styles.greeting}>
              {userName ? userName.split(" ")[0] : "Partner"}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.statusChip}>
              <Animated.View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: isOnline ? Colors.online : Colors.offline,
                    transform: [{ scale: isOnline ? pulseAnim : 1 }],
                  },
                ]}
              />
              <Text style={[styles.statusLabel, { color: isOnline ? Colors.online : Colors.offline }]}>
                {isOnline ? "Online" : "Offline"}
              </Text>
            </View>
            <Switch
              value={isOnline}
              onValueChange={handleToggle}
              trackColor={{ false: Colors.border, true: Colors.accentLight }}
              thumbColor={isOnline ? Colors.accent : Colors.textMuted}
            />
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.accent} />
          }
        >
          <View style={[styles.statusBanner, isOnline ? styles.bannerOnline : styles.bannerOffline]}>
            <View style={[styles.bannerIcon, isOnline ? styles.bannerIconOnline : styles.bannerIconOffline]}>
              <MaterialCommunityIcons
                name={isOnline ? "truck-fast" : "power-standby"}
                size={28}
                color={isOnline ? Colors.accent : Colors.textMuted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>
                {isOnline ? "You're Online" : "You're Offline"}
              </Text>
              <Text style={styles.bannerSubtext}>
                {isOnline
                  ? activeDelivery
                    ? "You have an active delivery"
                    : "Waiting for orders..."
                  : "Go online to receive orders"}
              </Text>
            </View>
            {!isOnline && (
              <TouchableOpacity style={styles.goOnlineBtn} onPress={() => handleToggle(true)} activeOpacity={0.8}>
                <Text style={styles.goOnlineBtnText}>Go Online</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.accentLight }]}>
                <MaterialCommunityIcons name="package-variant-closed" size={20} color={Colors.accent} />
              </View>
              <Text style={styles.statValue}>{todayCompleted.length}</Text>
              <Text style={styles.statLabel}>Deliveries Today</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.successLight }]}>
                <MaterialCommunityIcons name="wallet-outline" size={20} color={Colors.success} />
              </View>
              <Text style={styles.statValue}>{"\u20B9"}{todayEarnings.toFixed(0)}</Text>
              <Text style={styles.statLabel}>Earned Today</Text>
            </View>
          </View>

          {pendingOrder && isOnline && (
            <Animated.View
              style={[
                styles.newOrderCard,
                {
                  opacity: cardAnim,
                  transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [40, 0] }) }],
                },
              ]}
            >
              <View style={styles.newOrderBadge}>
                <MaterialCommunityIcons name="bell-ring" size={12} color={Colors.accentText} />
                <Text style={styles.newOrderBadgeText}>NEW ORDER</Text>
              </View>

              <View style={styles.newOrderHeader}>
                <View style={styles.newOrderStoreIcon}>
                  <MaterialCommunityIcons name="store" size={20} color={Colors.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.newOrderStore} numberOfLines={1}>{pendingOrder.stores?.name || "Store"}</Text>
                  <Text style={styles.newOrderStoreAddr} numberOfLines={1}>{pendingOrder.stores?.address || ""}</Text>
                </View>
                <View style={styles.newOrderAmountWrap}>
                  <Text style={styles.newOrderAmount}>{"\u20B9"}{pendingOrder.total_amount}</Text>
                </View>
              </View>

              <View style={styles.newOrderDivider} />

              <View style={styles.newOrderDetailRow}>
                <MaterialCommunityIcons name="map-marker" size={16} color={Colors.accent} />
                <Text style={styles.newOrderAddress} numberOfLines={2}>{pendingOrder.delivery_address}</Text>
              </View>

              {pendingOrder.order_items && pendingOrder.order_items.length > 0 && (
                <View style={styles.newOrderItemsRow}>
                  <MaterialCommunityIcons name="package-variant" size={14} color={Colors.textMuted} />
                  <Text style={styles.newOrderItems}>
                    {pendingOrder.order_items.length} item{pendingOrder.order_items.length > 1 ? "s" : ""}
                  </Text>
                </View>
              )}

              <View style={styles.newOrderActions}>
                <TouchableOpacity style={styles.declineBtn} onPress={() => handleReject(pendingOrder.id)} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="close" size={20} color={Colors.danger} />
                  <Text style={styles.declineBtnText}>Decline</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.acceptBtn} onPress={() => handleAccept(pendingOrder.id)} activeOpacity={0.7}>
                  <MaterialCommunityIcons name="check" size={20} color={Colors.accentText} />
                  <Text style={styles.acceptBtnText}>Accept</Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          )}

          {activeDelivery && isOnline && !pendingOrder && (
            <TouchableOpacity
              style={styles.activeCard}
              onPress={() => router.push({ pathname: "/delivery/[orderId]", params: { orderId: activeDelivery.id } })}
              activeOpacity={0.7}
            >
              <View style={styles.activeCardInner}>
                <View style={styles.activeProgressRow}>
                  <View style={[styles.progressStep, styles.progressStepDone]}>
                    <MaterialCommunityIcons name="check" size={12} color={Colors.accentText} />
                  </View>
                  <View style={[styles.progressLine, activeDelivery.status === "en_route_delivery" && styles.progressLineDone]} />
                  <View style={[
                    styles.progressStep,
                    (activeDelivery.status === "en_route_delivery" || activeDelivery.status === "picked_up") ? styles.progressStepDone : styles.progressStepPending,
                  ]}>
                    {(activeDelivery.status === "en_route_delivery" || activeDelivery.status === "picked_up")
                      ? <MaterialCommunityIcons name="check" size={12} color={Colors.accentText} />
                      : <Text style={styles.progressStepText}>2</Text>
                    }
                  </View>
                  <View style={styles.progressLine} />
                  <View style={styles.progressStepPending}>
                    <Text style={styles.progressStepText}>3</Text>
                  </View>
                </View>
                <View style={styles.activeProgressLabels}>
                  <Text style={styles.activeProgressLabel}>Accepted</Text>
                  <Text style={styles.activeProgressLabel}>Picked Up</Text>
                  <Text style={styles.activeProgressLabel}>Delivered</Text>
                </View>

                <View style={styles.activeCardDivider} />

                <View style={styles.activeCardRow}>
                  <View style={styles.activeIconWrap}>
                    <MaterialCommunityIcons
                      name={activeDelivery.status === "picked_up" ? "truck-delivery" : "store"}
                      size={22}
                      color={Colors.accent}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeCardTitle}>
                      {activeDelivery.status === "picked_up" ? "Delivering to customer" : "Head to store for pickup"}
                    </Text>
                    <Text style={styles.activeCardSub}>
                      #{activeDelivery.order_code} · {activeDelivery.stores?.name || "Store"} · {"\u20B9"}{activeDelivery.total_amount}
                    </Text>
                  </View>
                  <View style={styles.activeArrow}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.accent} />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {isOnline && !activeDelivery && !pendingOrder && (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons name="map-marker-check" size={40} color={Colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>No orders right now</Text>
              <Text style={styles.emptySub}>We'll notify you when a new order comes in</Text>
            </View>
          )}

          {recentOrders.length > 0 && (
            <View style={styles.recentSection}>
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>Recent Deliveries</Text>
                <TouchableOpacity onPress={() => router.push("/(tabs)/orders")}>
                  <Text style={styles.seeAll}>See All</Text>
                </TouchableOpacity>
              </View>
              {recentOrders.map((order) => (
                <View key={order.id} style={styles.recentCard}>
                  <View style={styles.recentIconWrap}>
                    <MaterialCommunityIcons name="check-circle" size={18} color={Colors.success} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.recentOrderCode}>#{order.order_code || "---"}</Text>
                    <Text style={styles.recentStore}>{order.stores?.name || "Store"}</Text>
                  </View>
                  <View style={styles.recentRight}>
                    <Text style={styles.recentEarning}>+{"\u20B9"}{(Number(order.total_amount) * 0.15).toFixed(0)}</Text>
                    <Text style={styles.recentTime}>{formatTime(order.placed_at)}</Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 20 }} />
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  loadingContainer: { flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" },
  content: { flex: 1 },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.md + 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  greetingSub: { color: Colors.textMuted, fontSize: 13, fontWeight: "500", marginBottom: 2 },
  greeting: { color: Colors.text, fontSize: 22, fontWeight: "800" },
  headerRight: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontWeight: "600" },

  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md },

  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    padding: Spacing.lg,
    borderRadius: BorderRadius.lg,
    gap: Spacing.md,
  },
  bannerOnline: {
    backgroundColor: Colors.accentLight,
    borderWidth: 1,
    borderColor: Colors.accent + "30",
  },
  bannerOffline: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bannerIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerIconOnline: { backgroundColor: Colors.bg },
  bannerIconOffline: { backgroundColor: Colors.surfaceLight },
  bannerTitle: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  bannerSubtext: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  goOnlineBtn: {
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  goOnlineBtnText: { color: Colors.accentText, fontSize: 13, fontWeight: "700" },

  statsRow: { flexDirection: "row", gap: Spacing.sm },
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 2,
  },
  statIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  statValue: { color: Colors.text, fontSize: 24, fontWeight: "800" },
  statLabel: { color: Colors.textMuted, fontSize: 12, fontWeight: "600", marginTop: 4 },

  newOrderCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.xl,
    padding: Spacing.lg,
    borderWidth: 1.5,
    borderColor: Colors.accent + "40",
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 6,
  },
  newOrderBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.accent,
    alignSelf: "flex-start",
    borderRadius: BorderRadius.round,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: Spacing.md,
  },
  newOrderBadgeText: { color: Colors.accentText, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  newOrderHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  newOrderStoreIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
  },
  newOrderStore: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  newOrderStoreAddr: { color: Colors.textMuted, fontSize: 13, marginTop: 1 },
  newOrderAmountWrap: {
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  newOrderAmount: { color: Colors.accent, fontSize: 18, fontWeight: "800" },
  newOrderDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  newOrderDetailRow: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: Spacing.sm },
  newOrderAddress: { color: Colors.textSecondary, fontSize: 14, flex: 1, lineHeight: 20 },
  newOrderItemsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignSelf: "flex-start",
    marginBottom: Spacing.md,
  },
  newOrderItems: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  newOrderActions: { flexDirection: "row", gap: Spacing.sm },
  declineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.dangerLight,
    borderRadius: BorderRadius.md,
    height: 50,
    backgroundColor: Colors.dangerLight,
  },
  declineBtnText: { color: Colors.danger, fontSize: 15, fontWeight: "600" },
  acceptBtn: {
    flex: 1.5,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.md,
    height: 50,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  acceptBtnText: { color: Colors.accentText, fontSize: 15, fontWeight: "700" },

  activeCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.xl,
    borderWidth: 1,
    borderColor: Colors.accent + "30",
    overflow: "hidden",
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 4,
  },
  activeCardInner: { padding: Spacing.lg },
  activeProgressRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 8 },
  progressStep: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  progressStepDone: { backgroundColor: Colors.accent },
  progressStepPending: { backgroundColor: Colors.border },
  progressStepText: { color: Colors.textMuted, fontSize: 11, fontWeight: "700" },
  progressLine: { flex: 1, height: 3, backgroundColor: Colors.border, marginHorizontal: 4, borderRadius: 2 },
  progressLineDone: { backgroundColor: Colors.accent },
  activeProgressLabels: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 },
  activeProgressLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: "600" },
  activeCardDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.md },
  activeCardRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  activeIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
  },
  activeCardTitle: { color: Colors.text, fontSize: 15, fontWeight: "700" },
  activeCardSub: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  activeArrow: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
  },

  emptyState: { alignItems: "center", paddingVertical: Spacing.xl },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.md,
  },
  emptyTitle: { color: Colors.text, fontSize: 17, fontWeight: "700" },
  emptySub: { color: Colors.textMuted, fontSize: 14, marginTop: 6, textAlign: "center" },

  recentSection: { marginTop: Spacing.sm },
  recentHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: Spacing.md },
  recentTitle: { color: Colors.text, fontSize: 18, fontWeight: "700" },
  seeAll: { color: Colors.accent, fontSize: 14, fontWeight: "600" },
  recentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  recentIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.successLight,
    alignItems: "center",
    justifyContent: "center",
  },
  recentOrderCode: { color: Colors.text, fontSize: 14, fontWeight: "700" },
  recentStore: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
  recentRight: { alignItems: "flex-end" },
  recentEarning: { color: Colors.success, fontSize: 14, fontWeight: "700" },
  recentTime: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },
});

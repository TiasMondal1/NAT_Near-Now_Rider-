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

type OfferStore = {
  store_id: string;
  sequence_number: number;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

type Offer = {
  offer_id: string;
  order_id: string;
  order_code: string;
  total_amount: number;
  delivery_address: string;
  customer_lat: number;
  customer_lng: number;
  placed_at: string;
  store_count: number;
  stores: OfferStore[];
};

type ActiveOrder = {
  id: string;
  order_code: string;
  status: string;
  total_amount: number;
  delivery_address: string;
  placed_at: string;
};

function haversineKm(lt1: number, lg1: number, lt2: number, lg2: number) {
  const R = 6371,
    r = (d: number) => (d * Math.PI) / 180;
  const dL = r(lt2 - lt1),
    dG = r(lg2 - lg1);
  const a =
    Math.sin(dL / 2) ** 2 +
    Math.cos(r(lt1)) * Math.cos(r(lt2)) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(d: number) {
  return d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;
}

export default function HomeScreen() {
  const router = useRouter();
  const [isOnline, setIsOnline] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [ignoredOfferIds, setIgnoredOfferIds] = useState<Set<string>>(new Set());
  const [token, setToken] = useState("");
  const [userName, setUserName] = useState("");
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);

  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
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
          "/delivery-partner/profile",
          {},
          session.token
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
          setDriverPos({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          try {
            await apiFetch(
              "/delivery-partner/location",
              {
                method: "POST",
                body: {
                  latitude: loc.coords.latitude,
                  longitude: loc.coords.longitude,
                  heading: loc.coords.heading ?? null,
                  speed: loc.coords.speed ?? null,
                  accuracy: loc.coords.accuracy ?? null,
                },
              },
              token
            );
          } catch {}
        }
      );
    })();

    return () => {
      locationSub.current?.remove();
      locationSub.current = null;
    };
  }, [isOnline, token]);

  const fetchOffers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ success: boolean; offers: Offer[] }>(
        "/delivery-partner/available-orders",
        {},
        token
      );
      if (res.success) {
        setIgnoredOfferIds((prev) => {
          // Prune stale ignored IDs (offers that are no longer in the server list)
          const serverIds = new Set((res.offers || []).map((o) => o.offer_id));
          const pruned = new Set([...prev].filter((id) => serverIds.has(id)));
          return pruned;
        });
        setOffers(res.offers || []);
      }
    } catch {}
  }, [token]);

  const fetchActiveOrder = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ success: boolean; orders: ActiveOrder[] }>(
        "/delivery-partner/orders?status=active",
        {},
        token
      );
      if (res.success) {
        setActiveOrder(res.orders?.[0] ?? null);
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    if (!isOnline || !token) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setOffers([]);
      return;
    }
    fetchOffers();
    fetchActiveOrder();
    pollRef.current = setInterval(() => {
      fetchOffers();
      fetchActiveOrder();
    }, 6000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isOnline, token, fetchOffers, fetchActiveOrder]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchOffers(), fetchActiveOrder()]);
    setRefreshing(false);
  };

  const handleToggle = async (value: boolean) => {
    if (toggling) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsOnline(value);
    setToggling(true);
    try {
      // retries=0: no exponential backoff — toggle should respond instantly or fail fast
      await apiFetch("/delivery-partner/status", { method: "PATCH", body: { is_online: value } }, token, 0);
      if (value) {
        fetchOffers();
        fetchActiveOrder();
      }
    } catch {
      setIsOnline(!value);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setToggling(false);
    }
  };

  const handleAcceptOffer = async (offerId: string) => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setAccepting(offerId);
    try {
      const res = await apiFetch<{ result: string; order_id?: string }>(
        `/delivery-partner/offers/${offerId}/accept`,
        { method: "POST" },
        token
      );
      if (res.result === "accepted" && res.order_id) {
        await fetchActiveOrder();
        setOffers([]);
        router.push({ pathname: "/delivery/[orderId]", params: { orderId: res.order_id } });
      } else if (res.result === "already_taken") {
        Alert.alert("Too slow!", "Another driver accepted this order first.");
        await fetchOffers();
      }
    } catch {
      Alert.alert("Error", "Failed to accept order. Please try again.");
    } finally {
      setAccepting(null);
    }
  };


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
              {new Date().getHours() < 12
                ? "Good morning"
                : new Date().getHours() < 17
                ? "Good afternoon"
                : "Good evening"}
            </Text>
            <Text style={styles.greeting}>
              {userName ? userName.split(" ")[0] : "Partner"}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.statusChip}>
              {toggling ? (
                <ActivityIndicator size="small" color={Colors.textMuted} style={{ width: 8, height: 8 }} />
              ) : (
                <Animated.View
                  style={[
                    styles.statusDot,
                    {
                      backgroundColor: isOnline ? Colors.online : Colors.offline,
                      transform: [{ scale: isOnline ? pulseAnim : 1 }],
                    },
                  ]}
                />
              )}
              <Text style={[styles.statusLabel, { color: toggling ? Colors.textMuted : isOnline ? Colors.online : Colors.offline }]}>
                {toggling ? (isOnline ? "Going online…" : "Going offline…") : isOnline ? "Online" : "Offline"}
              </Text>
            </View>
            <Switch
              value={isOnline}
              onValueChange={handleToggle}
              disabled={toggling}
              trackColor={{ false: Colors.border, true: Colors.accentLight }}
              thumbColor={toggling ? Colors.textMuted : isOnline ? Colors.accent : Colors.textMuted}
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
              <Text style={styles.bannerTitle}>{isOnline ? "You're Online" : "You're Offline"}</Text>
              <Text style={styles.bannerSubtext}>
                {isOnline
                  ? activeOrder
                    ? "You have an active delivery"
                    : offers.length > 0
                    ? `${offers.length} order request${offers.length !== 1 ? "s" : ""} available`
                    : "Waiting for orders..."
                  : "Go online to receive orders"}
              </Text>
            </View>
            {!isOnline && (
              <TouchableOpacity
                style={[styles.goOnlineBtn, toggling && { opacity: 0.5 }]}
                onPress={() => handleToggle(true)}
                disabled={toggling}
                activeOpacity={0.8}
              >
                {toggling ? (
                  <ActivityIndicator size="small" color={Colors.accentText} />
                ) : (
                  <Text style={styles.goOnlineBtnText}>Go Online</Text>
                )}
              </TouchableOpacity>
            )}
          </View>

          {/* Active delivery card */}
          {activeOrder && isOnline && (
            <TouchableOpacity
              style={styles.activeCard}
              onPress={() =>
                router.push({ pathname: "/delivery/[orderId]", params: { orderId: activeOrder.id } })
              }
              activeOpacity={0.7}
            >
              <View style={styles.activeCardInner}>
                <View style={styles.activeCardRow}>
                  <View style={styles.activeIconWrap}>
                    <MaterialCommunityIcons name="truck-delivery" size={22} color={Colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeCardTitle}>Active Delivery</Text>
                    <Text style={styles.activeCardSub}>
                      #{activeOrder.order_code} · ₹{activeOrder.total_amount}
                    </Text>
                  </View>
                  <View style={styles.activeArrow}>
                    <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.accent} />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {/* Offer cards */}
          {isOnline && !activeOrder && offers.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>
                {offers.filter((o) => !ignoredOfferIds.has(o.offer_id)).length} Order Request
                {offers.filter((o) => !ignoredOfferIds.has(o.offer_id)).length !== 1 ? "s" : ""}
              </Text>
              {offers.filter((o) => !ignoredOfferIds.has(o.offer_id)).map((offer) => {
                const firstStore = offer.stores[0];
                const d2store =
                  driverPos && firstStore
                    ? fmtDist(haversineKm(driverPos.lat, driverPos.lng, firstStore.latitude, firstStore.longitude))
                    : null;
                const d2cust =
                  firstStore
                    ? fmtDist(haversineKm(firstStore.latitude, firstStore.longitude, offer.customer_lat, offer.customer_lng))
                    : null;

                return (
                  <View key={offer.offer_id} style={styles.offerCard}>
                    <View style={styles.offerHeader}>
                      <Text style={styles.offerCode}>#{offer.order_code}</Text>
                      <View style={styles.offerStoreBadge}>
                        <Text style={styles.offerStoreBadgeText}>
                          {offer.store_count} store{offer.store_count !== 1 ? "s" : ""}
                        </Text>
                      </View>
                      <Text style={styles.offerAmount}>₹{offer.total_amount}</Text>
                    </View>

                    {(d2store || d2cust) && (
                      <View style={styles.offerDistRow}>
                        {d2store && (
                          <Text style={styles.offerDist}>
                            <MaterialCommunityIcons name="bike" size={12} color={Colors.textMuted} />
                            {" "}{d2store} to store
                          </Text>
                        )}
                        {d2store && d2cust && (
                          <MaterialCommunityIcons name="arrow-right" size={12} color={Colors.textMuted} />
                        )}
                        {d2cust && (
                          <Text style={styles.offerDist}>
                            <MaterialCommunityIcons name="account" size={12} color={Colors.textMuted} />
                            {" "}{d2cust} to customer
                          </Text>
                        )}
                      </View>
                    )}

                    <View style={styles.offerStoreList}>
                      {offer.stores.map((s) => (
                        <View key={s.store_id} style={styles.offerStoreRow}>
                          <View style={styles.offerStoreSeq}>
                            <Text style={styles.offerStoreSeqText}>{s.sequence_number}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.offerStoreName}>{s.name || "Store"}</Text>
                            <Text style={styles.offerStoreAddr} numberOfLines={1}>{s.address}</Text>
                          </View>
                        </View>
                      ))}
                    </View>

                    <View style={styles.offerDropRow}>
                      <MaterialCommunityIcons name="map-marker" size={14} color={Colors.danger} />
                      <Text style={styles.offerDropAddr} numberOfLines={2}>{offer.delivery_address}</Text>
                    </View>

                    <View style={styles.offerActionRow}>
                      <TouchableOpacity
                        style={styles.ignoreBtn}
                        onPress={() => {
                          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setIgnoredOfferIds((prev) => new Set([...prev, offer.offer_id]));
                        }}
                        disabled={!!accepting}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.ignoreBtnText}>Ignore</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.acceptBtn, accepting === offer.offer_id && styles.acceptBtnDisabled]}
                        onPress={() => handleAcceptOffer(offer.offer_id)}
                        disabled={!!accepting}
                        activeOpacity={0.7}
                      >
                        {accepting === offer.offer_id ? (
                          <ActivityIndicator color={Colors.accentText} />
                        ) : (
                          <>
                            <MaterialCommunityIcons name="check" size={18} color={Colors.accentText} />
                            <Text style={styles.acceptBtnText}>Accept</Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.offerTime}>
                      Received {formatTime(offer.placed_at)} · First to accept wins
                    </Text>
                  </View>
                );
              })}
            </>
          )}

          {isOnline && !activeOrder && offers.filter((o) => !ignoredOfferIds.has(o.offer_id)).length === 0 && (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <MaterialCommunityIcons name="map-marker-check" size={40} color={Colors.accent} />
              </View>
              <Text style={styles.emptyTitle}>No orders right now</Text>
              <Text style={styles.emptySub}>New orders appear here automatically</Text>
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
  bannerOnline: { backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: Colors.accent + "30" },
  bannerOffline: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border },
  bannerIcon: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
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

  sectionTitle: { color: Colors.text, fontSize: 18, fontWeight: "700" },

  offerCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.xl,
    borderWidth: 1.5,
    borderColor: Colors.accent + "40",
    padding: Spacing.lg,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
    gap: Spacing.sm,
  },
  offerHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  offerCode: { color: Colors.text, fontSize: 16, fontWeight: "700", flex: 1 },
  offerStoreBadge: {
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  offerStoreBadgeText: { color: Colors.accent, fontSize: 12, fontWeight: "600" },
  offerAmount: { color: Colors.text, fontSize: 16, fontWeight: "800" },
  offerDistRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  offerDist: { color: Colors.textMuted, fontSize: 13 },
  offerStoreList: { gap: 6 },
  offerStoreRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  offerStoreSeq: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
  },
  offerStoreSeqText: { color: Colors.accent, fontSize: 11, fontWeight: "700" },
  offerStoreName: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  offerStoreAddr: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
  offerDropRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.sm,
    padding: Spacing.sm,
  },
  offerDropAddr: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
  offerActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  ignoreBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    height: 50,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  ignoreBtnText: { color: Colors.textMuted, fontSize: 14, fontWeight: "600" },
  acceptBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.md,
    height: 50,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  acceptBtnDisabled: { opacity: 0.6 },
  acceptBtnText: { color: Colors.accentText, fontSize: 15, fontWeight: "700" },
  offerTime: { color: Colors.textMuted, fontSize: 11, textAlign: "center" },

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
});

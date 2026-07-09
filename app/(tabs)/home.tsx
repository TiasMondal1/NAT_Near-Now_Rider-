import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  AppState,
  Linking,
  type AppStateStatus,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { createClient } from "@supabase/supabase-js";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../../constants/theme";
import { SUPABASE_CONFIG } from "../../constants/config";
import { apiFetch } from "../../constants/api";
import { getSession } from "../../session";

const supabase = createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);

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

function formatTime(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

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
  const [driverStatus, setDriverStatus] = useState<string>("");
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
  const [verifiedBanner, setVerifiedBanner] = useState(false);
  const verifiedBannerAnim = useRef(new Animated.Value(0)).current;
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const visibleOffers = useMemo(
    () => offers.filter((o) => !ignoredOfferIds.has(o.offer_id)),
    [offers, ignoredOfferIds]
  );

  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
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
        const profileRes = await apiFetch<{ success: boolean; profile: { is_online: boolean; status: string } }>(
          "/delivery-partner/profile",
          {},
          session.token
        );
        setIsOnline(profileRes.profile.is_online);
        setDriverStatus(profileRes.profile.status ?? "");
      } catch {}

      setLoading(false);
    })();

    return () => {
      locationSub.current?.remove();
      if (pollRef.current) clearInterval(pollRef.current);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, []);

  // Poll for verification approval while pending — show in-app banner when approved
  useEffect(() => {
    if (driverStatus !== "pending_verification" || !token) {
      if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
      return;
    }

    const checkVerification = async () => {
      try {
        const profileRes = await apiFetch<{ success: boolean; profile: { is_online: boolean; status: string } }>(
          "/delivery-partner/profile", {}, token
        );
        const newStatus = profileRes.profile.status ?? "";
        if (newStatus === "active") {
          setDriverStatus("active");
          setVerifiedBanner(true);
          Animated.sequence([
            Animated.timing(verifiedBannerAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
            Animated.delay(4000),
            Animated.timing(verifiedBannerAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
          ]).start(() => setVerifiedBanner(false));
        }
      } catch {}
    };

    statusPollRef.current = setInterval(checkVerification, 30000);
    return () => {
      if (statusPollRef.current) { clearInterval(statusPollRef.current); statusPollRef.current = null; }
    };
  }, [driverStatus, token, verifiedBannerAnim]);

  const sendLocation = useCallback(async (lat: number, lng: number, heading: number | null, speed: number | null, accuracy: number | null) => {
    if (!token) return;
    try {
      await apiFetch(
        "/delivery-partner/location",
        { method: "POST", body: { latitude: lat, longitude: lng, heading, speed, accuracy } },
        token
      );
    } catch {}
  }, [token]);

  // Send last known location — used by heartbeat and AppState foreground handler
  const sendLastKnownLocation = useCallback(async () => {
    try {
      const loc = await Location.getLastKnownPositionAsync();
      if (loc) {
        sendLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.heading ?? null, loc.coords.speed ?? null, loc.coords.accuracy ?? null);
      }
    } catch {}
  }, [sendLocation]);

  useEffect(() => {
    if (!isOnline || !token) {
      locationSub.current?.remove();
      locationSub.current = null;
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
      return;
    }

    (async () => {
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, distanceInterval: 50, timeInterval: 10000 },
        (loc) => {
          setDriverPos({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          sendLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.heading ?? null, loc.coords.speed ?? null, loc.coords.accuracy ?? null);
        }
      );
    })();

    // Heartbeat: re-send last known position every 60 s so the dispatch system
    // keeps seeing this driver even when they're stationary.
    heartbeatRef.current = setInterval(sendLastKnownLocation, 60000);

    return () => {
      locationSub.current?.remove();
      locationSub.current = null;
      if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    };
  }, [isOnline, token, sendLocation, sendLastKnownLocation]);

  const fetchOffers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch<{ success: boolean; offers: Offer[] }>(
        "/delivery-partner/available-orders",
        {},
        token,
        0   // no retries on polls — fail fast, next cycle will retry
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
        token,
        0   // no retries on polls
      );
      if (res.success) {
        setActiveOrder(res.orders?.[0] ?? null);
      }
    } catch {}
  }, [token]);

  // When the app comes back to foreground, immediately re-send location so the
  // driver_locations record stays fresh (Android can freeze background location),
  // then refresh offers in case new ones landed while the screen was off.
  useEffect(() => {
    if (!isOnline || !token) return;

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        sendLastKnownLocation();
        fetchOffers();
      }
    };

    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [isOnline, token, sendLastKnownLocation, fetchOffers]);

  useEffect(() => {
    if (!token) return;

    // Active orders must always be polled — a simulation or manual dispatch can
    // assign an order even when the driver is marked offline in the app.
    fetchActiveOrder();
    const activeOrderInterval = setInterval(fetchActiveOrder, 6000);

    if (!isOnline) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      setOffers([]);
      return () => clearInterval(activeOrderInterval);
    }

    fetchOffers();
    // 15s fallback poll — Realtime subscription handles instant delivery.
    pollRef.current = setInterval(fetchOffers, 15000);

    return () => {
      clearInterval(activeOrderInterval);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isOnline, token, fetchOffers, fetchActiveOrder]);

  // Realtime subscription: fire fetchOffers the instant a new offer row lands
  // in driver_order_offers for this driver — no waiting for the next poll cycle.
  useEffect(() => {
    if (!isOnline || !token) {
      realtimeChannelRef.current?.unsubscribe();
      realtimeChannelRef.current = null;
      return;
    }

    // We need the rider's user_id to filter. Grab it from the session.
    getSession().then((session) => {
      if (!session?.user?.id) return;
      const driverId = session.user.id;

      realtimeChannelRef.current = supabase
        .channel(`offers:${driverId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "driver_order_offers",
            filter: `driver_id=eq.${driverId}`,
          },
          () => {
            // New offer just inserted — fetch immediately
            fetchOffers();
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          }
        )
        .subscribe();
    });

    return () => {
      realtimeChannelRef.current?.unsubscribe();
      realtimeChannelRef.current = null;
    };
  }, [isOnline, token, fetchOffers]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchOffers(), fetchActiveOrder()]);
    setRefreshing(false);
  };

  const handleToggle = async (value: boolean) => {
    if (toggling || driverStatus !== "active") return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsOnline(value);
    setToggling(true);
    try {
      await apiFetch("/delivery-partner/status", { method: "PATCH", body: { is_online: value } }, token, 0);
      if (value) {
        // Send current location immediately so the dispatch algorithm can see the rider.
        // Fall back to last known position if getCurrentPositionAsync fails (GPS off, etc.)
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          setDriverPos({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          await sendLocation(loc.coords.latitude, loc.coords.longitude, loc.coords.heading ?? null, loc.coords.speed ?? null, loc.coords.accuracy ?? null);
        } catch {
          await sendLastKnownLocation();
        }
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
              disabled={toggling || driverStatus !== "active"}
              trackColor={{ false: Colors.border, true: Colors.accentLight }}
              thumbColor={toggling || driverStatus !== "active" ? Colors.textMuted : isOnline ? Colors.accent : Colors.textMuted}
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
          {isOnline && !activeOrder && visibleOffers.length > 0 ? (
            <View style={styles.bannerCompact}>
              <Animated.View style={[styles.statusDot, { backgroundColor: Colors.online, transform: [{ scale: pulseAnim }] }]} />
              <Text style={styles.bannerCompactText}>
                {visibleOffers.length} order request
                {visibleOffers.length !== 1 ? "s" : ""} available
              </Text>
            </View>
          ) : (
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
                  {isOnline ? "Waiting for orders..." : "Go online to receive orders"}
                </Text>
              </View>
              {!isOnline && driverStatus === "active" && (
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
          )}

          {/* Verification approved in-app banner */}
          {verifiedBanner && (
            <Animated.View style={[styles.verifiedBanner, { opacity: verifiedBannerAnim }]}>
              <MaterialCommunityIcons name="check-circle" size={20} color="#fff" />
              <Text style={styles.verifiedBannerText}>
                Verification approved! You can now go online.
              </Text>
            </Animated.View>
          )}

          {/* Non-active status warning */}
          {driverStatus && driverStatus !== "active" && (
            <View style={styles.statusWarning}>
              <MaterialCommunityIcons
                name={driverStatus === "pending_verification" ? "clock-outline" : "alert-circle-outline"}
                size={20}
                color={Colors.danger}
              />
              <View style={{ flex: 1 }}>
                {driverStatus === "pending_verification" ? (
                  <>
                    <Text style={styles.statusWarningText}>
                      Your account is pending verification. Please connect to admin to get verified.
                    </Text>
                    <TouchableOpacity
                      style={styles.adminContactBtn}
                      onPress={() => Linking.openURL("tel:+919062692914")}
                      activeOpacity={0.7}
                    >
                      <MaterialCommunityIcons name="phone" size={14} color={Colors.accent} />
                      <Text style={styles.adminContactText}>+91 9062692914</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.statusWarningText}>
                    {driverStatus === "suspended"
                      ? "Your account has been suspended. Contact support for assistance."
                      : driverStatus === "offboarded"
                      ? "Your account is no longer active."
                      : `Account status: ${driverStatus}. Contact support.`}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Active order resumption card */}
          {activeOrder && (
            <TouchableOpacity
              style={styles.activeCard}
              onPress={() => router.push({ pathname: "/delivery/[orderId]", params: { orderId: activeOrder.id } })}
              activeOpacity={0.85}
            >
              <View style={styles.activeCardInner}>
                <View style={styles.activeCardRow}>
                  <View style={styles.activeIconWrap}>
                    <MaterialCommunityIcons name="truck-fast" size={24} color={Colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeCardTitle}>Active Delivery — #{activeOrder.order_code}</Text>
                    <Text style={styles.activeCardSub} numberOfLines={1}>{activeOrder.delivery_address}</Text>
                  </View>
                  <View style={styles.activeArrow}>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.accent} />
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {/* Offer cards */}
          {isOnline && !activeOrder && visibleOffers.length > 0 && (
            <>
              {visibleOffers.map((offer) => {
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
                      {offer.stores.map((s) => {
                        const dist = driverPos
                          ? fmtDist(haversineKm(driverPos.lat, driverPos.lng, s.latitude, s.longitude))
                          : null;
                        return (
                          <View key={s.store_id} style={styles.offerStoreRow}>
                            <View style={styles.offerStoreSeq}>
                              <Text style={styles.offerStoreSeqText}>{s.sequence_number}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.offerStoreName}>{s.name || "Store"}</Text>
                              <Text style={styles.offerStoreAddr} numberOfLines={1}>{s.address}</Text>
                            </View>
                            {dist && (
                              <View style={styles.offerStoreDistBadge}>
                                <MaterialCommunityIcons name="map-marker-distance" size={11} color={Colors.accent} />
                                <Text style={styles.offerStoreDistText}>{dist}</Text>
                              </View>
                            )}
                          </View>
                        );
                      })}
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

          {isOnline && !activeOrder && visibleOffers.length === 0 && (
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
  content: { flex: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" },

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
  offerStoreDistBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexShrink: 0,
  },
  offerStoreDistText: { color: Colors.accent, fontSize: 11, fontWeight: "700" },
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

  statusWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Colors.danger + "15",
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.danger + "40",
    padding: Spacing.md,
  },
  statusWarningText: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
  },
  adminContactBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    alignSelf: "flex-start",
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  adminContactText: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  verifiedBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: Colors.online,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  verifiedBannerText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },

  bannerCompact: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.accent + "30",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  bannerCompactText: {
    color: Colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
});

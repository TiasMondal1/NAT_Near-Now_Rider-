import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Animated,
  ScrollView,
  TextInput,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../../constants/theme";
import { apiFetch } from "../../constants/api";
import { getSession } from "../../session";

function haversineKm(lt1: number, lg1: number, lt2: number, lg2: number) {
  const R = 6371, r = (d: number) => (d * Math.PI) / 180;
  const dL = r(lt2 - lt1), dG = r(lg2 - lg1);
  const a = Math.sin(dL / 2) ** 2 + Math.cos(r(lt1)) * Math.cos(r(lt2)) * Math.sin(dG / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDist(d: number) {
  return d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1)} km`;
}

type StoreStop = {
  allocation_id: string;
  sequence_number: number;
  status: string;
  picked_up: boolean;
  pickup_code_required: boolean;
  picked_up_at: string | null;
  store: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    phone: string;
  };
  items: Array<{ id: string; product_name: string; quantity: number; unit: string }>;
};

type ActiveOrder = {
  id: string;
  order_code: string;
  status: string;
  total_amount: number;
  customer_address: string;
  customer_lat: number;
  customer_lng: number;
  total_stores: number;
  all_picked_up: boolean;
};

function PickupStopCard({
  stop,
  orderId,
  token,
  isNext,
  onDone,
  driverLat,
  driverLng,
}: {
  stop: StoreStop;
  orderId: string;
  token: string;
  isNext: boolean;
  onDone: () => void;
  driverLat: number | null;
  driverLng: number | null;
}) {
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [codeErr, setCodeErr] = useState("");

  const verify = async () => {
    if (!/^\d{4}$/.test(code)) {
      setCodeErr("Enter the 4-digit code");
      return;
    }
    setVerifying(true);
    setCodeErr("");
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/delivery-partner/orders/${orderId}/stores/${stop.allocation_id}/verify-code`,
        { method: "POST", body: { code } },
        token
      );
      if (res.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone();
      }
    } catch (e: any) {
      setCodeErr(e?.error || e?.message || "Incorrect code — try again");
    } finally {
      setVerifying(false);
    }
  };

  const openNav = () => {
    const { latitude, longitude } = stop.store;
    const scheme = Platform.select({
      ios: `maps:0,0?q=@${latitude},${longitude}`,
      android: `google.navigation:q=${latitude},${longitude}`,
    });
    if (scheme) Linking.openURL(scheme);
  };

  const callStore = () => {
    if (stop.store.phone) Linking.openURL(`tel:${stop.store.phone}`);
  };

  const done = stop.picked_up;

  return (
    <View
      style={[
        styles.stopCard,
        done ? styles.stopCardDone : isNext ? styles.stopCardNext : styles.stopCardPending,
      ]}
    >
      <View
        style={[
          styles.stopHeader,
          done ? styles.stopHeaderDone : isNext ? styles.stopHeaderNext : styles.stopHeaderPending,
        ]}
      >
        <View
          style={[
            styles.stopSeq,
            done ? styles.stopSeqDone : isNext ? styles.stopSeqNext : styles.stopSeqPending,
          ]}
        >
          {done ? (
            <MaterialCommunityIcons name="check" size={14} color={Colors.accentText} />
          ) : (
            <Text style={styles.stopSeqText}>{stop.sequence_number}</Text>
          )}
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.stopStoreName} numberOfLines={1}>
            {stop.store.name}
          </Text>
          <Text style={styles.stopStoreAddr} numberOfLines={1}>
            {stop.store.address}
          </Text>
          {driverLat != null && driverLng != null && (
            <View style={styles.stopDistBadge}>
              <MaterialCommunityIcons name="map-marker-distance" size={11} color={Colors.accent} />
              <Text style={styles.stopDistText}>
                {fmtDist(haversineKm(driverLat, driverLng, stop.store.latitude, stop.store.longitude))} away
              </Text>
            </View>
          )}
        </View>

        <View style={styles.stopHeaderActions}>
          {stop.store.phone ? (
            <TouchableOpacity style={styles.stopIconBtn} onPress={callStore}>
              <MaterialCommunityIcons name="phone" size={16} color={Colors.accent} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.stopIconBtn} onPress={openNav}>
            <MaterialCommunityIcons name="navigation-variant" size={16} color={Colors.accent} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.stopItems}>
        <Text style={styles.stopItemsLabel}>Items to collect</Text>
        {stop.items.map((item) => (
          <View key={item.id} style={styles.stopItemRow}>
            <Text style={styles.stopItemQty}>
              {item.quantity}{item.unit ? ` ${item.unit}` : ""}
            </Text>
            <Text style={styles.stopItemName}>{item.product_name}</Text>
          </View>
        ))}
      </View>

      {isNext && !done && stop.pickup_code_required && (
        <View style={styles.codeSection}>
          <View style={styles.codeRow}>
            <MaterialCommunityIcons name="key-variant" size={16} color={Colors.accent} />
            <Text style={styles.codeLabel}>Enter 4-digit pickup code</Text>
          </View>
          <View style={styles.codeInputRow}>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={(t) => { setCode(t.replace(/\D/g, "").slice(0, 4)); setCodeErr(""); }}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="_ _ _ _"
              placeholderTextColor={Colors.textMuted}
              onSubmitEditing={verify}
            />
            <TouchableOpacity
              style={[styles.verifyBtn, (verifying || code.length !== 4) && styles.verifyBtnDisabled]}
              onPress={verify}
              disabled={verifying || code.length !== 4}
              activeOpacity={0.8}
            >
              {verifying ? (
                <ActivityIndicator color={Colors.accentText} size="small" />
              ) : (
                <Text style={styles.verifyBtnText}>Verify</Text>
              )}
            </TouchableOpacity>
          </View>
          {codeErr ? (
            <View style={styles.codeErrRow}>
              <MaterialCommunityIcons name="alert-circle" size={14} color={Colors.danger} />
              <Text style={styles.codeErrText}>{codeErr}</Text>
            </View>
          ) : null}
        </View>
      )}

      {isNext && !done && !stop.pickup_code_required && (
        <View style={styles.waitingSection}>
          <ActivityIndicator size="small" color={Colors.textMuted} />
          <Text style={styles.waitingText}>Waiting for store to confirm your arrival…</Text>
        </View>
      )}

      {done && stop.picked_up_at ? (
        <View style={styles.stopDoneRow}>
          <MaterialCommunityIcons name="check-circle" size={14} color={Colors.success} />
          <Text style={styles.stopDoneText}>
            Picked up at{" "}
            {new Date(stop.picked_up_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export default function DeliveryScreen() {
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [order, setOrder] = useState<ActiveOrder | null>(null);
  const [stops, setStops] = useState<StoreStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [delivering, setDelivering] = useState(false);
  const [token, setToken] = useState("");
  const [deliveryOtp, setDeliveryOtp] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [otpErr, setOtpErr] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [driverLat, setDriverLat] = useState<number | null>(null);
  const [driverLng, setDriverLng] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) return;
      setToken(session.token);
      await loadSequence(session.token);
    })();

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      locationSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 30, timeInterval: 10000 },
        (loc) => {
          setDriverLat(loc.coords.latitude);
          setDriverLng(loc.coords.longitude);
        }
      );
    })();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      locationSubRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    pollRef.current = setInterval(() => loadSequence(token, true), 10000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [token]);

  const loadSequence = useCallback(
    async (t: string, silent = false) => {
      try {
        const res = await apiFetch<{ order: ActiveOrder; stops: StoreStop[] }>(
          `/delivery-partner/orders/${orderId}/pickup-sequence`,
          {},
          t,
          silent ? 0 : 2  // no retries for background polls, keep retries for initial load
        );
        setOrder(res.order);
        setStops(res.stops);
        if (!silent) {
          Animated.parallel([
            Animated.timing(slideAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
            Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
          ]).start();
        }
      } catch {
        if (!silent) Alert.alert("Error", "Failed to load order.");
      }
      setLoading(false);
      setRefreshing(false);
    },
    [orderId, slideAnim, fadeAnim]
  );

  const markDelivered = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Confirm Delivery", "Mark this order as delivered to the customer?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Yes, Delivered",
        onPress: async () => {
          setDelivering(true);
          try {
            await apiFetch(`/delivery-partner/orders/${orderId}/delivered`, { method: "POST" }, token);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            await loadSequence(token);
          } catch {
            Alert.alert("Error", "Failed to update order status.");
          }
          setDelivering(false);
        },
      },
    ]);
  };

  const verifyDeliveryOtp = async () => {
    if (!/^\d{4}$/.test(deliveryOtp)) { setOtpErr("Enter the 4-digit OTP"); return; }
    setOtpVerifying(true);
    setOtpErr("");
    try {
      const res = await apiFetch<{ success: boolean }>(
        `/delivery-partner/orders/${orderId}/verify-delivery-otp`,
        { method: "POST", body: { otp: deliveryOtp } },
        token
      );
      if (res.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setOtpVerified(true);
      }
    } catch (e: any) {
      setOtpErr(e?.error || e?.message || "Incorrect OTP — ask customer to check their app");
    } finally {
      setOtpVerifying(false);
    }
  };

  const openCustomerNav = () => {
    if (!order) return;
    const scheme = Platform.select({
      ios: `maps:0,0?q=@${order.customer_lat},${order.customer_lng}`,
      android: `google.navigation:q=${order.customer_lat},${order.customer_lng}`,
    });
    if (scheme) Linking.openURL(scheme);
  };

  if (loading || !order) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  const nextIdx = stops.findIndex((s) => !s.picked_up);
  const doneCount = stops.filter((s) => s.picked_up).length;
  const isCompleted = order.status === "order_delivered" || order.status === "completed";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.topBarCenter}>
          <Text style={styles.topBarTitle}>#{order.order_code}</Text>
          <Text style={styles.topBarSub}>
            {isCompleted ? "Delivered" : order.all_picked_up ? "Delivering" : `${doneCount}/${order.total_stores} stops done`}
          </Text>
        </View>
        <View style={styles.amountBadge}>
          <Text style={styles.amountText}>₹{order.total_amount}</Text>
        </View>
      </View>

      <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadSequence(token); }}
              tintColor={Colors.accent}
            />
          }
        >
          {isCompleted && (
            <View style={styles.completedWrap}>
              <View style={styles.completedIconWrap}>
                <MaterialCommunityIcons name="check-circle" size={52} color={Colors.success} />
              </View>
              <Text style={styles.completedTitle}>Order Delivered!</Text>
              <Text style={styles.completedAmount}>₹{order.total_amount}</Text>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => router.replace("/(tabs)/home")}
              >
                <MaterialCommunityIcons name="home" size={18} color={Colors.accentText} />
                <Text style={styles.primaryBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isCompleted && (
            <>
              <Text style={styles.sectionLabel}>
                Pickup Sequence — {order.total_stores} store{order.total_stores !== 1 ? "s" : ""}
              </Text>

              {stops.map((stop, i) => (
                <PickupStopCard
                  key={stop.allocation_id}
                  stop={stop}
                  orderId={orderId!}
                  token={token}
                  isNext={!order.all_picked_up && i === nextIdx}
                  onDone={() => loadSequence(token, true)}
                  driverLat={driverLat}
                  driverLng={driverLng}
                />
              ))}

              {order.all_picked_up && (
                <View style={styles.deliveryCard}>
                  <View style={styles.deliveryCardHeader}>
                    <View style={styles.deliveryIconWrap}>
                      <MaterialCommunityIcons name="account" size={24} color={Colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.deliveryTitle}>Deliver to Customer</Text>
                      <Text style={styles.deliveryAddr}>{order.customer_address}</Text>
                      {driverLat != null && driverLng != null && (
                        <View style={styles.stopDistBadge}>
                          <MaterialCommunityIcons name="map-marker-distance" size={11} color={Colors.accent} />
                          <Text style={styles.stopDistText}>
                            {fmtDist(haversineKm(driverLat, driverLng, order.customer_lat, order.customer_lng))} away
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>

                  {/* Customer OTP verification — customer reads their OTP aloud, rider enters it */}
                  {!otpVerified ? (
                    <View style={styles.deliveryOtpBox}>
                      <View style={styles.deliveryOtpRow}>
                        <MaterialCommunityIcons name="shield-key-outline" size={16} color={Colors.accent} />
                        <Text style={styles.deliveryOtpLabel}>Ask customer for their delivery OTP</Text>
                      </View>
                      <View style={styles.deliveryOtpInputRow}>
                        <TextInput
                          style={styles.deliveryOtpInput}
                          value={deliveryOtp}
                          onChangeText={(t) => { setDeliveryOtp(t.replace(/\D/g, "").slice(0, 4)); setOtpErr(""); }}
                          keyboardType="number-pad"
                          maxLength={4}
                          placeholder="_ _ _ _"
                          placeholderTextColor={Colors.textMuted}
                          onSubmitEditing={verifyDeliveryOtp}
                        />
                        <TouchableOpacity
                          style={[styles.verifyBtn, (otpVerifying || deliveryOtp.length !== 4) && styles.verifyBtnDisabled]}
                          onPress={verifyDeliveryOtp}
                          disabled={otpVerifying || deliveryOtp.length !== 4}
                          activeOpacity={0.8}
                        >
                          {otpVerifying
                            ? <ActivityIndicator color={Colors.accentText} size="small" />
                            : <Text style={styles.verifyBtnText}>Verify</Text>}
                        </TouchableOpacity>
                      </View>
                      {otpErr ? (
                        <View style={styles.deliveryOtpErrRow}>
                          <MaterialCommunityIcons name="alert-circle" size={14} color={Colors.danger} />
                          <Text style={styles.deliveryOtpErrText}>{otpErr}</Text>
                        </View>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.deliveryOtpVerifiedRow}>
                      <MaterialCommunityIcons name="shield-check" size={16} color={Colors.success} />
                      <Text style={styles.deliveryOtpVerifiedText}>OTP verified — safe to deliver</Text>
                    </View>
                  )}

                  <View style={styles.deliveryActions}>
                    <TouchableOpacity style={styles.navBtn} onPress={openCustomerNav} activeOpacity={0.8}>
                      <MaterialCommunityIcons name="navigation-variant" size={16} color={Colors.accent} />
                      <Text style={styles.navBtnText}>Navigate</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.primaryBtn, styles.primaryBtnFlex, (!otpVerified || delivering) && styles.primaryBtnDisabled]}
                      onPress={markDelivered}
                      disabled={!otpVerified || delivering}
                      activeOpacity={0.8}
                    >
                      {delivering ? (
                        <ActivityIndicator color={Colors.accentText} size="small" />
                      ) : (
                        <>
                          <MaterialCommunityIcons name="check-circle" size={18} color={Colors.accentText} />
                          <Text style={styles.primaryBtnText}>Mark Delivered</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {!order.all_picked_up && (
                <Text style={styles.hintText}>
                  Complete all store pickups to proceed to delivery
                </Text>
              )}
            </>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  topBarCenter: { flex: 1 },
  topBarTitle: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  topBarSub: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
  amountBadge: {
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.accent + "40",
  },
  amountText: { color: Colors.accent, fontSize: 14, fontWeight: "700" },

  scroll: { flex: 1 },
  scrollContent: { padding: Spacing.lg, gap: Spacing.md },

  sectionLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },

  stopCard: {
    borderRadius: BorderRadius.lg,
    borderWidth: 2,
    overflow: "hidden",
  },
  stopCardDone: { borderColor: Colors.success + "60", backgroundColor: Colors.successLight + "40" },
  stopCardNext: { borderColor: Colors.accent + "60", backgroundColor: Colors.accentLight },
  stopCardPending: { borderColor: Colors.border, backgroundColor: Colors.surface },

  stopHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
  },
  stopHeaderDone: { backgroundColor: Colors.success + "20" },
  stopHeaderNext: { backgroundColor: Colors.accent + "15" },
  stopHeaderPending: { backgroundColor: Colors.surfaceLight },

  stopSeq: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  stopSeqDone: { backgroundColor: Colors.success },
  stopSeqNext: { backgroundColor: Colors.accent },
  stopSeqPending: { backgroundColor: Colors.border },
  stopSeqText: { color: Colors.accentText, fontSize: 13, fontWeight: "700" },

  stopStoreName: { color: Colors.text, fontSize: 14, fontWeight: "700" },
  stopStoreAddr: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
  stopDistBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    marginTop: 4,
    alignSelf: "flex-start",
    backgroundColor: Colors.accentLight,
    borderRadius: BorderRadius.round,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  stopDistText: { color: Colors.accent, fontSize: 11, fontWeight: "700" },

  stopHeaderActions: { flexDirection: "row", gap: 6 },
  stopIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
  },

  stopItems: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border + "60",
  },
  stopItemsLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  stopItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
  },
  stopItemQty: { color: Colors.accent, fontSize: 13, fontWeight: "700", minWidth: 40 },
  stopItemName: { color: Colors.textSecondary, fontSize: 13, flex: 1 },

  codeSection: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border + "60",
    gap: 8,
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  codeLabel: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  codeInputRow: { flexDirection: "row", gap: 10 },
  codeInput: {
    flex: 1,
    height: 50,
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: BorderRadius.md,
    textAlign: "center",
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: 8,
    color: Colors.text,
    backgroundColor: Colors.bg,
  },
  verifyBtn: {
    paddingHorizontal: 20,
    height: 50,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  verifyBtnDisabled: { opacity: 0.5 },
  verifyBtnText: { color: Colors.accentText, fontSize: 15, fontWeight: "700" },
  codeErrRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  codeErrText: { color: Colors.danger, fontSize: 13 },

  waitingSection: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border + "60",
  },
  waitingText: { color: Colors.textMuted, fontSize: 13, flex: 1 },

  stopDoneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  stopDoneText: { color: Colors.success, fontSize: 12, fontWeight: "600" },

  deliveryCard: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    borderWidth: 1.5,
    borderColor: Colors.accent + "40",
    padding: Spacing.lg,
    gap: Spacing.md,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 3,
  },
  deliveryCardHeader: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md },
  deliveryIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  deliveryTitle: { color: Colors.text, fontSize: 16, fontWeight: "700" },
  deliveryAddr: { color: Colors.textSecondary, fontSize: 13, marginTop: 2, lineHeight: 18 },
  deliveryOtpBox: {
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.accentLight + "22",
    borderWidth: 1,
    borderColor: Colors.accent,
    gap: Spacing.xs,
  },
  deliveryOtpRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  deliveryOtpLabel: { color: Colors.text, fontSize: 13, fontWeight: "700" },
  deliveryOtpInputRow: { flexDirection: "row", gap: Spacing.sm, marginTop: 4 },
  deliveryOtpInput: {
    flex: 1,
    height: 46,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    color: Colors.text,
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 8,
    textAlign: "center",
  },
  deliveryOtpErrRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  deliveryOtpErrText: { color: Colors.danger, fontSize: 12 },
  deliveryOtpVerifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.success + "18",
  },
  deliveryOtpVerifiedText: { color: Colors.success, fontSize: 13, fontWeight: "700" },
  deliveryActions: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.md },
  navBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: Spacing.md,
    height: 50,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  navBtnText: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: BorderRadius.md,
    height: 50,
    paddingHorizontal: Spacing.md,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  primaryBtnFlex: { flex: 1 },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: { color: Colors.accentText, fontSize: 15, fontWeight: "700" },

  hintText: {
    color: Colors.textMuted,
    fontSize: 13,
    textAlign: "center",
    fontStyle: "italic",
  },

  completedWrap: {
    alignItems: "center",
    paddingVertical: Spacing.xl * 2,
    gap: Spacing.md,
  },
  completedIconWrap: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: Colors.successLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  completedTitle: { color: Colors.text, fontSize: 26, fontWeight: "800" },
  completedAmount: { color: Colors.textSecondary, fontSize: 18 },
});

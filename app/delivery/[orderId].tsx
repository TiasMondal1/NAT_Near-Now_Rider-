import { useState, useEffect, useRef } from "react";
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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import MapView, { PROVIDER_GOOGLE, Marker } from "../../components/MapViewWrapper";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../../constants/theme";
import { apiFetch } from "../../constants/api";
import { getSession } from "../../session";

const LIGHT_MAP_STYLE = [
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry.fill", stylers: [{ color: "#d4eaf7" }] },
  { featureType: "landscape.man_made", elementType: "geometry.fill", stylers: [{ color: "#f0f4f0" }] },
  { featureType: "road.highway", elementType: "geometry.fill", stylers: [{ color: "#e8ede8" }] },
  { featureType: "road.arterial", elementType: "geometry.fill", stylers: [{ color: "#f5f8f5" }] },
];

type OrderDetail = {
  id: string;
  order_code: string;
  status: string;
  total_amount: number;
  delivery_address: string;
  delivery_latitude: number;
  delivery_longitude: number;
  notes: string | null;
  stores?: {
    name: string;
    address: string;
    phone: string;
    latitude: number;
    longitude: number;
  } | null;
  order_items?: {
    product_name: string;
    quantity: number;
    unit: string;
  }[];
};

export default function DeliveryScreen() {
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [token, setToken] = useState("");
  const mapRef = useRef<any>(null);
  const cardAnim = useRef(new Animated.Value(100)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    (async () => {
      const session = await getSession();
      if (!session?.token) return;
      setToken(session.token);
      await fetchOrder(session.token);
    })();
  }, []);

  useEffect(() => {
    if (order) {
      Animated.parallel([
        Animated.spring(cardAnim, { toValue: 0, tension: 50, friction: 9, useNativeDriver: true }),
        Animated.timing(cardOpacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start();
    }
  }, [order]);

  const fetchOrder = async (t: string) => {
    try {
      const res = await apiFetch<{ success: boolean; order: OrderDetail }>(
        `/delivery-partner/orders/${orderId}`,
        {},
        t
      );
      if (res.success) {
        setOrder(res.order);
        fitMap(res.order);
      }
    } catch {
      Alert.alert("Error", "Failed to load order.");
    }
    setLoading(false);
  };

  const fitMap = (o: OrderDetail) => {
    if (!o.stores) return;
    setTimeout(() => {
      mapRef.current?.fitToCoordinates(
        [
          { latitude: o.stores!.latitude, longitude: o.stores!.longitude },
          { latitude: o.delivery_latitude, longitude: o.delivery_longitude },
        ],
        { edgePadding: { top: 120, right: 60, bottom: 340, left: 60 }, animated: true }
      );
    }, 500);
  };

  const handlePickedUp = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionLoading(true);
    try {
      await apiFetch(`/delivery-partner/orders/${orderId}/picked-up`, { method: "POST" }, token);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await fetchOrder(token);
    } catch {
      Alert.alert("Error", "Failed to update order status.");
    }
    setActionLoading(false);
  };

  const confirmAndDeliver = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert(
      "Confirm Delivery",
      "Are you sure the order has been delivered to the customer?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Delivered",
          onPress: async () => {
            setActionLoading(true);
            try {
              await apiFetch(`/delivery-partner/orders/${orderId}/delivered`, { method: "POST" }, token);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              await fetchOrder(token);
            } catch {
              Alert.alert("Error", "Failed to update order status.");
            }
            setActionLoading(false);
          },
        },
      ]
    );
  };

  const openNavigation = (lat: number, lng: number) => {
    const scheme = Platform.select({
      ios: `maps:0,0?q=@${lat},${lng}`,
      android: `google.navigation:q=${lat},${lng}`,
    });
    if (scheme) Linking.openURL(scheme);
  };

  const callStore = () => {
    if (order?.stores?.phone) Linking.openURL(`tel:${order.stores.phone}`);
  };

  if (loading || !order) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={Colors.accent} size="large" />
      </View>
    );
  }

  const isPickup = order.status === "rider_assigned";
  const isDelivering = order.status === "en_route_delivery";
  const isCompleted = order.status === "completed";

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        provider={PROVIDER_GOOGLE}
        customMapStyle={LIGHT_MAP_STYLE}
        showsUserLocation
        showsMyLocationButton={false}
      >
        {order.stores && (
          <Marker
            coordinate={{ latitude: order.stores.latitude, longitude: order.stores.longitude }}
            title={order.stores.name}
            description="Pickup"
            pinColor={isPickup ? "#16A34A" : "#9CA3AF"}
          />
        )}
        <Marker
          coordinate={{ latitude: order.delivery_latitude, longitude: order.delivery_longitude }}
          title="Customer"
          description={order.delivery_address}
          pinColor={isDelivering ? "#16A34A" : "#9CA3AF"}
        />
      </MapView>

      <SafeAreaView edges={["top"]} style={styles.topBarRow}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.orderBadge}>
          <Text style={styles.orderBadgeText}>#{order.order_code || "---"}</Text>
        </View>
        <View style={styles.amountBadge}>
          <MaterialCommunityIcons name="currency-inr" size={14} color={Colors.accent} />
          <Text style={styles.amountBadgeText}>{order.total_amount}</Text>
        </View>
      </SafeAreaView>

      <Animated.View style={[styles.bottomCard, { transform: [{ translateY: cardAnim }], opacity: cardOpacity }]}>
        <View style={styles.progressRow}>
          <View style={[styles.progressDot, (isPickup || isDelivering || isCompleted) && styles.progressDotActive]} />
          <View style={[styles.progressLine, (isDelivering || isCompleted) && styles.progressLineActive]} />
          <View style={[styles.progressDot, (isDelivering || isCompleted) && styles.progressDotActive]} />
          <View style={[styles.progressLine, isCompleted && styles.progressLineActive]} />
          <View style={[styles.progressDot, isCompleted && styles.progressDotActive]} />
        </View>
        <View style={styles.progressLabels}>
          <Text style={[styles.progressLabel, (isPickup || isDelivering || isCompleted) && styles.progressLabelActive]}>Accepted</Text>
          <Text style={[styles.progressLabel, (isDelivering || isCompleted) && styles.progressLabelActive]}>Picked Up</Text>
          <Text style={[styles.progressLabel, isCompleted && styles.progressLabelActive]}>Delivered</Text>
        </View>

        <View style={styles.cardDivider} />

        {isPickup && (
          <>
            <Text style={styles.stepLabel}>PICKUP FROM</Text>
            <Text style={styles.placeName}>{order.stores?.name}</Text>
            <Text style={styles.placeAddress}>{order.stores?.address}</Text>

            {order.order_items && order.order_items.length > 0 && (
              <View style={styles.itemsList}>
                <Text style={styles.itemsTitle}>{order.order_items.length} item{order.order_items.length > 1 ? "s" : ""}</Text>
                {order.order_items.map((item, i) => (
                  <View key={i} style={styles.itemRow}>
                    <Text style={styles.itemQty}>{item.quantity}x</Text>
                    <Text style={styles.itemName}>{item.product_name}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.iconButton} onPress={callStore}>
                <MaterialCommunityIcons name="phone" size={20} color={Colors.accent} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.navButton} onPress={() => openNavigation(order.stores!.latitude, order.stores!.longitude)}>
                <MaterialCommunityIcons name="navigation-variant" size={18} color={Colors.accent} />
                <Text style={styles.navText}>Navigate</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={handlePickedUp} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator color={Colors.accentText} /> : (
                  <View style={styles.primaryInner}>
                    <MaterialCommunityIcons name="package-variant" size={18} color={Colors.accentText} />
                    <Text style={styles.primaryButtonText}>Picked Up</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {isDelivering && (
          <>
            <Text style={styles.stepLabel}>DELIVER TO</Text>
            <Text style={styles.placeName}>Customer</Text>
            <Text style={styles.placeAddress}>{order.delivery_address}</Text>

            {order.notes && (
              <View style={styles.noteBox}>
                <MaterialCommunityIcons name="note-text" size={14} color={Colors.accent} />
                <Text style={styles.noteText}>{order.notes}</Text>
              </View>
            )}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.navButton} onPress={() => openNavigation(order.delivery_latitude, order.delivery_longitude)}>
                <MaterialCommunityIcons name="navigation-variant" size={18} color={Colors.accent} />
                <Text style={styles.navText}>Navigate</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={confirmAndDeliver} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator color={Colors.accentText} /> : (
                  <View style={styles.primaryInner}>
                    <MaterialCommunityIcons name="check-circle" size={18} color={Colors.accentText} />
                    <Text style={styles.primaryButtonText}>Delivered</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}

        {isCompleted && (
          <View style={styles.completedContainer}>
            <View style={styles.completedIconWrap}>
              <MaterialCommunityIcons name="check-circle" size={48} color={Colors.success} />
            </View>
            <Text style={styles.completedText}>Order Delivered!</Text>
            <Text style={styles.completedAmount}>{"\u20B9"}{order.total_amount}</Text>
            <View style={styles.earningBadge}>
              <MaterialCommunityIcons name="wallet-plus" size={16} color={Colors.success} />
              <Text style={styles.earningBadgeText}>+{"\u20B9"}{(Number(order.total_amount) * 0.15).toFixed(0)} earned</Text>
            </View>
            <TouchableOpacity style={[styles.primaryButton, { marginTop: Spacing.sm }]} onPress={() => router.replace("/(tabs)/home")}>
              <View style={styles.primaryInner}>
                <MaterialCommunityIcons name="home" size={18} color={Colors.accentText} />
                <Text style={styles.primaryButtonText}>Back to Home</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  centered: { flex: 1, backgroundColor: Colors.bg, alignItems: "center", justifyContent: "center" },
  topBarRow: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, gap: Spacing.sm, zIndex: 10 },
  backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: "center", justifyContent: "center", shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  orderBadge: { backgroundColor: Colors.card, borderRadius: BorderRadius.round, paddingHorizontal: Spacing.md, paddingVertical: 8, borderWidth: 1, borderColor: Colors.border, shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  orderBadgeText: { color: Colors.text, fontSize: 13, fontWeight: "700" },
  amountBadge: { flexDirection: "row", alignItems: "center", gap: 2, backgroundColor: Colors.accentLight, borderRadius: BorderRadius.round, paddingHorizontal: Spacing.md, paddingVertical: 8, borderWidth: 1, borderColor: Colors.accent, marginLeft: "auto", shadowColor: Colors.accent, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.15, shadowRadius: 4, elevation: 3 },
  amountBadgeText: { color: Colors.accent, fontSize: 14, fontWeight: "700" },
  bottomCard: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: Colors.card, borderTopLeftRadius: BorderRadius.xl, borderTopRightRadius: BorderRadius.xl, padding: Spacing.lg, paddingBottom: 44, borderWidth: 1, borderColor: Colors.border, borderBottomWidth: 0, shadowColor: "#000", shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 8 },
  progressRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 6 },
  progressDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.border, borderWidth: 2, borderColor: Colors.borderLight },
  progressDotActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  progressLine: { flex: 1, height: 3, backgroundColor: Colors.border, marginHorizontal: 4, borderRadius: 2 },
  progressLineActive: { backgroundColor: Colors.accent },
  progressLabels: { flexDirection: "row", justifyContent: "space-between", marginBottom: Spacing.sm },
  progressLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: "600", letterSpacing: 0.5 },
  progressLabelActive: { color: Colors.accent },
  cardDivider: { height: 1, backgroundColor: Colors.border, marginVertical: Spacing.sm },
  stepLabel: { color: Colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 2, marginBottom: Spacing.xs },
  placeName: { color: Colors.text, fontSize: 20, fontWeight: "800", marginBottom: 4 },
  placeAddress: { color: Colors.textSecondary, fontSize: 14, marginBottom: Spacing.md, lineHeight: 20 },
  itemsList: { backgroundColor: Colors.surface, borderRadius: BorderRadius.md, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  itemsTitle: { color: Colors.textMuted, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, marginBottom: Spacing.sm, textTransform: "uppercase" },
  itemRow: { flexDirection: "row", alignItems: "center", gap: Spacing.sm, paddingVertical: 3 },
  itemQty: { color: Colors.accent, fontSize: 14, fontWeight: "700", width: 28 },
  itemName: { color: Colors.textSecondary, fontSize: 14, flex: 1 },
  noteBox: { flexDirection: "row", alignItems: "flex-start", gap: 6, backgroundColor: Colors.accentLight, borderRadius: BorderRadius.sm, padding: Spacing.md, marginBottom: Spacing.md },
  noteText: { color: Colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },
  actions: { flexDirection: "row", gap: Spacing.sm },
  iconButton: { width: 50, height: 50, borderRadius: BorderRadius.md, borderWidth: 1, borderColor: Colors.accentLight, backgroundColor: Colors.accentLight, alignItems: "center", justifyContent: "center" },
  navButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: Colors.border, borderRadius: BorderRadius.md, paddingHorizontal: Spacing.md, height: 50, backgroundColor: Colors.bg },
  navText: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  primaryButton: { flex: 1, backgroundColor: Colors.accent, borderRadius: BorderRadius.md, height: 50, alignItems: "center", justifyContent: "center", shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  primaryInner: { flexDirection: "row", alignItems: "center", gap: 8 },
  primaryButtonText: { color: Colors.accentText, fontSize: 16, fontWeight: "700" },
  completedContainer: { alignItems: "center", gap: Spacing.sm, paddingVertical: Spacing.lg },
  completedIconWrap: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.successLight, alignItems: "center", justifyContent: "center" },
  completedText: { color: Colors.text, fontSize: 24, fontWeight: "800" },
  completedAmount: { color: Colors.textSecondary, fontSize: 18 },
  earningBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.successLight,
    borderRadius: BorderRadius.round,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    marginTop: Spacing.xs,
    marginBottom: Spacing.md,
  },
  earningBadgeText: { color: Colors.success, fontSize: 16, fontWeight: "700" },
});

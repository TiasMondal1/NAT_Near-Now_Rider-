import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { ORDERS_PAGE_SIZE, appendPage, mergeFirstPage } from "../../lib/orderPaging";
import { formatOrderDate } from "../../lib/formatDate";
import {
  earningDate,
  earningsWindow,
  summariseLocally,
  summaryPath,
  todayRows,
  type EarningsRow,
  type EarningsSummary,
  type EarningsSummaryResponse,
} from "../../lib/earnings";

// Fallback only (backend without /earnings/summary): the old full-history
// walk. The backend caps a page at 200; 50 pages = 10k deliveries.
const LEGACY_PAGE_SIZE = 200;
const LEGACY_MAX_PAGES = 50;

type OrdersPage = { success: boolean; orders: EarningsRow[]; has_more?: boolean };

/** Every completed order, page by page — what this tab did before the summary endpoint. */
async function walkCompletedHistory(token: string): Promise<EarningsRow[]> {
  let all: EarningsRow[] = [];
  let offset = 0;
  for (let page = 0; page < LEGACY_MAX_PAGES; page++) {
    const res = await apiFetch<OrdersPage>(
      `/delivery-partner/orders?status=completed&limit=${LEGACY_PAGE_SIZE}&offset=${offset}`,
      {},
      token
    );
    if (!res.success) break;
    all = appendPage(all, res.orders);
    offset += res.orders.length;
    if (!res.has_more || res.orders.length === 0) break;
  }
  return all;
}

type Period = "today" | "week" | "all";

export default function EarningsScreen() {
  // Totals for all three periods, plus the deliveries of the last 7 days
  // (the Today and Last 7 Days lists), from one /earnings/summary call.
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [recent, setRecent] = useState<EarningsRow[]>([]);
  const [todayStart, setTodayStart] = useState(() => earningsWindow(Date.now()).todayStart);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [token, setToken] = useState("");
  const [period, setPeriod] = useState<Period>("today");
  const periodRef = useRef(period);
  periodRef.current = period;

  // The All Time list, paged on demand (first page when the rider opens that
  // period, more on scroll) instead of downloading every delivery up front.
  const [allOrders, setAllOrders] = useState<EarningsRow[]>([]);
  const allOrdersRef = useRef(allOrders);
  allOrdersRef.current = allOrders;
  const [allHasMore, setAllHasMore] = useState(false);
  const [allLoaded, setAllLoaded] = useState(false);
  const allLoadedRef = useRef(false);
  const [allLoading, setAllLoading] = useState(false);
  const [allError, setAllError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const allSeqRef = useRef(0);
  // Set once the backend answers 404 for /earnings/summary (it predates the
  // endpoint): this run then uses the old full-history walk for everything.
  const legacyBackendRef = useRef(false);

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
        // `token` never gets set, fetchSummary() (the only place that
        // flips `loading` to false) never runs, and this screen spins
        // forever. Found 2026-08-26 during a crash-risk audit.
        setLoading(false);
      }
    })();
  }, []);

  // Totals + the 7-day rows: one /earnings/summary call. One at a time; a
  // focus or pull-to-refresh landing while it runs is absorbed by it (it
  // clears `refreshing` when it ends).
  const summaryInFlightRef = useRef(false);
  const fetchSummary = useCallback(async () => {
    if (!token) {
      // Pull-to-refresh sets `refreshing` before calling this; bail out
      // without clearing it and the spinner never stops.
      setRefreshing(false);
      return;
    }
    if (summaryInFlightRef.current) return;
    summaryInFlightRef.current = true;
    // A fresh window on every fetch, so "Today" moves on at midnight.
    const win = earningsWindow(Date.now());
    try {
      if (!legacyBackendRef.current) {
        try {
          const res = await apiFetch<EarningsSummaryResponse>(summaryPath(win), {}, token);
          // Filter the Today list with the boundary the server actually used.
          const serverToday = res.window ? Date.parse(res.window.today_start) : NaN;
          setSummary(res.summary);
          setRecent(res.recent ?? []);
          setTodayStart(Number.isFinite(serverToday) ? serverToday : win.todayStart);
          setLoadError(false);
          return;
        } catch (err: any) {
          if (err?.status !== 404) throw err;
          legacyBackendRef.current = true;
        }
      }
      // Backend without the endpoint: download everything and add it up here,
      // as this tab used to. The All Time list then has every delivery too.
      const all = await walkCompletedHistory(token);
      const local = summariseLocally(all, win);
      setSummary(local.summary);
      setRecent(local.recent);
      setTodayStart(win.todayStart);
      setAllOrders(all);
      setAllHasMore(false);
      allLoadedRef.current = true;
      setAllLoaded(true);
      setAllError(false);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      summaryInFlightRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  /** Newest page of the All Time list. `keepOlderPages` (focus refresh) keeps pages already scrolled to. */
  const loadAllFirstPage = useCallback(
    async (keepOlderPages: boolean) => {
      if (!token || legacyBackendRef.current) return;
      const seq = ++allSeqRef.current;
      setAllLoading(true);
      try {
        const res = await apiFetch<OrdersPage>(
          `/delivery-partner/orders?status=completed&limit=${ORDERS_PAGE_SIZE}`,
          {},
          token
        );
        if (seq !== allSeqRef.current) return;
        if (res.success) {
          if (keepOlderPages && allOrdersRef.current.length > ORDERS_PAGE_SIZE) {
            setAllOrders((prev) => mergeFirstPage(prev, res.orders));
          } else {
            setAllOrders(res.orders);
            setAllHasMore(!!res.has_more);
          }
          allLoadedRef.current = true;
          setAllLoaded(true);
          setAllError(false);
        }
      } catch {
        if (seq === allSeqRef.current) setAllError(true);
      } finally {
        if (seq === allSeqRef.current) setAllLoading(false);
      }
    },
    [token]
  );

  /** Next older page of the All Time list (FlatList onEndReached). */
  const loadMoreAll = useCallback(async () => {
    if (!token || !allHasMore || loadingMoreRef.current || legacyBackendRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = allSeqRef.current;
    try {
      const res = await apiFetch<OrdersPage>(
        `/delivery-partner/orders?status=completed&limit=${ORDERS_PAGE_SIZE}&offset=${allOrdersRef.current.length}`,
        {},
        token
      );
      if (seq !== allSeqRef.current) return; // the list was reloaded meanwhile
      if (res.success) {
        setAllOrders((prev) => appendPage(prev, res.orders));
        setAllHasMore(!!res.has_more);
      }
    } catch {
      // The next scroll to the end tries again.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [token, allHasMore]);

  // First focus, the token arriving (the callback changes) and every
  // re-focus: one summary call, plus the All Time list's newest page if the
  // rider has already opened it. No separate mount effect — that doubled the
  // first load.
  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      void fetchSummary();
      if (allLoadedRef.current) void loadAllFirstPage(true);
    }, [token, fetchSummary, loadAllFirstPage])
  );

  // The All Time list loads the first time that period is opened.
  useEffect(() => {
    if (period === "all" && token && !allLoadedRef.current) void loadAllFirstPage(false);
  }, [period, token, loadAllFirstPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchSummary();
    if (periodRef.current === "all") void loadAllFirstPage(false);
  }, [fetchSummary, loadAllFirstPage]);

  const todayList = useMemo(() => todayRows(recent, todayStart), [recent, todayStart]);
  const filteredOrders = period === "today" ? todayList : period === "week" ? recent : allOrders;

  const bucket = summary?.[period];
  const filteredEarnings = bucket?.earnings ?? 0;
  const deliveryCount = bucket?.deliveries ?? 0;
  // Deliveries with no payout row (from before payouts were recorded) add ₹0
  // to the total but are left out of the average's divisor — counting them
  // would drag "Avg ₹/delivery" down and look like underpayment.
  const payoutKnownCount = bucket?.payout_known ?? 0;
  const legacyOrderCount = deliveryCount - payoutKnownCount;
  const showListError = period === "all" ? allError && allOrders.length === 0 : loadError && !summary;
  const listPending = period === "all" && !allLoaded && !allError;


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

        {loadError && summary && (
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
                {p === "today" ? "Today" : p === "week" ? "Last 7 Days" : "All Time"}
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
              <Text style={styles.summaryMetaText}>{deliveryCount} deliveries</Text>
            </View>
            {payoutKnownCount > 0 && (
              <View style={styles.summaryMeta}>
                <MaterialCommunityIcons name="trending-up" size={16} color={Colors.success} />
                <Text style={[styles.summaryMetaText, { color: Colors.success }]}>
                  Avg {"\u20B9"}{(filteredEarnings / payoutKnownCount).toFixed(0)}/delivery
                </Text>
              </View>
            )}
          </View>
          {legacyOrderCount > 0 && (
            <Text style={styles.legacyNote}>
              {legacyOrderCount} {legacyOrderCount === 1 ? "delivery" : "deliveries"} shown as {"\u20B9"}0 {"\u2014"} payout data unavailable for {legacyOrderCount === 1 ? "it" : "them"}, excluded from the average.
            </Text>
          )}
        </View>

        <View style={styles.quickStatsRow}>
          <View style={[styles.quickStat, { backgroundColor: Colors.accentLight }]}>
            <Text style={[styles.quickStatValue, { color: Colors.accent }]}>{summary?.today.deliveries ?? 0}</Text>
            <Text style={styles.quickStatLabel}>Today</Text>
          </View>
          <View style={[styles.quickStat, { backgroundColor: Colors.warningLight }]}>
            <Text style={[styles.quickStatValue, { color: Colors.warning }]}>{summary?.week.deliveries ?? 0}</Text>
            <Text style={styles.quickStatLabel}>This Week</Text>
          </View>
          <View style={[styles.quickStat, { backgroundColor: Colors.successLight }]}>
            <Text style={[styles.quickStatValue, { color: Colors.success }]}>{summary?.all.deliveries ?? 0}</Text>
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />
        }
        // All Time pages in as the rider scrolls; Today / Last 7 Days are complete already.
        onEndReached={period === "all" ? () => void loadMoreAll() : undefined}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          period === "all" && loadingMore ? (
            <ActivityIndicator color={Colors.accent} style={{ marginVertical: Spacing.lg }} />
          ) : null
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
                {/* Was formatOrderDate(item.placed_at) — showed the order's placement date
                    while Today/Week bucketing and totals above key off earningDate()
                    (payout_created_at, falling back to placed_at only for legacy
                    orders with no payout row). A delivery paid out today but placed
                    days earlier was correctly counted in "Today's Earnings" yet
                    showed the older placement date here — confusing, not a math bug.
                    Found 2026-09-09. */}
                <Text style={styles.date}>{formatOrderDate(earningDate(item).toISOString())}</Text>
              </View>
            </View>
          </Animated.View>
        )}
        ListEmptyComponent={
          listPending || (period === "all" && allLoading && allOrders.length === 0) ? (
            <ActivityIndicator color={Colors.accent} style={{ marginTop: Spacing.xl }} />
          ) : showListError ? (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconWrap, { backgroundColor: Colors.warningLight }]}>
                <MaterialCommunityIcons name="wifi-alert" size={40} color={Colors.warning} />
              </View>
              <Text style={styles.emptyText}>Couldn&apos;t load earnings</Text>
              <Text style={styles.emptySub}>Check your connection and try again.</Text>
              <TouchableOpacity
                style={styles.retryBtn}
                onPress={() => {
                  void fetchSummary();
                  if (period === "all") void loadAllFirstPage(false);
                }}
              >
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

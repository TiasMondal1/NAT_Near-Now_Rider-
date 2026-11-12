/**
 * Developer tools — testing aids. Only dev clients and preview builds contain
 * them (lib/devTools.ts DEV_TOOLS_AVAILABLE); in any other build this screen
 * sends the visitor away. Opened from the entry that appears next to the
 * build number after it has been tapped seven times.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import Constants from "expo-constants";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius, MAX_CONTENT_WIDTH } from "../constants/theme";
import { API_CONFIG, APP_ENV } from "../constants/config";
import { getSession, type UserSession } from "../session";
import { APP_VERSION, BUILD_NUMBER } from "../lib/appVersion";
import { captureException, isCrashReportingActive } from "../lib/crashReporting";
import { CHECK_LIST, runDiagnostics, type CheckResult, type CheckStatus } from "../lib/diagnostics";
import {
  DEMO_DELIVERY_OTP,
  DEMO_PICKUP_CODE,
  DEMO_SCENARIOS,
  describeDemo,
  isDemoLive,
  type DemoScenario,
} from "../lib/demoDelivery";
import {
  DEMO_ORDER_DELAY_MS,
  DEV_TOOLS_AVAILABLE,
  cancelDemoDelivery,
  clearDemoSession,
  getDemoDelivery,
  loadDemoSession,
  saveDemoSession,
  sendTestNotification,
  setDevToolsEnabled,
  startDemoDelivery,
} from "../lib/devTools";
import { isSupabaseConfigured } from "../lib/supabase";

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

const STATUS_STYLE: Record<CheckStatus, { icon: IconName; color: string }> = {
  pass: { icon: "check-circle", color: Colors.success },
  warn: { icon: "alert", color: Colors.warning },
  fail: { icon: "close-circle", color: Colors.danger },
  skip: { icon: "minus-circle-outline", color: Colors.textMuted },
};

const DEVICE_LABEL =
  Platform.OS === "android"
    ? `Android (API ${Platform.Version})`
    : Platform.OS === "ios"
      ? `iOS ${Platform.Version}`
      : Platform.OS;

const extra = (Constants.expoConfig?.extra ?? {}) as { googleMapsApiKey?: string; eas?: { projectId?: string } };

/** Rendering this throws, which is the point: it shows the app's crash screen. */
function CrashNow(): ReactNode {
  throw new Error("Test crash from the developer tools");
}

export default function DevToolsScreen() {
  const router = useRouter();

  const [session, setSession] = useState<UserSession | null>(null);
  const [results, setResults] = useState<Record<string, CheckResult>>({});
  const [running, setRunning] = useState(false);
  const [scenario, setScenario] = useState<DemoScenario>("cod_upi");
  const [starting, setStarting] = useState(false);
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const [savedLogin, setSavedLogin] = useState<{ name: string; phone?: string; expiresAt: number } | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [crash, setCrash] = useState(false);
  // Redraws the demo order's status line once a second.
  const [, setTick] = useState(0);
  const mountedRef = useRef(true);

  const refreshSavedLogin = useCallback(async () => {
    const s = await loadDemoSession();
    if (mountedRef.current) setSavedLogin(s ? { name: s.user.name, phone: s.user.phone, expiresAt: s.expiresAt } : null);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!DEV_TOOLS_AVAILABLE) {
      router.replace("/");
      return;
    }
    void getSession().then((s) => {
      if (mountedRef.current) setSession(s?.token && !s.needsSignupCompletion ? s : null);
    });
    void refreshSavedLogin();
    const ticker = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(ticker);
    };
  }, [router, refreshSavedLogin]);

  const runChecks = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setResults({});
    try {
      await runDiagnostics(
        (result) => setResults((prev) => ({ ...prev, [result.id]: result })),
        () => !mountedRef.current
      );
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, [running]);

  const simulate = useCallback(async () => {
    if (starting) return;
    setStarting(true);
    setDemoNote(null);
    try {
      const res = await startDemoDelivery(scenario);
      if (!mountedRef.current) return;
      if (!res.ok) Alert.alert("Demo order not started", res.reason);
      else if (res.notification) setDemoNote(`No notification will be shown: ${res.notification}`);
    } finally {
      if (mountedRef.current) setStarting(false);
    }
  }, [scenario, starting]);

  const testNotification = useCallback(async () => {
    if (notifying) return;
    setNotifying(true);
    try {
      const res = await sendTestNotification(5);
      if (res.ok) Alert.alert("Test notification in 5 seconds", "Leave the app or lock the phone now to see how it arrives.");
      else Alert.alert("Couldn't send the test notification", res.reason);
    } finally {
      if (mountedRef.current) setNotifying(false);
    }
  }, [notifying]);

  const saveLogin = useCallback(async () => {
    const s = await getSession();
    if (!s?.token || s.needsSignupCompletion) {
      Alert.alert("Nothing to save", "Log in with OTP first.");
      return;
    }
    try {
      await saveDemoSession(s);
      await refreshSavedLogin();
      Alert.alert("Login saved", "After you log out, the login screen shows \"Use saved demo login\".");
    } catch {
      Alert.alert("Couldn't save this login", "Please try again.");
    }
  }, [refreshSavedLogin]);

  const forgetLogin = useCallback(async () => {
    await clearDemoSession();
    await refreshSavedLogin();
  }, [refreshSavedLogin]);

  const hideTools = useCallback(async () => {
    await setDevToolsEnabled(false);
    Alert.alert("Developer tools hidden", "Tap the build number 7 times to show them again.");
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  if (crash) return <CrashNow />;
  if (!DEV_TOOLS_AVAILABLE) return null;

  const demo = getDemoDelivery();
  const demoLive = isDemoLive(demo);
  const scenarioInfo = DEMO_SCENARIOS.find((s) => s.key === scenario);

  const savedLoginDetail = savedLogin
    ? [
        savedLogin.phone,
        `valid until ${new Date(savedLogin.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const done = Object.values(results);
  const count = (status: CheckStatus) => done.filter((r) => r.status === status).length;
  const nextCheckId = running ? CHECK_LIST.find((c) => !results[c.id])?.id : undefined;
  const summary =
    done.length === 0
      ? "Not run yet"
      : [
          `${count("pass")} passed`,
          count("warn") ? `${count("warn")} to look at` : null,
          count("fail") ? `${count("fail")} failed` : null,
          count("skip") ? `${count("skip")} skipped` : null,
        ]
          .filter(Boolean)
          .join(" · ");

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <MaterialCommunityIcons name="arrow-left" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Developer tools</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.notice}>
          <MaterialCommunityIcons name="flask-outline" size={20} color={Colors.warning} />
          <Text style={styles.noticeText}>
            Testing aids only. They exist in development and preview builds, never in the Play Store build.
          </Text>
        </View>

        <Section title="This build" card>
          <Row label="Version" value={APP_VERSION} />
          <Row label="Build number" value={BUILD_NUMBER ?? "unknown"} />
          <Row label="Environment" value={__DEV__ ? `${APP_ENV} (dev client)` : APP_ENV} />
          <Row label="Backend" value={API_CONFIG.BASE_URL.replace(/^https?:\/\//, "")} />
          <Row label="Realtime (Supabase)" value={isSupabaseConfigured ? "Configured" : "Missing from this build"} bad={!isSupabaseConfigured} />
          <Row label="Maps key" value={extra.googleMapsApiKey ? "Set" : "Missing from this build"} bad={!extra.googleMapsApiKey} />
          <Row label="Crash reporting" value={isCrashReportingActive() ? "On" : "Off"} />
          <Row label="Push project" value={extra.eas?.projectId ? `…${extra.eas.projectId.slice(-6)}` : "Not set"} bad={!extra.eas?.projectId} />
          <Row label="Phone" value={DEVICE_LABEL} last />
        </Section>

        <Section title="Login" card>
          {session ? (
            <>
              <Row label="Rider" value={session.user.name || "Unnamed"} />
              <Row label="Phone" value={session.user.phone || "Unknown"} />
              <Row label="Rider ID" value={`…${session.user.id.slice(-8)}`} />
              <Row label="Realtime session" value={session.supabaseSession ? "Yes" : "No (polling only)"} last />
            </>
          ) : (
            <Row label="Status" value="Not logged in" last />
          )}
        </Section>

        <Section title="Functional checks">
          <Text style={styles.hint}>
            Tests the connection, every screen&apos;s data, live updates, location and notifications. Nothing is
            changed on the server.
          </Text>
          <Button
            label={running ? "Running checks…" : done.length ? "Run all checks again" : "Run all checks"}
            icon="play-circle-outline"
            onPress={runChecks}
            busy={running}
          />
          <Text style={styles.summary}>{summary}</Text>
          <View style={styles.card}>
            {CHECK_LIST.map((check, index) => {
              const result = results[check.id];
              const look = result ? STATUS_STYLE[result.status] : null;
              return (
                <View key={check.id} style={[styles.checkRow, index > 0 && styles.rowDivider]}>
                  <View style={styles.checkIcon}>
                    {check.id === nextCheckId ? (
                      <ActivityIndicator size="small" color={Colors.accent} />
                    ) : (
                      <MaterialCommunityIcons
                        name={look?.icon ?? "circle-outline"}
                        size={18}
                        color={look?.color ?? Colors.borderLight}
                      />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkLabel}>{check.label}</Text>
                    {result ? <Text style={styles.checkDetail}>{result.detail}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        </Section>

        <Section title="Demo order">
          <Text style={styles.hint}>
            A pretend order that runs through the real screens: the offer on Home, accept, two pickups, the
            delivery OTP, payment and Mark Delivered. It never reaches the server. Go online on Home to see the
            offer.
          </Text>
          <View style={styles.chips}>
            {DEMO_SCENARIOS.map((s) => {
              const active = s.key === scenario;
              return (
                <TouchableOpacity
                  key={s.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setScenario(s.key)}
                  disabled={demoLive || starting}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {scenarioInfo ? <Text style={styles.hint}>{scenarioInfo.description}</Text> : null}

          <View style={styles.card}>
            <Row label="Pickup code" value={DEMO_PICKUP_CODE} />
            <Row label="Delivery OTP" value={DEMO_DELIVERY_OTP} />
            <Row label="Now" value={describeDemo(demo, Date.now())} last />
          </View>
          {demoNote ? <Text style={styles.warnText}>{demoNote}</Text> : null}

          {demoLive ? (
            <>
              <Button label="Go to Home" icon="home-outline" onPress={() => router.dismissTo("/(tabs)/home")} />
              <Button
                label={demo?.stage === "accepted" ? "Cancel the order (as the customer)" : "Remove the demo order"}
                icon="close-circle-outline"
                tone="danger"
                onPress={cancelDemoDelivery}
              />
            </>
          ) : (
            <Button
              label={starting ? "Starting…" : `Simulate an order (arrives in ${DEMO_ORDER_DELAY_MS / 1000} s)`}
              icon="truck-fast-outline"
              onPress={simulate}
              busy={starting}
            />
          )}
          <Text style={styles.hint}>
            Three wrong codes in a row show the &quot;try again in&quot; countdown. Cancelling after accepting shows what
            the rider sees when a customer cancels.
          </Text>
        </Section>

        <Section title="Notifications">
          <Button
            label="Send a test notification (5 s)"
            icon="bell-ring-outline"
            onPress={testNotification}
            busy={notifying}
          />
          <Text style={styles.hint}>Uses the order alert channel and the order chime.</Text>
        </Section>

        <Section title="Crash handling">
          <Button label="Show the crash screen" icon="alert-octagon-outline" tone="danger" onPress={() => setCrash(true)} />
          {isCrashReportingActive() ? (
            <Button
              label="Send a test crash report"
              icon="send-outline"
              onPress={() => {
                captureException(new Error("Test report from the developer tools"));
                Alert.alert("Sent", "Look for \"Test report from the developer tools\" in Sentry.");
              }}
            />
          ) : null}
          <Text style={styles.hint}>
            The crash screen should offer Retry and bring the app back. A report is sent only when crash reporting
            is on.
          </Text>
        </Section>

        <Section title="Saved demo login">
          <View style={styles.card}>
            <Row
              label={savedLogin ? savedLogin.name || "Saved login" : "No login saved"}
              value={savedLogin ? savedLoginDetail : "Save this login to skip OTP next time"}
              last
            />
          </View>
          <Button label="Save this login" icon="key-outline" onPress={saveLogin} />
          {savedLogin ? <Button label="Forget the saved login" icon="key-remove" tone="danger" onPress={forgetLogin} /> : null}
          <Text style={styles.hint}>
            Keeps this phone&apos;s real login so no OTP SMS is needed after logging out. Live updates fall back to
            polling after a saved login; use a real OTP login to test them.
          </Text>
        </Section>

        <Section title="Visibility">
          <View style={[styles.card, styles.switchRow]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.checkLabel}>Show developer tools</Text>
              <Text style={styles.checkDetail}>Turn off to hide this screen and its entries</Text>
            </View>
            <Switch
              value
              onValueChange={(v) => {
                if (!v) void hideTools();
              }}
              trackColor={{ false: Colors.border, true: Colors.accentLight }}
              thumbColor={Colors.accent}
              accessibilityLabel="Show developer tools"
            />
          </View>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

/** `card` wraps the children in one bordered card, for a plain list of rows. */
function Section({ title, card, children }: { title: string; card?: boolean; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {card ? <View style={styles.card}>{children}</View> : children}
    </View>
  );
}

function Row({ label, value, last, bad }: { label: string; value: string; last?: boolean; bad?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.rowBorder]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bad && { color: Colors.danger }]} selectable>
        {value}
      </Text>
    </View>
  );
}

function Button({
  label,
  icon,
  onPress,
  busy,
  tone = "primary",
}: {
  label: string;
  icon: IconName;
  onPress: () => void;
  busy?: boolean;
  tone?: "primary" | "danger";
}) {
  const color = tone === "danger" ? Colors.danger : Colors.accent;
  return (
    <TouchableOpacity
      style={[styles.button, { borderColor: color }, busy && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={busy}
      activeOpacity={0.8}
      accessibilityRole="button"
    >
      {busy ? <ActivityIndicator size="small" color={color} /> : <MaterialCommunityIcons name={icon} size={18} color={color} />}
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: Colors.text, fontSize: 17, fontWeight: "700" },
  scroll: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    padding: Spacing.lg,
    paddingBottom: 64,
    gap: Spacing.lg,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.warningLight,
  },
  noticeText: { flex: 1, color: Colors.text, fontSize: 13, lineHeight: 18 },
  section: { gap: Spacing.sm },
  sectionTitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.md, paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLabel: { color: Colors.textSecondary, fontSize: 13, flexShrink: 0, maxWidth: "45%" },
  rowValue: { flex: 1, color: Colors.text, fontSize: 13, fontWeight: "600", textAlign: "right" },
  hint: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  warnText: { color: Colors.danger, fontSize: 12, lineHeight: 17 },
  summary: { color: Colors.text, fontSize: 13, fontWeight: "600" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm, paddingVertical: 10 },
  rowDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  checkIcon: { width: 22, alignItems: "center", paddingTop: 1 },
  checkLabel: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  checkDetail: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentLight },
  chipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: Colors.accentDark },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    minHeight: 46,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    borderWidth: 1.5,
    backgroundColor: Colors.bg,
  },
  buttonText: { fontSize: 14, fontWeight: "700", flexShrink: 1, textAlign: "center" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, paddingVertical: Spacing.md },
});

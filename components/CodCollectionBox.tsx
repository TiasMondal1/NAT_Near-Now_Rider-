import { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Image } from "react-native";
import * as Haptics from "expo-haptics";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { apiFetch } from "../constants/api";

/**
 * Doorstep payment step for a cash-on-delivery amount: show the customer a
 * Razorpay UPI QR (money goes straight to the company account — the rider
 * never handles it) or record that cash was taken. Only rendered when the
 * backend sends `cod_collection` (COD_COLLECTION_ENABLED on the server).
 */
export type CodCollection = {
  status: "none" | "awaiting" | "paid_upi" | "cash_collected";
  method?: "upi_qr" | "cash" | null;
  amount_due?: number;
  qr_image_url?: string | null;
  qr_close_by?: string | null;
  collected_at?: string | null;
};

export const isCodSettled = (c?: CodCollection | null) => c?.status === "paid_upi" || c?.status === "cash_collected";

// amount_to_collect comes back from the POSTs only; the status poll skips it.
type CodResponse = { success: boolean; amount_to_collect?: number; cod_collection: CodCollection };

const POLL_MS = 3000;

function fmtSeconds(total: number) {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function CodCollectionBox({
  orderId,
  token,
  amount,
  collection,
  onChange,
}: {
  orderId: string;
  token: string;
  amount: number;
  collection: CodCollection;
  /** Must be stable (useCallback) — it is an effect dependency. */
  onChange: (c: CodCollection) => void;
}) {
  const [busy, setBusy] = useState<"qr" | "cash" | null>(null);
  // Synchronous double-tap guard, same reason as the OTP verify button's ref.
  const busyRef = useRef(false);
  const [now, setNow] = useState(() => Date.now());
  const [imageFailed, setImageFailed] = useState(false);

  const showingQr = collection.status === "awaiting" && !!collection.qr_image_url;
  const closeByMs = collection.qr_close_by ? Date.parse(collection.qr_close_by) : 0;
  const secondsLeft = showingQr ? Math.max(0, Math.round((closeByMs - now) / 1000)) : 0;
  const expired = showingQr && secondsLeft === 0;

  // Countdown tick + payment-status poll, only while a live QR is on screen.
  useEffect(() => {
    if (!showingQr || expired) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      try {
        const res = await apiFetch<CodResponse>(`/delivery-partner/orders/${orderId}/cod`, {}, token, 0);
        if (res.cod_collection.status === "paid_upi") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        onChange(res.cod_collection);
      } catch {
        /* the next tick retries */
      }
    }, POLL_MS);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [showingQr, expired, orderId, token, onChange]);

  const run = async (kind: "qr" | "cash") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try {
      const res = await apiFetch<CodResponse>(`/delivery-partner/orders/${orderId}/cod/${kind}`, { method: "POST" }, token, 0);
      setImageFailed(false);
      setNow(Date.now());
      onChange(res.cod_collection);
      if (kind === "cash") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      // 409 on cash = the customer already paid the QR; the body says so.
      if (e?.cod_collection) onChange(e.cod_collection);
      Alert.alert(kind === "qr" ? "Couldn't show the QR" : "Couldn't record cash", e?.error || e?.message || "Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const confirmCash = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert("Cash received?", `Confirm you collected ₹${amount} in cash from the customer.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Yes, collected", onPress: () => run("cash") },
    ]);
  };

  if (collection.status === "paid_upi") {
    return (
      <View style={[styles.settledRow, { backgroundColor: Colors.success + "18" }]}>
        <MaterialCommunityIcons name="check-decagram" size={16} color={Colors.success} />
        <Text style={[styles.settledText, { color: Colors.success }]}>Paid ₹{amount} by UPI — don&apos;t take cash</Text>
      </View>
    );
  }
  if (collection.status === "cash_collected") {
    return (
      <View style={[styles.settledRow, { backgroundColor: Colors.surface }]}>
        <MaterialCommunityIcons name="cash-check" size={16} color={Colors.text} />
        <Text style={styles.settledText}>₹{amount} cash collected</Text>
      </View>
    );
  }

  const cashButton = (label: string) => (
    <TouchableOpacity
      style={[styles.secondaryBtn, busy !== null && styles.btnDisabled]}
      onPress={confirmCash}
      disabled={busy !== null}
      activeOpacity={0.8}
      accessibilityLabel={label}
    >
      {busy === "cash" ? (
        <ActivityIndicator color={Colors.text} size="small" />
      ) : (
        <>
          <MaterialCommunityIcons name="cash" size={16} color={Colors.text} />
          <Text style={styles.secondaryBtnText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );

  const qrButton = (label: string) => (
    <TouchableOpacity
      style={[styles.qrBtn, busy !== null && styles.btnDisabled]}
      onPress={() => run("qr")}
      disabled={busy !== null}
      activeOpacity={0.8}
      accessibilityLabel={label}
    >
      {busy === "qr" ? (
        <ActivityIndicator color={Colors.accentText} size="small" />
      ) : (
        <>
          <MaterialCommunityIcons name="qrcode" size={16} color={Colors.accentText} />
          <Text style={styles.qrBtnText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={styles.box}>
      <View style={styles.titleRow}>
        <MaterialCommunityIcons name="cash-register" size={16} color={Colors.accent} />
        <Text style={styles.title}>Collect ₹{amount}</Text>
      </View>

      {showingQr && !expired && !imageFailed ? (
        <View style={styles.qrWrap}>
          {/* Razorpay's image_url is a tall poster (≈674×1644) with the QR card
              centred; "cover" in a square shows just that card, large enough
              to scan. "contain" shrank the code itself to ~60dp. */}
          <Image
            source={{ uri: collection.qr_image_url! }}
            style={styles.qrImage}
            resizeMode="cover"
            onError={() => setImageFailed(true)}
            accessibilityLabel={`UPI QR code for ₹${amount}`}
          />
          <Text style={styles.qrHint}>Ask the customer to scan — ₹{amount} fills in automatically</Text>
          <View style={styles.waitingRow}>
            <ActivityIndicator size="small" color={Colors.accent} />
            <Text style={styles.waitingText}>Waiting for payment · expires in {fmtSeconds(secondsLeft)}</Text>
          </View>
          <View style={styles.actions}>{cashButton("Took cash instead")}</View>
        </View>
      ) : (
        <>
          <Text style={styles.body}>
            {expired
              ? "The QR expired. Show a new one, or take cash."
              : imageFailed
                ? "The QR didn't load. Try again, or take cash."
                : "Customer pays by UPI QR (straight to Near & Now) or in cash."}
          </Text>
          <View style={styles.actions}>
            {qrButton(expired || imageFailed ? "New QR" : "Show UPI QR")}
            {cashButton("Took cash")}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.accent,
    backgroundColor: Colors.accentLight + "22",
    gap: Spacing.sm,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { color: Colors.text, fontSize: 14, fontWeight: "800" },
  body: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  qrWrap: { alignItems: "center", gap: Spacing.sm },
  qrImage: { width: "100%", maxWidth: 300, aspectRatio: 1, backgroundColor: Colors.bg, borderRadius: BorderRadius.sm },
  qrHint: { color: Colors.text, fontSize: 13, fontWeight: "600", textAlign: "center" },
  waitingRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  waitingText: { color: Colors.textSecondary, fontSize: 12 },
  actions: { flexDirection: "row", gap: Spacing.sm, alignSelf: "stretch" },
  qrBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 46,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent,
  },
  qrBtnText: { color: Colors.accentText, fontSize: 14, fontWeight: "700" },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 46,
    borderRadius: BorderRadius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
  },
  secondaryBtnText: { color: Colors.text, fontSize: 14, fontWeight: "600" },
  btnDisabled: { opacity: 0.5 },
  settledRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: Spacing.md,
    padding: Spacing.sm,
    borderRadius: BorderRadius.sm,
  },
  settledText: { color: Colors.text, fontSize: 13, fontWeight: "700" },
});

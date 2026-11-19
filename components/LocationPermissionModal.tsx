import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";

interface Props {
  visible: boolean;
  /** The rider tapped "Allow location access": the only thing that counts as consent. */
  onAllow: () => void;
  /** "Not now" or the back button. No permission may be requested after this. */
  onDecline: () => void;
}

/**
 * Google Play's prominent disclosure for background location (User Data
 * policy). Play rejects the app unless ALL of these hold, so keep them when
 * editing:
 *  - it is shown inside the app, in normal use, and the system's "Allow all
 *    the time" request comes directly after it and never without it
 *    (home.tsx asks for the permission only from onAllow);
 *  - the wording says the app collects location data, what for, and that it
 *    happens "even when the app is closed or not in use";
 *  - consent is an explicit tap. Back, "Not now" or leaving the screen is a
 *    refusal, not consent;
 *  - it is not mixed with other disclosures (terms, login, notifications).
 */
export default function LocationPermissionModal({ visible, onAllow, onDecline }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDecline}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={st.iconWrap}>
            <MaterialCommunityIcons name="map-marker-radius" size={40} color={Colors.accent} />
          </View>
          <Text style={st.title}>Location access</Text>
          <Text style={st.body}>
            Near & Now Delivery Partner collects location data to enable live delivery tracking
            for customers and matching you with nearby order requests,{" "}
            <Text style={st.emphasis}>even when the app is closed or not in use.</Text>
          </Text>
          <Text style={st.subBody}>
            Your location is collected only while you are online or on a delivery. It stops when
            you go offline or log out.
          </Text>
          <Text style={st.subBody}>
            On the next screens, choose &quot;While using the app&quot; and then{" "}
            <Text style={st.emphasis}>&quot;Allow all the time&quot;</Text>.
          </Text>
          <TouchableOpacity
            style={st.btn}
            onPress={onAllow}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Allow location access"
          >
            <Text style={st.btnText}>Allow location access</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={st.declineBtn}
            onPress={onDecline}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Not now"
          >
            <Text style={st.declineBtnText}>Not now</Text>
          </TouchableOpacity>
          <Text style={st.footnote}>You can change this at any time in your phone&apos;s Settings.</Text>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: Colors.card,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: "center",
  },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text,
    textAlign: "center",
    marginBottom: Spacing.sm,
  },
  body: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  subBody: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: Spacing.md,
  },
  emphasis: {
    fontWeight: "700",
    color: Colors.text,
  },
  btn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.accent,
    alignItems: "center",
  },
  btnText: {
    fontSize: 15,
    fontWeight: "700",
    color: Colors.accentText,
  },
  declineBtn: {
    width: "100%",
    paddingVertical: 12,
    alignItems: "center",
    marginTop: Spacing.xs,
  },
  declineBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  footnote: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: Spacing.xs,
  },
});

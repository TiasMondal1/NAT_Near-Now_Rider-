import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";

interface Props {
  visible: boolean;
  onContinue: () => void;
}

/**
 * Shown once, right after a rider is verified, before the OS's own
 * "Allow all the time" location dialog — explains why background access is
 * needed instead of jumping straight into that system prompt with no
 * context. Purely informational: tapping "Continue" just triggers the real
 * permission request; if the rider denies it there, this modal doesn't
 * reappear (see the AsyncStorage flag in home.tsx that gates showing it).
 */
export default function LocationPermissionModal({ visible, onContinue }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={st.iconWrap}>
            <MaterialCommunityIcons name="map-marker-radius" size={40} color={Colors.accent} />
          </View>
          <Text style={st.title}>Location Access Needed</Text>
          <Text style={st.body}>
            Near & Now needs your location — including while the app is in the background — to
            share your live position with customers during a delivery and to notify you about
            nearby order requests while you&apos;re online.
          </Text>
          <Text style={st.subBody}>
            On the next screen, please select{" "}
            <Text style={st.emphasis}>&quot;Allow all the time&quot;</Text> so tracking keeps working when
            the app isn&apos;t in the foreground.
          </Text>
          <TouchableOpacity style={st.btn} onPress={onContinue} activeOpacity={0.8}>
            <Text style={st.btnText}>Continue</Text>
          </TouchableOpacity>
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
    marginBottom: Spacing.xl,
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
});

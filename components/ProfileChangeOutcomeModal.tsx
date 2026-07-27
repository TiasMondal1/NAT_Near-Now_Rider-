import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";
import { ProfileChangeOutcome } from "../lib/useProfileChangeOutcomeGate";

interface Props {
  outcome: ProfileChangeOutcome | null;
  onDismiss: () => void;
}

/**
 * Blocking acknowledgment for a reviewed profile-change request. No backdrop
 * dismiss and a no-op `onRequestClose` (Android back button) — the rider
 * can't swipe/back past it without tapping "Got it."
 */
export default function ProfileChangeOutcomeModal({ outcome, onDismiss }: Props) {
  if (!outcome) return null;

  const approved = outcome.approved;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={st.overlay}>
        <View style={st.card}>
          <View style={[st.iconWrap, { backgroundColor: approved ? Colors.successLight : Colors.dangerLight }]}>
            <Ionicons
              name={approved ? "checkmark-circle" : "close-circle"}
              size={44}
              color={approved ? Colors.success : Colors.danger}
            />
          </View>
          <Text style={st.title}>{approved ? "Profile Change Approved" : "Profile Change Rejected"}</Text>
          <Text style={st.body}>
            {approved
              ? "Your requested profile changes have been approved and are now live."
              : `Your requested changes were rejected${outcome.rejectionReason ? `: ${outcome.rejectionReason}` : "."}`}
          </Text>
          <TouchableOpacity style={st.btn} onPress={onDismiss} activeOpacity={0.8}>
            <Text style={st.btnText}>Got it</Text>
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
    marginBottom: Spacing.xl,
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

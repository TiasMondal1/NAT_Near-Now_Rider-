/**
 * Full-screen "Update Near & Now Rider" when this build is below the server's
 * minimum (lib/appUpdateGate.ts). Checked at launch and whenever the app comes
 * back to the foreground; renders nothing otherwise. (2026-11-17)
 */
import React, { useEffect, useState } from "react";
import { AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { BorderRadius, Colors, MAX_CONTENT_WIDTH, Spacing } from "../constants/theme";
import { checkAppUpdate, type UpdateRequirement } from "../lib/appUpdateGate";

export function UpdateRequiredGate() {
  const [state, setState] = useState<UpdateRequirement>({ required: false });

  useEffect(() => {
    let alive = true;
    const run = () => {
      void checkAppUpdate().then((next) => {
        if (alive) setState(next);
      });
    };
    run();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") run();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  if (!state.required) return null;
  const { message, storeUrl } = state;
  return (
    <View style={st.cover} testID="update-required">
      <View style={st.column}>
        <View style={st.iconWrap}>
          <Ionicons name="cloud-download-outline" size={36} color={Colors.accentDark} />
        </View>
        <Text style={st.title}>Update Near & Now Rider</Text>
        <Text style={st.body}>{message}</Text>
        <TouchableOpacity
          style={st.btn}
          activeOpacity={0.85}
          accessibilityRole="button"
          onPress={() => {
            Linking.openURL(storeUrl).catch(() => {});
          }}
        >
          <Text style={st.btnText}>Update now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  cover: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
    zIndex: 1000,
    elevation: 1000,
  },
  column: { width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", alignItems: "center" },
  iconWrap: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: Colors.accentLight,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
  },
  title: { fontSize: 18, fontWeight: "700", color: Colors.text, textAlign: "center", marginBottom: Spacing.sm },
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
  btnText: { fontSize: 15, fontWeight: "700", color: Colors.accentText },
});

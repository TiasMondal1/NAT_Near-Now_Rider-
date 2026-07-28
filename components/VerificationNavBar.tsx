import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Colors, Spacing, BorderRadius } from "../constants/theme";

type TabKey = "details" | "documents" | "status";

const TABS: {
  key: TabKey;
  label: string;
  icon: React.ComponentProps<typeof MaterialCommunityIcons>["name"];
  route: "/signup" | "/documents" | "/pending-verification";
}[] = [
  { key: "details", label: "Details", icon: "account-outline", route: "/signup" },
  { key: "status", label: "Status", icon: "timer-sand", route: "/pending-verification" },
  { key: "documents", label: "Documents", icon: "file-document-outline", route: "/documents" },
];

/**
 * Lets a rider who has completed signup (but isn't yet verified) freely jump
 * between their submitted details, document uploads, and verification status
 * — all 3 screens are equally reachable at this stage, none is a one-way
 * dead end. Only ever rendered post-signup (never during the initial,
 * not-yet-submitted signup form) — that gate is enforced by each screen's own
 * requireRider/session check, not by this component.
 */
export default function VerificationNavBar({ active }: { active: TabKey }) {
  const router = useRouter();
  return (
    <View style={styles.bar}>
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, isActive && styles.tabActive]}
            onPress={() => {
              if (!isActive) router.replace(tab.route);
            }}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name={tab.icon}
              size={16}
              color={isActive ? Colors.accent : Colors.textMuted}
            />
            <Text style={[styles.tabText, isActive && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: Colors.surface,
    borderRadius: BorderRadius.round,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    marginBottom: Spacing.md,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingVertical: 8,
    borderRadius: BorderRadius.round,
  },
  tabActive: { backgroundColor: Colors.accentLight },
  tabText: { fontSize: 12, fontWeight: "600", color: Colors.textMuted },
  tabTextActive: { color: Colors.accent },
});

import { Tabs } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { View, Platform, useWindowDimensions } from "react-native";
import { Colors } from "../../constants/theme";
import OfflineBanner from "../../components/OfflineBanner";

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  const iconSize = isTablet ? 28 : 24;

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.bg,
          borderTopWidth: 0,
          height: (Platform.OS === "ios" ? 88 : 68) + (isTablet ? 12 : 0),
          paddingBottom: Platform.OS === "ios" ? 28 : 10,
          paddingTop: 10,
          elevation: 0,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: -3 },
          shadowOpacity: 0.06,
          shadowRadius: 8,
        },
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarLabelStyle: {
          fontSize: isTablet ? 13 : 11,
          fontWeight: "600",
          letterSpacing: 0.3,
        },
        tabBarItemStyle: {
          gap: 2,
        },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: "Home",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "map-marker-radius" : "map-marker-radius-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="orders"
        options={{
          title: "Orders",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "clipboard-list" : "clipboard-list-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="earnings"
        options={{
          title: "Earnings",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "wallet" : "wallet-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color, focused }) => (
            <View style={focused ? { transform: [{ scale: 1.1 }] } : undefined}>
              <MaterialCommunityIcons
                name={focused ? "account-circle" : "account-circle-outline"}
                size={iconSize}
                color={color}
              />
            </View>
          ),
        }}
      />
    </Tabs>
    </View>
  );
}

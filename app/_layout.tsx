import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { Colors } from "../constants/theme";

export default function RootLayout() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.bg }}>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.bg },
          animation: "slide_from_right",
        }}
      />
    </View>
  );
}

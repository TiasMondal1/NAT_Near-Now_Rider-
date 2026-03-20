import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useRouter } from "expo-router";
import { getSession } from "../session";
import { Colors } from "../constants/theme";

export default function EntryScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(async () => {
      const session = await getSession();
      if (session?.token && session.user?.role === "delivery_partner") {
        router.replace("/(tabs)/home");
      } else {
        router.replace("/phone");
      }
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoWrap, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>N</Text>
        </View>
        <Text style={styles.brand}>NEAR & NOW</Text>
        <Text style={styles.sub}>DELIVERY PARTNER</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  logoWrap: {
    alignItems: "center",
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  iconText: {
    color: Colors.accentText,
    fontSize: 32,
    fontWeight: "800",
  },
  brand: {
    color: Colors.text,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: 4,
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 6,
    marginTop: 6,
  },
});

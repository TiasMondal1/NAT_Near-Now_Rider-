import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useRouter } from "expo-router";
import { getSession } from "../session";
import { Colors, Spacing } from "../constants/theme";

export default function EntryScreen() {
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const subtitleFade = useRef(new Animated.Value(0)).current;
  const dotsFade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }),
      ]),
      Animated.timing(subtitleFade, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(dotsFade, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(async () => {
      const session = await getSession();
      if (session?.token && session.user?.role === "delivery_partner") {
        router.replace("/(tabs)/home");
      } else {
        router.replace("/phone");
      }
    }, 1400);

    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.logoWrap, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
        <View style={styles.iconCircle}>
          <Text style={styles.iconText}>N</Text>
        </View>
        <Text style={styles.brand}>NEAR & NOW</Text>
        <Animated.View style={{ opacity: subtitleFade }}>
          <Text style={styles.sub}>DELIVERY PARTNER</Text>
        </Animated.View>
      </Animated.View>
      <Animated.View style={[styles.loadingDots, { opacity: dotsFade }]}>
        <View style={styles.dot} />
        <View style={[styles.dot, styles.dotMid]} />
        <View style={styles.dot} />
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
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.lg,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  iconText: {
    color: Colors.accentText,
    fontSize: 36,
    fontWeight: "800",
  },
  brand: {
    color: Colors.text,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: 5,
  },
  sub: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 6,
    marginTop: 6,
  },
  loadingDots: {
    flexDirection: "row",
    gap: 8,
    marginTop: Spacing.xxl,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    opacity: 0.3,
  },
  dotMid: {
    opacity: 0.6,
  },
});

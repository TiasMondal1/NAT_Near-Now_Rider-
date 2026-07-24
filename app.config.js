const withAbiSplits = require("./plugins/withAbiSplits");
const withReleaseBuild = require("./plugins/withReleaseBuild");
const withTabletSupport = require("./plugins/withTabletSupport");

module.exports = () => {
  const googleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    "";

  return {
    expo: {
      name: "Near & Now Delivery Partner",
      slug: "nearandnow-delivery",
      scheme: "nearandnow-delivery",
      version: "1.0.0",
      orientation: "portrait",
      icon: "./Rider_Logo_nearNow.png",
      userInterfaceStyle: "dark",
      newArchEnabled: true,
      splash: {
        image: "./Rider_Logo_nearNow.png",
        resizeMode: "contain",
        backgroundColor: "#000000",
      },
      ios: {
        supportsTablet: false,
        // Location usage strings now come from the expo-location plugin config
        // below (locationAlwaysPermission / locationWhenInUsePermission /
        // locationAlwaysAndWhenInUsePermission) — it also sets
        // NSLocationAlwaysAndWhenInUseUsageDescription, the modern key iOS
        // actually prompts with; the two hardcoded strings that used to live
        // here duplicated (and drifted from) those.
        config: {
          googleMapsApiKey,
        },
      },
      android: {
        icon: "./Rider_Logo_nearNow.png",
        edgeToEdgeEnabled: true,
        package: "com.nearandnow.rider",
        versionCode: 2,
        config: {
          googleMaps: {
            apiKey: googleMapsApiKey,
          },
        },
        permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
      },
      web: {
        favicon: "./Rider_Logo_nearNow.png",
      },
      plugins: [
        "expo-router",
        "expo-secure-store",
        withAbiSplits,
        withReleaseBuild,
        withTabletSupport,
        [
          "expo-location",
          {
            locationAlwaysAndWhenInUsePermission:
              "Allow Near & Now to use your location for delivery tracking, even while the app is in the background during an active delivery.",
            locationAlwaysPermission:
              "Near & Now uses your location in the background so dispatch can keep tracking your delivery when your phone is locked.",
            locationWhenInUsePermission:
              "We need your location to show your position on the map and update delivery status.",
            isIosBackgroundLocationEnabled: true,
            isAndroidBackgroundLocationEnabled: true,
            isAndroidForegroundServiceEnabled: true,
          },
        ],
        [
          "expo-notifications",
          {
            icon: "./Rider_Logo_nearNow.png",
            color: "#000000",
            defaultChannel: "orders_v2",
            sounds: ["./assets/sounds/order_chime.wav"],
          },
        ],
      ],
      extra: {
        apiBaseUrl:
          process.env.EXPO_PUBLIC_API_BASE_URL ||
          "https://near-and-now-backend.vercel.app",
        apiProxyTarget: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3000",
        supabaseUrl:
          process.env.EXPO_PUBLIC_SUPABASE_URL ||
          process.env.VITE_SUPABASE_URL ||
          "",
        supabaseAnonKey:
          process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
          process.env.VITE_SUPABASE_ANON_KEY ||
          "",
        googleMapsApiKey,
      },
    },
  };
};

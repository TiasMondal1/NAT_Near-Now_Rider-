module.exports = () => {
  const googleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    "";

  return {
    expo: {
      name: "nearandnow-delivery",
      slug: "nearandnow-delivery",
      scheme: "nearandnow-delivery",
      version: "1.0.0",
      orientation: "portrait",
      icon: "./assets/icon.png",
      userInterfaceStyle: "dark",
      newArchEnabled: true,
      splash: {
        backgroundColor: "#000000",
      },
      ios: {
        supportsTablet: false,
        infoPlist: {
          NSLocationWhenInUseUsageDescription:
            "We need your location to show your position on the map and update delivery status.",
          NSLocationAlwaysUsageDescription:
            "We need your location to track deliveries.",
        },
        config: {
          googleMapsApiKey,
        },
      },
      android: {
        adaptiveIcon: {
          backgroundColor: "#000000",
        },
        edgeToEdgeEnabled: true,
        package: "com.nearandnow.delivery",
        config: {
          googleMaps: {
            apiKey: googleMapsApiKey,
          },
        },
        permissions: ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"],
      },
      web: {
        favicon: "./assets/favicon.png",
      },
      plugins: [
        "expo-router",
        [
          "expo-location",
          {
            locationAlwaysAndWhenInUsePermission:
              "Allow Near & Now to use your location for delivery tracking.",
          },
        ],
      ],
      extra: {
        apiBaseUrl:
          process.env.EXPO_PUBLIC_API_BASE_URL ||
          "https://near-and-now-frontend.vercel.app",
        apiProxyTarget: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3000",
        supabaseUrl:
          process.env.EXPO_PUBLIC_SUPABASE_URL ||
          process.env.VITE_SUPABASE_URL ||
          "",
        supabaseAnonKey:
          process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
          process.env.VITE_SUPABASE_ANON_KEY ||
          "",
        supabaseServiceRoleKey:
          process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
          process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
          "",
        googleMapsApiKey,
      },
    },
  };
};

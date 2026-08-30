const fs = require("fs");
const path = require("path");
const withAbiSplits = require("./plugins/withAbiSplits");
const withReleaseBuild = require("./plugins/withReleaseBuild");
const withTabletSupport = require("./plugins/withTabletSupport");

// This app's android/ directory is gitignored (managed workflow — EAS Build
// runs `expo prebuild` fresh from this config every time), so referencing a
// googleServicesFile path that doesn't exist yet would make prebuild throw
// ("Cannot copy google-services.json ... Ensure the source and destination
// paths exist", @expo/config-plugins android/GoogleServices.js) and fail
// every build, not just leave push notifications broken. Guard it so the
// field only activates once the real file (from Firebase console — see
// FCM_PUSH_NOTIFICATIONS_SETUP.md) is actually placed here.
//
// EAS Build only uploads git-tracked files, and this file is (deliberately)
// gitignored — so a cloud build never sees the local copy even when one
// sits in this folder. An EAS "file" environment variable
// (GOOGLE_SERVICES_JSON) is EAS's documented answer: it's synced into the
// build regardless of gitignore, and EAS points this env var at wherever it
// placed the file on the build machine. Prefer that path; fall back to the
// local file for local builds where no such env var exists. Same fix as
// nearandnowcustomerapp/app.config.js.
const googleServicesFilePath =
  process.env.GOOGLE_SERVICES_JSON || path.join(__dirname, "google-services.json");
const hasGoogleServicesFile = fs.existsSync(googleServicesFilePath);

module.exports = () => {
  const googleMapsApiKey =
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    "";
  // No EAS project was ever linked for this app until 2026-08-25 (confirmed
  // via `eas credentials -p android` reporting "EAS project not configured")
  // — with no projectId anywhere, getExpoPushTokenAsync() (called with no
  // args in app/_layout.tsx) had nothing to resolve, so push registration
  // failed client-side before ever reaching the backend, for every install.
  // Hardcoded fallback (not just env-sourced), same pattern as
  // near-now-store_owner/app.config.js and nearandnowcustomerapp/app.config.js
  // — EAS can't auto-write this into a dynamic (.js) config, and it
  // shouldn't depend on a particular environment having the env var set.
  const easProjectId =
    process.env.EAS_PROJECT_ID ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    "bd2f649f-9fbb-474d-a874-0834afea48a9";

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
        backgroundColor: "#FFFFFF",
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
        // Firebase Android config for this app (package com.nearandnow.rider)
        // in the Firebase console — required for getExpoPushTokenAsync() to work
        // on Android at all. Without it, FCM never initializes natively and push
        // registration silently fails (token-failed) even though everything else
        // looks configured. Only set once the file actually exists — see guard
        // comment above.
        // Use the resolved path directly (not a hardcoded relative string):
        // when it comes from EAS's GOOGLE_SERVICES_JSON file env var it's an
        // absolute path elsewhere on the build machine.
        ...(hasGoogleServicesFile ? { googleServicesFile: googleServicesFilePath } : {}),
        versionCode: 6,
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
        eas: {
          ...(easProjectId ? { projectId: easProjectId } : {}),
        },
      },
    },
  };
};

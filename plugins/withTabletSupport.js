/**
 * Expo config plugin — declares Android large-screen / tablet support so
 * Play Console does not treat the app as phone-only.
 *
 * Adds <supports-screens> for all sizes and marks the main activity as
 * resizable. Survives `expo prebuild --clean`.
 */
const {
  withAndroidManifest,
  AndroidConfig,
} = require("@expo/config-plugins");

function ensureSupportsScreens(manifest) {
  if (!manifest.manifest["supports-screens"]) {
    manifest.manifest["supports-screens"] = [{}];
  }
  const screens = manifest.manifest["supports-screens"][0].$ || {};
  manifest.manifest["supports-screens"][0].$ = {
    ...screens,
    "android:smallScreens": "true",
    "android:normalScreens": "true",
    "android:largeScreens": "true",
    "android:xlargeScreens": "true",
    "android:anyDensity": "true",
    "android:resizeable": "true",
  };
  return manifest;
}

function ensureResizableMainActivity(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const activities = app.activity || [];
  for (const activity of activities) {
    const name = activity.$?.["android:name"] || "";
    if (name === ".MainActivity" || name.endsWith(".MainActivity")) {
      activity.$ = activity.$ || {};
      activity.$["android:resizeableActivity"] = "true";
      // Keep portrait as default UX but allow size/density changes on tablets.
      const configChanges = activity.$["android:configChanges"] || "";
      const required = ["screenSize", "screenLayout", "smallestScreenSize", "density"];
      const parts = new Set(
        configChanges
          .split("|")
          .map((p) => p.trim())
          .filter(Boolean)
      );
      for (const flag of required) parts.add(flag);
      activity.$["android:configChanges"] = Array.from(parts).join("|");
    }
  }
  return manifest;
}

module.exports = function withTabletSupport(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = ensureSupportsScreens(mod.modResults);
    mod.modResults = ensureResizableMainActivity(mod.modResults);
    return mod;
  });
};

/**
 * Expo config plugin — declares full large-screen/tablet support in the
 * generated AndroidManifest.xml after every `expo prebuild --clean`.
 *
 * Without this, expo prebuild's default manifest omits <supports-screens>,
 * which is normally fine, but Play Console's tablet-compatibility check also
 * wants an explicit, non-required touchscreen feature so devices without a
 * touchscreen (tablets used with mouse/keyboard, Chromebooks) aren't filtered
 * out of the tablet listing.
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

function ensureOptionalHardwareFeatures(manifest) {
  const usesFeature = manifest.manifest["uses-feature"] || [];
  const addNotRequired = (name) => {
    if (usesFeature.some((f) => f?.$?.["android:name"] === name)) return;
    usesFeature.push({
      $: { "android:name": name, "android:required": "false" },
    });
  };
  // The locked `android:screenOrientation="portrait"` on MainActivity makes
  // the build tools imply a *required* android.hardware.screen.portrait
  // feature, which the Play Store uses to filter out landscape-primary
  // tablets/Chromebooks/foldables. Override it to not-required so the app
  // stays portrait-locked in the UI without excluding those devices.
  addNotRequired("android.hardware.touchscreen");
  addNotRequired("android.hardware.screen.portrait");
  manifest.manifest["uses-feature"] = usesFeature;
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
      const required = [
        "screenSize",
        "screenLayout",
        "smallestScreenSize",
        "density",
      ];
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
    mod.modResults = ensureOptionalHardwareFeatures(mod.modResults);
    mod.modResults = ensureResizableMainActivity(mod.modResults);
    return mod;
  });
};

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
const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withTabletSupport(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;

    manifest["supports-screens"] = [
      {
        $: {
          "android:smallScreens": "true",
          "android:normalScreens": "true",
          "android:largeScreens": "true",
          "android:xlargeScreens": "true",
          "android:anyDensity": "true",
          "android:resizeable": "true",
        },
      },
    ];

    const usesFeature = manifest["uses-feature"] || [];
    const addNotRequired = (name) => {
      if (usesFeature.some((f) => f?.$?.["android:name"] === name)) return;
      usesFeature.push({ $: { "android:name": name, "android:required": "false" } });
    };
    // The locked `android:screenOrientation="portrait"` on MainActivity makes
    // the build tools imply a *required* android.hardware.screen.portrait
    // feature, which the Play Store uses to filter out landscape-primary
    // tablets/Chromebooks/foldables. Override it to not-required so the app
    // stays portrait-locked in the UI without excluding those devices.
    addNotRequired("android.hardware.touchscreen");
    addNotRequired("android.hardware.screen.portrait");
    manifest["uses-feature"] = usesFeature;

    return mod;
  });
};

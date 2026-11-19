/**
 * Expo config plugin — strips expo-audio's two foreground services and the
 * media-playback foreground-service permission from the final Android
 * manifest. (Same plugin as near-now-store_owner, 2026-11-19.)
 *
 * expo-audio's own manifest always declares AudioControlsService
 * (foregroundServiceType mediaPlayback, + FOREGROUND_SERVICE_MEDIA_PLAYBACK)
 * and AudioRecordingService (microphone). This app only plays the order ring
 * (lib/orderRing.ts): it never calls setActiveForLockScreen (the only path
 * that starts AudioControlsService) and never records. `blockedPermissions`
 * in app.config.js removes the permissions but not the <service> entries;
 * left in, Google Play asks for a foreground-service declaration with a demo
 * video for each type, which this app cannot truthfully give.
 */
const { withAndroidManifest } = require("@expo/config-plugins");

const TOOLS_NS = "http://schemas.android.com/tools";
const SERVICES = [
  "expo.modules.audio.service.AudioControlsService",
  "expo.modules.audio.service.AudioRecordingService",
];
const PERMISSIONS = ["android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK"];

/** Apply to a parsed AndroidManifest (exported for scripts/check-audio-services.mjs). Idempotent. */
function removeAudioForegroundServices(manifest) {
  manifest.manifest.$["xmlns:tools"] = manifest.manifest.$["xmlns:tools"] || TOOLS_NS;

  let perms = manifest.manifest["uses-permission"] || [];
  for (const name of PERMISSIONS) {
    perms = perms.filter((p) => p.$?.["android:name"] !== name);
    perms.push({ $: { "android:name": name, "tools:node": "remove" } });
  }
  manifest.manifest["uses-permission"] = perms;

  const app = manifest.manifest.application?.[0];
  if (app) {
    app.service = (app.service || []).filter((s) => !SERVICES.includes(s.$?.["android:name"]));
    for (const name of SERVICES) app.service.push({ $: { "android:name": name, "tools:node": "remove" } });
  }
  return manifest;
}

module.exports = function withoutAudioForegroundServices(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = removeAudioForegroundServices(mod.modResults);
    return mod;
  });
};
module.exports.removeAudioForegroundServices = removeAudioForegroundServices;

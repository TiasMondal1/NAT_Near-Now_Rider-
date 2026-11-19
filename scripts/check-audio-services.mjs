/**
 * Plain-Node checks for plugins/withoutAudioForegroundServices.js (2026-11-19):
 * expo-audio's foreground services and the media-playback permission are
 * marked for removal from the Android manifest; everything else is left alone.
 *
 *   node scripts/check-audio-services.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { removeAudioForegroundServices } = require("../plugins/withoutAudioForegroundServices.js");

const MEDIA = "android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK";
const SERVICES = ["expo.modules.audio.service.AudioControlsService", "expo.modules.audio.service.AudioRecordingService"];
const LOCATION_SERVICE = "expo.modules.location.services.LocationTaskService";

const manifest = () => ({
  manifest: {
    $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
    "uses-permission": [
      { $: { "android:name": "android.permission.INTERNET" } },
      { $: { "android:name": "android.permission.FOREGROUND_SERVICE_LOCATION" } },
      { $: { "android:name": MEDIA } },
    ],
    application: [{ $: { "android:name": ".MainApplication" }, service: [{ $: { "android:name": LOCATION_SERVICE } }] }],
  },
});

test("marks expo-audio's services and the media-playback permission for removal, once (idempotent)", () => {
  const m = removeAudioForegroundServices(removeAudioForegroundServices(manifest()));
  const perms = m.manifest["uses-permission"];
  assert.deepEqual(
    perms.filter((p) => p.$["android:name"] === MEDIA),
    [{ $: { "android:name": MEDIA, "tools:node": "remove" } }]
  );
  const services = m.manifest.application[0].service;
  for (const name of SERVICES) {
    assert.deepEqual(services.filter((s) => s.$["android:name"] === name), [{ $: { "android:name": name, "tools:node": "remove" } }]);
  }
  assert.equal(m.manifest.$["xmlns:tools"], "http://schemas.android.com/tools");
});

test("leaves the background-location service and other permissions alone", () => {
  const m = removeAudioForegroundServices(manifest());
  const perms = m.manifest["uses-permission"];
  for (const name of ["android.permission.INTERNET", "android.permission.FOREGROUND_SERVICE_LOCATION"]) {
    const p = perms.find((x) => x.$["android:name"] === name);
    assert.ok(p, `${name} kept`);
    assert.equal(p.$["tools:node"], undefined);
  }
  const loc = m.manifest.application[0].service.find((s) => s.$["android:name"] === LOCATION_SERVICE);
  assert.ok(loc);
  assert.equal(loc.$["tools:node"], undefined);
});

test("a manifest with no application block or permissions does not throw", () => {
  const m = removeAudioForegroundServices({ manifest: { $: {} } });
  assert.deepEqual(m.manifest["uses-permission"], [{ $: { "android:name": MEDIA, "tools:node": "remove" } }]);
});

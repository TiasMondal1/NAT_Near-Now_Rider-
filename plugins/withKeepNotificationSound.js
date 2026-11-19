const fs = require("fs");
const path = require("path");
const { withDangerousMod } = require("@expo/config-plugins");

/**
 * Keeps the order sound in release builds.
 *
 * Release builds shrink resources (plugins/withReleaseBuild.js), and the
 * shrinker drops anything no compiled code refers to. The order sound is
 * only ever looked up by name at runtime (expo-notifications resolves
 * "order_chime" with getIdentifier), so to the shrinker it is unused and it
 * would be replaced with an empty file: order alerts would arrive silent in
 * exactly the builds riders get. A keep file under res/raw is Android's documented
 * way to say "keep this one".
 */
module.exports = function withKeepNotificationSound(config, { sounds = ["order_chime"] } = {}) {
  return withDangerousMod(config, [
    "android",
    (cfg) => {
      const rawDir = path.join(cfg.modRequest.platformProjectRoot, "app", "src", "main", "res", "raw");
      fs.mkdirSync(rawDir, { recursive: true });
      const keep = sounds.map((name) => `@raw/${name}`).join(",");
      fs.writeFileSync(
        path.join(rawDir, "order_sound_keep.xml"),
        `<?xml version="1.0" encoding="utf-8"?>\n<resources xmlns:tools="http://schemas.android.com/tools"\n    tools:keep="${keep}" />\n`
      );
      return cfg;
    },
  ]);
};

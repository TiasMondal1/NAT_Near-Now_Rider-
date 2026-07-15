/**
 * Expo config plugin — injects ABI split APK config into the generated
 * android/app/build.gradle after every `expo prebuild --clean`.
 *
 * Without this, expo prebuild overwrites build.gradle with its default
 * template, which has no splits block, producing only one universal APK.
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

// ABI APK splits are incompatible with bundleRelease (Play AAB). Enable only for APK builds.
const SPLITS_BLOCK = `
    // Disabled automatically during bundle* tasks so AAB builds succeed.
    def isBuildingBundle = gradle.startParameter.taskNames.any { it.toLowerCase().contains("bundle") }
    splits {
        abi {
            enable !isBuildingBundle
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk true
        }
    }`;

const VERSION_CODE_OVERRIDE = `
// Unique versionCode per ABI so the Play Store accepts all splits simultaneously.
// Layout (base versionCode = N): universal=N*1000, armeabi-v7a=N*1000+1,
// arm64-v8a=N*1000+2, x86_64=N*1000+3.
android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abiVersionCodes = ["armeabi-v7a": 1, "arm64-v8a": 2, "x86_64": 3]
        def abi = output.getFilter("ABI")
        if (abi != null) {
            output.versionCodeOverride = android.defaultConfig.versionCode * 1000 + abiVersionCodes[abi]
        } else {
            output.versionCodeOverride = android.defaultConfig.versionCode * 1000
        }
    }
}`;

/**
 * Finds the closing brace of the `androidResources { }` block and inserts
 * text immediately after it (still inside the `android { }` block).
 * Uses brace counting so it handles multi-line content correctly.
 */
function insertAfterAndroidResourcesBlock(contents, toInsert) {
  const marker = "    androidResources {";
  const start = contents.lastIndexOf(marker);
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < contents.length; i++) {
    if (contents[i] === "{") depth++;
    else if (contents[i] === "}") {
      depth--;
      if (depth === 0) {
        return contents.slice(0, i + 1) + toInsert + contents.slice(i + 1);
      }
    }
  }
  return null;
}

module.exports = function withAbiSplits(config) {
  return withAppBuildGradle(config, (mod) => {
    let contents = mod.modResults.contents;

    // Upgrade older "enable true" splits so AAB builds keep working after prebuild.
    if (contents.includes("splits {") && !contents.includes("isBuildingBundle")) {
      contents = contents.replace(
        /splits \{\s*abi \{\s*enable true/,
        `def isBuildingBundle = gradle.startParameter.taskNames.any { it.toLowerCase().contains("bundle") }
    splits {
        abi {
            enable !isBuildingBundle`
      );
      mod.modResults.contents = contents;
      return mod;
    }

    // ── Idempotent: skip if already patched ──────────────────────────────────
    if (contents.includes("splits {")) return mod;

    // ── 1. Inject splits block inside android { } ────────────────────────────
    const withSplits = insertAfterAndroidResourcesBlock(contents, SPLITS_BLOCK);
    if (withSplits) {
      contents = withSplits;
    } else {
      console.warn("[withAbiSplits] Could not find androidResources block — splits not injected.");
    }

    // ── 2. Inject versionCodeOverride block after android { } ────────────────
    if (!contents.includes("versionCodeOverride")) {
      const anchor = contents.match(/\n(\/\/ Apply static values|dependencies \{)/);
      if (anchor) {
        const pos = anchor.index;
        contents = contents.slice(0, pos) + "\n" + VERSION_CODE_OVERRIDE + "\n" + contents.slice(pos);
      } else {
        contents += "\n" + VERSION_CODE_OVERRIDE + "\n";
      }
    }

    mod.modResults.contents = contents;
    return mod;
  });
};

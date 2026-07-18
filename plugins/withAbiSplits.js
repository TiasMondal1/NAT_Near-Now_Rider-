/**
 * Expo config plugin — injects ABI split APK config into the generated
 * android/app/build.gradle after every `expo prebuild --clean`.
 *
 * Without this, expo prebuild overwrites build.gradle with its default
 * template, which has no splits block, producing only one universal APK.
 */
const { withAppBuildGradle } = require("@expo/config-plugins");

// ABI-split APKs are incompatible with bundleRelease in this AGP version:
// both tasks share the resource-shrinking intermediates dir, and having
// 4 shrunk-resource variants (universal + 3 ABIs) present makes
// buildReleasePreBundle fail with "Multiple shrunk-resources files found"
// (see https://issuetracker.google.com/402800800). Disable splits whenever
// a bundle task is part of this invocation so bundleRelease stays a plain,
// unsplit build; assembleRelease (run separately) still gets full ABI splits.
const SPLITS_BLOCK = `
    splits {
        // Disable ABI splits during bundle* tasks so AAB builds succeed.
        def isBundleBuild = gradle.startParameter.taskNames.any { it.toLowerCase().contains("bundle") }
        abi {
            enable !isBundleBuild
            reset()
            include "arm64-v8a", "armeabi-v7a", "x86_64"
            universalApk true
        }
    }`;

const VERSION_CODE_OVERRIDE = `
// Unique versionCode per ABI-split APK so Play can accept all splits.
// AAB / universal output keeps defaultConfig.versionCode as-is (do NOT *1000),
// otherwise Play Console sees 1000/2000/… instead of the intended code.
// ABI layout (base = N): armeabi-v7a=N*1000+1, arm64-v8a=N*1000+2, x86_64=N*1000+3.
android.applicationVariants.all { variant ->
    variant.outputs.each { output ->
        def abiVersionCodes = ["armeabi-v7a": 1, "arm64-v8a": 2, "x86_64": 3]
        def abi = output.getFilter("ABI")
        if (abi != null) {
            output.versionCodeOverride = android.defaultConfig.versionCode * 1000 + abiVersionCodes[abi]
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
    if (
      contents.includes("splits {") &&
      !contents.includes("isBundleBuild") &&
      !contents.includes("isBuildingBundle")
    ) {
      contents = contents.replace(
        /splits \{\s*abi \{\s*enable true/,
        `splits {
        def isBundleBuild = gradle.startParameter.taskNames.any { it.toLowerCase().contains("bundle") }
        abi {
            enable !isBundleBuild`
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

/**
 * Expo config plugin — configures Android release builds after every
 * `expo prebuild --clean`, which otherwise regenerates android/ from the
 * default Expo template and wipes any manual changes.
 *
 * It does three things:
 *   1. Patches android/app/build.gradle to:
 *        - load release signing credentials from android/keystore.properties
 *          (falling back to MYAPP_RELEASE_* environment variables),
 *        - add a `release` signingConfig and use it for release builds,
 *        - enable R8/ProGuard minification + resource shrinking with the
 *          optimized default ProGuard file.
 *   2. Restores the release keystore + keystore.properties into android/
 *      by copying them from the (gitignored) ./credentials directory.
 *   3. Appends hardened ProGuard keep rules to android/app/proguard-rules.pro
 *      so shrinking/obfuscation never strips runtime-reflected classes.
 */
const { withAppBuildGradle, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const SIGNING_SENTINEL = "NEARNOW_RELEASE_SIGNING";
const PROGUARD_SENTINEL = "NEARNOW_PROGUARD_RULES";

// ── build.gradle fragments ────────────────────────────────────────────────────
const SIGNING_LOADER = `

// ${SIGNING_SENTINEL}: load release signing credentials from android/keystore.properties
// (gitignored). Falls back to environment variables (useful for CI) when absent.
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
def resolveSigningProp = { String key ->
    keystoreProperties[key] ?: System.getenv(key)
}
def hasReleaseKeystore = resolveSigningProp("MYAPP_RELEASE_STORE_FILE") != null`;

const SIGNING_CONFIGS_FROM = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;

const SIGNING_CONFIGS_TO = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (hasReleaseKeystore) {
                storeFile file(resolveSigningProp("MYAPP_RELEASE_STORE_FILE"))
                storePassword resolveSigningProp("MYAPP_RELEASE_STORE_PASSWORD")
                keyAlias resolveSigningProp("MYAPP_RELEASE_KEY_ALIAS")
                keyPassword resolveSigningProp("MYAPP_RELEASE_KEY_PASSWORD")
                enableV1Signing true
                enableV2Signing true
            }
        }
    }`;

const RELEASE_BUILDTYPE_FROM = `        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android.txt"), "proguard-rules.pro"
            def enablePngCrunchInRelease = findProperty('android.enablePngCrunchInReleaseBuilds') ?: 'true'
            crunchPngs enablePngCrunchInRelease.toBoolean()
        }`;

const RELEASE_BUILDTYPE_TO = `        release {
            // Use the real release keystore when configured (android/keystore.properties
            // or MYAPP_RELEASE_* env vars); otherwise fall back to debug signing so that
            // local/CI builds without credentials still succeed.
            signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug
            // shrinkResources requires minifyEnabled, so gate it on the same flag.
            shrinkResources enableMinifyInReleaseBuilds && (findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'true').toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
            def enablePngCrunchInRelease = findProperty('android.enablePngCrunchInReleaseBuilds') ?: 'true'
            crunchPngs enablePngCrunchInRelease.toBoolean()
        }`;

const PROGUARD_RULES = `
# ─────────────────────────────────────────────────────────────────────────────
# ${PROGUARD_SENTINEL} — Near & Now R8/ProGuard keep rules for the release build.
# Prevents shrinking/obfuscation from removing classes that React Native,
# Hermes and the native modules resolve reflectively at runtime.
# ─────────────────────────────────────────────────────────────────────────────

# --- React Native core / JNI / Hermes -----------------------------------------
-keep,includedescriptorclasses class com.facebook.react.bridge.** { *; }
-keep,includedescriptorclasses class com.facebook.react.turbomodule.core.** { *; }
-keep class com.facebook.jni.** { *; }
-keep class com.facebook.hermes.** { *; }
-keep class com.facebook.react.uimanager.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keep class com.facebook.react.views.** { *; }
-keep class com.facebook.yoga.** { *; }
-dontwarn com.facebook.react.**
-dontwarn com.facebook.hermes.**
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.proguard.annotations.DoNotStripAny *;
    @com.facebook.common.internal.DoNotStrip *;
    @com.facebook.react.bridge.ReactMethod *;
}
-keepclasseswithmembers class * {
    native <methods>;
}
-keep @com.facebook.proguard.annotations.DoNotStrip class * { *; }
-keep @com.facebook.common.internal.DoNotStrip class * { *; }

# --- Expo modules --------------------------------------------------------------
-keep class expo.modules.** { *; }
-keep class expo.core.** { *; }
-keepclassmembers class * {
    @expo.modules.core.interfaces.ExpoMethod *;
}
-dontwarn expo.modules.**

# --- Kotlin / coroutines -------------------------------------------------------
-keep class kotlin.Metadata { *; }
-keepclassmembers class kotlinx.coroutines.** { volatile <fields>; }
-dontwarn kotlinx.coroutines.**
-dontwarn kotlin.**

# --- OkHttp / Okio (React Native networking) ----------------------------------
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# --- react-native-maps / Google Maps -------------------------------------------
-keep class com.google.android.gms.maps.** { *; }
-keep interface com.google.android.gms.maps.** { *; }
-keep class com.google.android.gms.common.** { *; }
-keep class com.airbnb.android.react.maps.** { *; }
-dontwarn com.google.android.gms.**

# --- gesture-handler / screens / safe-area-context -----------------------------
-keep class com.swmansion.gesturehandler.** { *; }
-keep class com.swmansion.rnscreens.** { *; }
-keep class com.th3rdwave.safeareacontext.** { *; }

# --- async-storage / netinfo ---------------------------------------------------
-keep class com.reactnativecommunity.asyncstorage.** { *; }
-keep class com.reactnativecommunity.netinfo.** { *; }

# --- Keep signatures / annotations so reflection & JSON keep working -----------
-keepattributes Signature
-keepattributes *Annotation*
-keepattributes InnerClasses
-keepattributes EnclosingMethod
-keepattributes SourceFile,LineNumberTable
`;

function applyReplacement(contents, from, to, label) {
  if (!contents.includes(from)) {
    console.warn(`[withReleaseBuild] Could not find ${label} block — skipped (Expo template may have changed).`);
    return contents;
  }
  return contents.replace(from, to);
}

function withReleaseGradle(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== "groovy") {
      console.warn("[withReleaseBuild] build.gradle is not Groovy — skipping.");
      return mod;
    }
    let { contents } = mod.modResults;

    // Idempotent: skip if already patched.
    if (contents.includes(SIGNING_SENTINEL)) return mod;

    // 1. Insert the signing-credential loader right after `def projectRoot ...`.
    const projectRootMarker = "def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()";
    if (contents.includes(projectRootMarker)) {
      contents = contents.replace(projectRootMarker, projectRootMarker + SIGNING_LOADER);
    } else {
      console.warn("[withReleaseBuild] Could not find projectRoot marker — signing loader not injected.");
    }

    // 2. Default minify to on so R8 shrinks release builds unless explicitly disabled.
    contents = applyReplacement(
      contents,
      "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: false).toBoolean()",
      "def enableMinifyInReleaseBuilds = (findProperty('android.enableMinifyInReleaseBuilds') ?: true).toBoolean()",
      "enableMinifyInReleaseBuilds default"
    );

    // 3. Add the release signingConfig.
    contents = applyReplacement(contents, SIGNING_CONFIGS_FROM, SIGNING_CONFIGS_TO, "signingConfigs");

    // 4. Rewrite the release buildType (signing + minify + shrink + optimized proguard).
    contents = applyReplacement(contents, RELEASE_BUILDTYPE_FROM, RELEASE_BUILDTYPE_TO, "release buildType");

    mod.modResults.contents = contents;
    return mod;
  });
}

function withReleaseFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const { projectRoot, platformProjectRoot: androidRoot } = cfg.modRequest;
      const appDir = path.join(androidRoot, "app");
      const credDir = path.join(projectRoot, "credentials");

      // Restore the release keystore into android/app.
      const srcKeystore = path.join(credDir, "release.keystore");
      if (fs.existsSync(srcKeystore)) {
        fs.copyFileSync(srcKeystore, path.join(appDir, "release.keystore"));
      } else {
        console.warn("[withReleaseBuild] credentials/release.keystore not found — release build will fall back to debug signing.");
      }

      // Restore keystore.properties into android/.
      const srcProps = path.join(credDir, "keystore.properties");
      if (fs.existsSync(srcProps)) {
        fs.copyFileSync(srcProps, path.join(androidRoot, "keystore.properties"));
      }

      // Append hardened ProGuard rules (idempotent).
      const proguardPath = path.join(appDir, "proguard-rules.pro");
      if (fs.existsSync(proguardPath)) {
        const current = fs.readFileSync(proguardPath, "utf8");
        if (!current.includes(PROGUARD_SENTINEL)) {
          fs.writeFileSync(proguardPath, current.trimEnd() + "\n" + PROGUARD_RULES, "utf8");
        }
      }

      return cfg;
    },
  ]);
}

module.exports = function withReleaseBuild(config) {
  config = withReleaseGradle(config);
  config = withReleaseFiles(config);
  return config;
};

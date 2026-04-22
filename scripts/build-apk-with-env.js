#!/usr/bin/env node
/**
 * Build release APK or AAB with .env loaded so EXPO_PUBLIC_* values
 * are baked into the JS bundle and native map configuration.
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const envPath = path.join(rootDir, ".env");

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf8");
  content.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) return;

    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key.startsWith("EXPO_PUBLIC_") || key.startsWith("VITE_") || key === "NODE_ENV") {
      process.env[key] = val;
    }
  });

  const apiUrl = process.env.EXPO_PUBLIC_API_BASE_URL || "";
  const supaUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || "";
  const supaKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";

  console.log("Loaded .env:");
  console.log("  EXPO_PUBLIC_API_BASE_URL      =", apiUrl || "(not set)");
  console.log("  EXPO_PUBLIC_SUPABASE_URL      =", supaUrl || "(not set)");
  console.log("  EXPO_PUBLIC_SUPABASE_ANON_KEY =", supaKey ? `${supaKey.slice(0, 20)}...` : "(not set)");
  console.log("  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY =", mapsKey ? `${mapsKey.slice(0, 8)}...` : "(not set)");
} else {
  console.warn("No .env file found. Build will continue without injected EXPO_PUBLIC_* values.");
}

process.env.NODE_ENV = process.env.NODE_ENV || "production";

const androidDir = path.join(rootDir, "android");
const isWin = process.platform === "win32";
const gradleWrapper = isWin ? "gradlew.bat" : "gradlew";
const gradle = path.join(androidDir, gradleWrapper);

const env = {
  ...process.env,
  JAVA_TOOL_OPTIONS:
    "--enable-native-access=ALL-UNNAMED --add-opens=java.base/java.lang=ALL-UNNAMED --add-opens=java.base/java.io=ALL-UNNAMED",
};

const run = (gradleArgs) => {
  if (isWin) {
    return spawnSync("cmd.exe", ["/c", gradle, ...gradleArgs], {
      cwd: androidDir,
      env,
      stdio: "inherit",
    });
  }
  return spawnSync(gradle, gradleArgs, {
    cwd: androidDir,
    env,
    stdio: "inherit",
  });
};

run(["--stop"]);

const target = (process.argv[2] || "apk").toLowerCase();
const gradleTask = target === "aab" ? "bundleRelease" : "assembleRelease";
const outputHint =
  target === "aab"
    ? "android/app/build/outputs/bundle/release/app-release.aab"
    : "android/app/build/outputs/apk/release/app-release.apk";

console.log(`Gradle task: ${gradleTask} -> ${outputHint}\n`);

const result = run([gradleTask]);

if (result.error) {
  console.error("Gradle failed to start:", result.error.message || result.error);
}

if ((result.status ?? 1) === 0) {
  console.log(`\nDone. Output: ${path.join(rootDir, outputHint)}`);
}

process.exit(result.status ?? 1);

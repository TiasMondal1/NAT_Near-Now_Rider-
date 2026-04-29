#!/usr/bin/env node
/**
 * Expo prebuild wrapper that eliminates Windows `EBUSY` lock issues by:
 *  1) Gracefully stopping Gradle daemons (gradlew --stop)
 *  2) Force-killing any remaining Java processes holding locks (Windows only)
 *  3) Removing common Gradle lock files
 *  4) Deleting the android directory with retry + backoff before Expo does
 *  5) Running `expo prebuild --platform android --clean`
 */
const path = require("path");
const fs = require("fs");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const androidDir = path.join(rootDir, "android");
const isWin = process.platform === "win32";

// ─── 1. Graceful daemon stop ──────────────────────────────────────────────────
function stopGradleDaemons() {
  const wrapper = isWin ? "gradlew.bat" : "gradlew";
  const gradle = path.join(androidDir, wrapper);
  if (!fs.existsSync(gradle)) return;

  console.log("Stopping Gradle daemons...");
  spawnSync(isWin ? "cmd.exe" : gradle, isWin ? ["/c", gradle, "--stop"] : ["--stop"], {
    cwd: androidDir,
    stdio: "inherit",
    env: process.env,
  });
}

// ─── 2. Force-kill remaining Java processes (Windows only) ───────────────────
function forceKillJavaProcesses() {
  if (!isWin) return;

  console.log("Force-killing any remaining Java/Gradle processes...");
  // /F = force, /T = kill child tree, /IM = image name
  spawnSync("taskkill", ["/F", "/T", "/IM", "java.exe"], {
    stdio: "pipe", // suppress "process not found" noise when nothing is running
  });
}

// ─── 3. Remove Gradle lock files ─────────────────────────────────────────────
function removeGradleLocks() {
  const lockPaths = [
    path.join(androidDir, ".gradle", "buildOutputCleanup", "buildOutputCleanup.lock"),
    path.join(androidDir, ".gradle", "checksums", "checksums.lock"),
    path.join(androidDir, ".gradle", "fileHashes", "fileHashes.lock"),
    path.join(androidDir, ".gradle", "gc.properties"),
  ];

  for (const p of lockPaths) {
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // Non-fatal; Gradle will recreate these.
    }
  }
}

// ─── 4. Delete android directory with retry + exponential backoff ─────────────
function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait — synchronous script, no event loop */ }
}

function rmrf(dirPath) {
  if (!fs.existsSync(dirPath)) return true;
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function deleteAndroidDirWithRetry() {
  if (!fs.existsSync(androidDir)) return;

  const delays = [500, 1000, 2000, 3000]; // ms between retries
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    if (rmrf(androidDir)) {
      console.log("android/ directory removed.");
      return;
    }
    if (attempt < delays.length) {
      const wait = delays[attempt];
      console.log(`android/ still locked — retrying in ${wait}ms... (attempt ${attempt + 1}/${delays.length})`);
      sleep(wait);
    }
  }

  console.warn(
    "WARNING: Could not delete android/ — it is still locked by another process.\n" +
    "Close Android Studio, Windows Explorer, and any antivirus real-time scan on this folder, then retry."
  );
}

// ─── 5. Run expo prebuild ─────────────────────────────────────────────────────
function runExpoPrebuild() {
  const args = ["expo", "prebuild", "--platform", "android", "--clean"];
  console.log(`Running: npx ${args.join(" ")}`);

  const result = spawnSync(isWin ? "cmd.exe" : "npx", isWin ? ["/c", "npx", ...args] : args, {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env,
  });

  return result.status ?? 1;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
stopGradleDaemons();
forceKillJavaProcesses();
sleep(800); // give the OS time to release file handles after kills
removeGradleLocks();
deleteAndroidDirWithRetry();

process.exit(runExpoPrebuild());

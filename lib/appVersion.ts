import * as Application from "expo-application";
import Constants from "expo-constants";

/**
 * The version and build number of the build that is actually installed.
 *
 * Read from the native app, not from app.config.js: Play releases get their
 * versionCode from EAS (remote, auto-incremented), so the number in the
 * config is not the one on the phone. Expo Go reports its own version, so
 * there the config values are used instead.
 */
const inExpoGo = Constants.executionEnvironment === "storeClient";
const configBuild = Constants.expoConfig?.android?.versionCode;

export const APP_VERSION: string =
  (inExpoGo ? null : Application.nativeApplicationVersion) ?? Constants.expoConfig?.version ?? "1.0.0";

export const BUILD_NUMBER: string | null =
  (inExpoGo ? null : Application.nativeBuildVersion) ?? (configBuild != null ? String(configBuild) : null);

/** e.g. "v1.0.0 (build 8)". */
export const VERSION_LABEL = BUILD_NUMBER ? `v${APP_VERSION} (build ${BUILD_NUMBER})` : `v${APP_VERSION}`;

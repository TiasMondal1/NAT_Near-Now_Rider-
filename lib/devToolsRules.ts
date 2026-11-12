/**
 * Rules for the developer tools (lib/devTools.ts), kept free of React Native
 * imports so scripts/check-dev-tools.mjs can run them in plain Node.
 */

/** Taps on the build number that switch the developer tools on. */
export const DEV_TOOLS_TAPS_TO_UNLOCK = 7;
/** A pause longer than this between taps starts the count again. */
export const DEV_TOOLS_TAP_WINDOW_MS = 2000;

/**
 * Whether this build contains developer tools at all: a dev client, or a
 * release built with EXPO_PUBLIC_ENV=preview (the EAS "preview" profile, or
 * `npm run build:apk -- --env=preview`). Every other release, production
 * included, has no entry point, however many times the build number is tapped.
 */
export function devToolsAvailable(environment: string | null | undefined, isDevBuild: boolean): boolean {
  return isDevBuild || environment === "preview";
}

export type UnlockTaps = { count: number; lastAt: number };

/** One tap on the build number. `unlocked` is true on the seventh quick tap. */
export function registerUnlockTap(prev: UnlockTaps, now: number): UnlockTaps & { unlocked: boolean } {
  const count = now - prev.lastAt > DEV_TOOLS_TAP_WINDOW_MS ? 1 : prev.count + 1;
  const unlocked = count >= DEV_TOOLS_TAPS_TO_UNLOCK;
  return { count: unlocked ? 0 : count, lastAt: now, unlocked };
}

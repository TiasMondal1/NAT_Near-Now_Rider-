/**
 * "Please update the app" — the pure decision (no React Native imports, so
 * scripts/check-update-gate.mjs runs it in plain Node). lib/appUpdateGate.ts
 * reads the `app_min_versions` row for `rider` and calls this. (2026-11-17)
 */
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.nearandnow.rider";
export const DEFAULT_UPDATE_MESSAGE =
  "This version of Near & Now Rider is out of date. Please update to keep getting delivery requests.";

export type UpdateRequirement = { required: false } | { required: true; message: string; storeUrl: string };

export type MinVersionRow = { min_build: number | null; message: string | null; store_url: string | null };

/** Below the minimum build → update. Unknown build, no row, or a 0 / missing minimum → never blocks. */
export function decideUpdate(build: number | null, row: MinVersionRow | null): UpdateRequirement {
  if (build == null || !row) return { required: false };
  const min = Number(row.min_build);
  if (!Number.isInteger(min) || min <= 0 || build >= min) return { required: false };
  return {
    required: true,
    message: row.message?.trim() || DEFAULT_UPDATE_MESSAGE,
    storeUrl: row.store_url?.trim() || PLAY_STORE_URL,
  };
}

/** A build number string (Android versionCode) → positive integer, or null. */
export function parseBuildNumber(raw: string | null | undefined): number | null {
  const n = raw == null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

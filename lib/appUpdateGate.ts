/**
 * "Please update the app" (2026-11-17): reads the `app_min_versions` row for
 * `rider` (public read; 0 asks no one) and compares the installed build.
 * Fails open: Expo Go / unknown build, Supabase not configured, a failed or
 * slow read, or a missing row never blocks the app.
 */
import * as Application from "expo-application";
import Constants from "expo-constants";

import { isSupabaseConfigured, supabase } from "./supabase";
import { decideUpdate, parseBuildNumber, type MinVersionRow, type UpdateRequirement } from "./updateDecision";

export type { UpdateRequirement } from "./updateDecision";

/** The installed binary's build number (EAS assigns it; remote versioning). null in Expo Go or when unknown. */
export function getNativeBuildNumber(): number | null {
  if (Constants.executionEnvironment === "storeClient") return null;
  try {
    return parseBuildNumber(Application.nativeBuildVersion);
  } catch {
    return null;
  }
}

const READ_TIMEOUT_MS = 8000;

/** Reads this app's minimum build and decides. Never throws. */
export async function checkAppUpdate(build: number | null = getNativeBuildNumber()): Promise<UpdateRequirement> {
  if (build == null || !isSupabaseConfigured) return { required: false };
  try {
    const read = supabase
      .from("app_min_versions")
      .select("min_build, message, store_url")
      .eq("app", "rider")
      .maybeSingle();
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS));
    const result = await Promise.race([read, timeout]);
    if (!result || result.error) return { required: false };
    return decideUpdate(build, (result.data as MinVersionRow | null) ?? null);
  } catch {
    return { required: false };
  }
}

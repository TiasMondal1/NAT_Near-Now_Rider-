import { createClient } from "@supabase/supabase-js";
import { SUPABASE_CONFIG } from "../constants/config";

/**
 * Plain anon-key client for direct-from-app Storage uploads (profile/vehicle
 * photos — see lib/storage.ts). Mirrors the shopkeeper app's lib/supabase.ts.
 * Never import SUPABASE_CONFIG.SERVICE_ROLE_KEY here or anywhere else — that
 * value is a known, already-tracked Critical issue (service-role key plumbed
 * into the client bundle via EXPO_PUBLIC_*), not something to build on top of.
 */
export const supabase = createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);

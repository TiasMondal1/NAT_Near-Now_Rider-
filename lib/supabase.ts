import { createClient } from "@supabase/supabase-js";
import { SUPABASE_CONFIG } from "../constants/config";

/**
 * Plain anon-key client for direct-from-app Storage uploads (profile/vehicle
 * photos — see lib/storage.ts). Mirrors the shopkeeper app's lib/supabase.ts.
 */
export const supabase = createClient(SUPABASE_CONFIG.URL, SUPABASE_CONFIG.ANON_KEY);

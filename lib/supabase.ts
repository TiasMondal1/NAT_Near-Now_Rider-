import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_CONFIG } from "../constants/config";

/**
 * False when the build was made without EXPO_PUBLIC_SUPABASE_URL /
 * EXPO_PUBLIC_SUPABASE_ANON_KEY. createClient() throws on an empty URL or
 * key, and this module is imported by Home, so such a build used to crash on
 * launch. It now starts and runs on polling alone: Realtime is skipped
 * (lib/riderRealtimeAuth.ts) and photo uploads report a clear error
 * (lib/storage.ts).
 */
export const isSupabaseConfigured = !!SUPABASE_CONFIG.URL && !!SUPABASE_CONFIG.ANON_KEY;

/**
 * The single Supabase client for this app.
 *
 * Used for (a) Realtime subscriptions on the rider's own rows, authorised by
 * the backend-minted bridge session that lib/riderRealtimeAuth.ts restores
 * onto this client, and (b) profile-photo uploads via uploadToSignedUrl
 * (lib/storage.ts), which are authorised by a backend-issued token, not RLS —
 * so it no longer matters that this client carries an `authenticated` role
 * after setSession(). home.tsx and pending-verification.tsx used to create
 * their own clients to dodge that RLS issue; three GoTrue instances each
 * rotating the same single-use refresh token invalidated each other.
 *
 * Session persistence is handled by riderRealtimeAuth (SecureStore), so
 * GoTrue's own storage is disabled.
 *
 * When unconfigured the client points at a placeholder host and is never
 * used for a request; check `isSupabaseConfigured` first.
 */
export const supabase = createClient(
  isSupabaseConfigured ? SUPABASE_CONFIG.URL : "https://supabase-not-configured.invalid",
  isSupabaseConfigured ? SUPABASE_CONFIG.ANON_KEY : "supabase-not-configured",
  {
    auth: {
      persistSession: false,
      autoRefreshToken: isSupabaseConfigured,
      detectSessionInUrl: false,
    },
  }
);

// supabase-js only refreshes tokens while it believes the app is in the
// foreground; wire that to React Native's AppState as the docs recommend.
if (isSupabaseConfigured) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

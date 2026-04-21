/**
 * Application Configuration
 * Centralized access to environment variables and API keys
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: process.env.EXPO_PUBLIC_API_BASE_URL || "http://192.168.1.117:3001",
  PROXY_TARGET: process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3000",
} as const;

// Supabase Configuration
export const SUPABASE_CONFIG = {
  URL: process.env.EXPO_PUBLIC_SUPABASE_URL || "",
  ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "",
  SERVICE_ROLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY || "",
} as const;

// Google Maps Configuration
export const GOOGLE_MAPS_CONFIG = {
  API_KEY: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "",
} as const;

// Razorpay Configuration
export const RAZORPAY_CONFIG = {
  KEY_ID: process.env.RAZORPAY_KEY_ID || "",
} as const;

// Validation helper
export const validateConfig = () => {
  const errors: string[] = [];

  if (!SUPABASE_CONFIG.URL) errors.push("EXPO_PUBLIC_SUPABASE_URL is missing");
  if (!SUPABASE_CONFIG.ANON_KEY) errors.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is missing");
  if (!GOOGLE_MAPS_CONFIG.API_KEY) errors.push("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing");

  if (errors.length > 0) {
    console.warn("⚠️ Configuration warnings:", errors.join(", "));
  }

  return errors.length === 0;
};

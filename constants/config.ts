import Constants from "expo-constants";

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;

const normalizeUrl = (value: string) => value.replace(/\/+$/, "");

const defaultApiBase = "https://near-and-now-backend.vercel.app";

// API Configuration
export const API_CONFIG = {
  BASE_URL: normalizeUrl(
    process.env.EXPO_PUBLIC_API_BASE_URL ||
      extra.apiBaseUrl ||
      defaultApiBase
  ),
  PROXY_TARGET:
    process.env.VITE_API_PROXY_TARGET || extra.apiProxyTarget || "http://127.0.0.1:3000",
} as const;

// Supabase Configuration
export const SUPABASE_CONFIG = {
  URL: normalizeUrl(
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      extra.supabaseUrl ||
      ""
  ),
  ANON_KEY:
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    extra.supabaseAnonKey ||
    "",
  SERVICE_ROLE_KEY:
    process.env.EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY ||
    extra.supabaseServiceRoleKey ||
    "",
} as const;

// Google Maps Configuration
export const GOOGLE_MAPS_CONFIG = {
  API_KEY:
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    extra.googleMapsApiKey ||
    "",
} as const;

// Razorpay Configuration
export const RAZORPAY_CONFIG = {
  KEY_ID: process.env.RAZORPAY_KEY_ID || extra.razorpayKeyId || "",
} as const;

interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Validation helper
export const validateConfig = (): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!API_CONFIG.BASE_URL) {
    errors.push("EXPO_PUBLIC_API_BASE_URL is missing");
  } else if (!/^https?:\/\//.test(API_CONFIG.BASE_URL)) {
    errors.push("EXPO_PUBLIC_API_BASE_URL must start with http:// or https://");
  }

  if (!SUPABASE_CONFIG.URL) errors.push("EXPO_PUBLIC_SUPABASE_URL is missing");
  if (!SUPABASE_CONFIG.ANON_KEY) errors.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is missing");
  if (!GOOGLE_MAPS_CONFIG.API_KEY) warnings.push("EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing");

  if (SUPABASE_CONFIG.URL && !SUPABASE_CONFIG.URL.includes("supabase.co")) {
    warnings.push("EXPO_PUBLIC_SUPABASE_URL does not look like a Supabase URL");
  }

  if (errors.length > 0) {
    console.error("Environment validation failed:", errors.join("; "));
  }
  if (warnings.length > 0) {
    console.warn("Environment warnings:", warnings.join("; "));
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
};

import { apiFetch } from "../constants/api";
import {
  fetchVerificationDocuments,
  isVehicleRegistrationRequired,
  REQUIRED_DOC_KEYS,
  type VerificationDocument,
} from "./riderVerificationDocuments";

export type RiderProfileStatus =
  | "pending_verification"
  | "active"
  | "suspended"
  | "offboarded"
  | string;

export type RiderVerificationProfile = {
  status?: RiderProfileStatus | null;
  name?: string | null;
  is_online?: boolean;
  is_approved?: boolean | null;
  vehicle_type?: string | null;
  vehicle_number?: string | null;
  vehicle_image_url?: string | null;
  profile_image_url?: string | null;
  verification_submitted_at?: string | null;
};

/** All required documents (accounting for the vehicle_type-conditional vehicle_registration) have a file uploaded. */
export function areRiderDocumentsUploaded(
  documents: VerificationDocument[] | null | undefined,
  vehicleType: string | null | undefined
): boolean {
  if (!documents || documents.length === 0) return false;
  const byType = new Map(documents.map((d) => [d.doc_type, d]));
  return REQUIRED_DOC_KEYS.every((key) => {
    if (key === "vehicle_registration" && !isVehicleRegistrationRequired(vehicleType)) return true;
    return !!byType.get(key)?.url;
  });
}

/**
 * Full app access only after admin approval and docs are on file.
 * Prefer is_approved (backend source of truth); status=active is also accepted.
 */
export function isRiderVerified(
  profile: RiderVerificationProfile | null | undefined,
  documentsUploaded = false
): boolean {
  if (!documentsUploaded) return false;
  // A suspended/offboarded rider is never verified, even if is_approved was
  // left true by an older backend path — status is the authoritative
  // "may operate right now" signal.
  if (profile?.status === "suspended" || profile?.status === "offboarded") return false;
  if (profile?.is_approved === true) return true;
  return profile?.status === "active";
}

export async function fetchRiderProfile(token: string): Promise<RiderVerificationProfile | null> {
  const res = await apiFetch<{ success?: boolean; profile?: RiderVerificationProfile }>(
    "/delivery-partner/profile",
    {},
    token
  );
  return res.profile ?? null;
}

export type RiderVerificationResult = {
  verified: boolean;
  status: RiderProfileStatus;
  profile: RiderVerificationProfile | null;
  documents: VerificationDocument[];
  documentsUploaded: boolean;
  /**
   * True when the profile and/or documents request failed (network, 5xx).
   * In that case `verified`/`documentsUploaded` are NOT a real negative —
   * they only reflect what little could be fetched — and callers must not
   * redirect or cache on them. Previously every failure was folded into
   * "not verified, no documents", which bounced already-verified riders to
   * /documents on any connectivity blip.
   */
  fetchFailed: boolean;
};

/** Network error, timeout or 5xx — the server's answer is unknown. A 4xx is
 *  a real answer (e.g. "no such profile") and must not be treated as one. */
function isTransientFailure(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return typeof status !== "number" || status >= 500;
}

export async function checkRiderVerification(token: string): Promise<RiderVerificationResult> {
  let fetchFailed = false;
  let profile: RiderVerificationProfile | null = null;
  try {
    profile = await fetchRiderProfile(token);
  } catch (err) {
    if (isTransientFailure(err)) fetchFailed = true;
  }
  let documents: VerificationDocument[] = [];
  try {
    documents = await fetchVerificationDocuments(token);
  } catch (err) {
    if (isTransientFailure(err)) fetchFailed = true;
  }

  const documentsUploaded = areRiderDocumentsUploaded(documents, profile?.vehicle_type);

  return {
    verified: isRiderVerified(profile, documentsUploaded),
    status: profile?.status || "pending_verification",
    profile,
    documents,
    documentsUploaded,
    fetchFailed,
  };
}

export async function resolveAuthenticatedRoute(
  token: string,
  opts?: { forceDetailsLanding?: boolean }
): Promise<"/(tabs)/home" | "/pending-verification" | "/documents" | "/signup"> {
  const { verified, documentsUploaded, fetchFailed } = await checkRiderVerification(token);
  if (verified) return "/(tabs)/home";
  // Couldn't reach the backend: we don't know this rider's state. Land on
  // home rather than the documents-upload page — home's gate re-checks every
  // 30s / on focus and will redirect once the network is back, whereas a
  // verified rider dumped on /documents had no automatic way out.
  if (fetchFailed) return "/(tabs)/home";
  // A returning, already-signed-up rider who isn't verified yet always lands
  // on Details first (from index.tsx/_layout.tsx re-entry) — they can then
  // move freely between Details/Documents/Billing/Status via
  // VerificationNavBar. This does NOT apply to signup.tsx's own post-submit
  // redirect, which should keep moving the rider forward to Documents.
  if (opts?.forceDetailsLanding) return "/signup";
  // Docs uploaded but waiting on admin → pending. Missing docs → upload page.
  return documentsUploaded ? "/pending-verification" : "/documents";
}

import { apiFetch } from "../constants/api";
import { getSession } from "../session";

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
  verification_document?: string | null;
  verification_number?: string | null;
  aadhaar_url?: string | null;
  pan_url?: string | null;
  aadhaar_image_url?: string | null;
  pan_image_url?: string | null;
  vehicle_type?: string | null;
  registration_number?: string | null;
  vehicle_number?: string | null;
  documents_uploaded?: boolean | null;
};

export type RiderDocuments = {
  aadhaarUrl?: string | null;
  panUrl?: string | null;
  vehicleType?: string | null;
  registrationNumber?: string | null;
  raw?: unknown;
};

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return value;
  return true;
}

function pickFirst(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * Normalize whatever shape /delivery-partner/documents returns into a flat object.
 * Supports common variants: nested documents object, top-level fields, or an array.
 */
export function normalizeRiderDocuments(payload: unknown): RiderDocuments {
  const root = (payload && typeof payload === "object" ? payload : {}) as Record<string, any>;
  const docs =
    (root.documents && typeof root.documents === "object" && !Array.isArray(root.documents)
      ? root.documents
      : root.document && typeof root.document === "object"
        ? root.document
        : root) as Record<string, any>;

  let aadhaarUrl = pickFirst(
    docs.aadhaar_url,
    docs.aadhaarUrl,
    docs.aadhaar_image_url,
    docs.aadhaarImageUrl,
    docs.aadhaar
  );
  let panUrl = pickFirst(
    docs.pan_url,
    docs.panUrl,
    docs.pan_image_url,
    docs.panImageUrl,
    docs.pan
  );
  let vehicleType = pickFirst(docs.vehicle_type, docs.vehicleType);
  let registrationNumber = pickFirst(
    docs.registration_number,
    docs.registrationNumber,
    docs.vehicle_number,
    docs.vehicleNumber
  );

  const list = Array.isArray(root.documents)
    ? root.documents
    : Array.isArray(root)
      ? root
      : null;

  if (list) {
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, any>;
      const type = String(row.doc_type || row.type || row.key || "").toLowerCase();
      const url = pickFirst(row.url, row.image_url, row.imageUrl, row.file_url);
      if (type.includes("aadhaar") && url) aadhaarUrl = url;
      if (type.includes("pan") && url) panUrl = url;
      if (type.includes("vehicle")) {
        vehicleType = vehicleType || pickFirst(row.vehicle_type, row.vehicleType, row.value);
        registrationNumber =
          registrationNumber ||
          pickFirst(row.registration_number, row.registrationNumber, row.number);
      }
      if (type.includes("registration")) {
        registrationNumber = registrationNumber || pickFirst(row.url, row.value, row.number);
      }
    }
  }

  return {
    aadhaarUrl,
    panUrl,
    vehicleType,
    registrationNumber,
    raw: payload,
  };
}

/** Aadhaar + PAN images are required. Registration number required only for bike. */
export function areRiderDocumentsUploaded(
  documents: RiderDocuments | null | undefined,
  profile?: RiderVerificationProfile | null,
  locallySubmitted = false
): boolean {
  if (locallySubmitted || profile?.documents_uploaded === true) return true;

  // Backend may pack KYC into verification_document as JSON until columns exist.
  let packed: RiderDocuments | null = null;
  if (typeof profile?.verification_document === "string" && profile.verification_document.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(profile.verification_document) as Record<string, unknown>;
      if (parsed?._rider_kyc === 1) {
        packed = {
          aadhaarUrl: typeof parsed.aadhaar_image_url === "string" ? parsed.aadhaar_image_url : null,
          panUrl: typeof parsed.pan_image_url === "string" ? parsed.pan_image_url : null,
          vehicleType: typeof parsed.vehicle_type === "string" ? parsed.vehicle_type : null,
        };
        if (parsed.documents_uploaded === true) return true;
      }
    } catch {
      // ignore non-JSON legacy values
    }
  }

  const aadhaar =
    hasValue(documents?.aadhaarUrl) ||
    hasValue(packed?.aadhaarUrl) ||
    hasValue(profile?.aadhaar_url) ||
    hasValue(profile?.aadhaar_image_url);
  const pan =
    hasValue(documents?.panUrl) ||
    hasValue(packed?.panUrl) ||
    hasValue(profile?.pan_url) ||
    hasValue(profile?.pan_image_url);

  if (!aadhaar || !pan) return false;

  const vehicleType = String(
    documents?.vehicleType || packed?.vehicleType || profile?.vehicle_type || ""
  ).toLowerCase();

  if (vehicleType === "cycle" || vehicleType === "ev_scooty" || vehicleType === "ev-scooty") {
    return true;
  }

  if (vehicleType === "bike") {
    return (
      hasValue(documents?.registrationNumber) ||
      hasValue(profile?.registration_number) ||
      hasValue(profile?.vehicle_number)
    );
  }

  return true;
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

export async function fetchRiderDocuments(token: string): Promise<RiderDocuments | null> {
  try {
    const res = await apiFetch<unknown>("/delivery-partner/documents", {}, token);
    return normalizeRiderDocuments(res);
  } catch (err: any) {
    if (err?.status === 404 || err?.status === 405) return null;
    throw err;
  }
}

export async function checkRiderVerification(token: string): Promise<{
  verified: boolean;
  status: RiderProfileStatus;
  profile: RiderVerificationProfile | null;
  documents: RiderDocuments | null;
  documentsUploaded: boolean;
}> {
  const session = await getSession();
  const profile = await fetchRiderProfile(token);
  let documents: RiderDocuments | null = null;
  try {
    documents = await fetchRiderDocuments(token);
  } catch {
    documents = null;
  }

  const documentsUploaded = areRiderDocumentsUploaded(
    documents,
    profile,
    Boolean(session?.documentsSubmitted)
  );

  return {
    verified: isRiderVerified(profile, documentsUploaded),
    status: profile?.status || "pending_verification",
    profile,
    documents,
    documentsUploaded,
  };
}

export async function resolveAuthenticatedRoute(
  token: string
): Promise<"/(tabs)/home" | "/pending-verification" | "/documents"> {
  const { verified, documentsUploaded } = await checkRiderVerification(token);
  if (verified) return "/(tabs)/home";
  // Docs uploaded but waiting on admin → pending. Missing docs → upload page.
  return documentsUploaded ? "/pending-verification" : "/documents";
}

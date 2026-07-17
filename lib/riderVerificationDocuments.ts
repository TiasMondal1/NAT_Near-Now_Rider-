import { apiFetch, API_BASE } from "../constants/api";

export const REQUIRED_DOC_KEYS = [
  "aadhaar_front", "aadhaar_back",
  "pan_front", "pan_back",
  "driving_license_front", "driving_license_back",
  "vehicle_registration",
] as const;
export type RequiredDocKey = (typeof REQUIRED_DOC_KEYS)[number];

export type VehicleType = "cycle" | "e-bike" | "bike" | "scooty";

/** vehicle_registration isn't required for cycle/e-bike — mirrors the backend's isVehicleRegistrationRequired. */
export function isVehicleRegistrationRequired(vehicleType: string | null | undefined): boolean {
  return vehicleType !== "cycle" && vehicleType !== "e-bike";
}

export type DocStatus = "pending" | "approved" | "rejected" | null;

export type VerificationDocument = {
  doc_type: RequiredDocKey;
  number: string | null;
  url: string | null;
  status: DocStatus;
  rejection_reason: string | null;
  uploaded_at: string | null;
  reviewed_at: string | null;
  file_size: string | null;
};

export type PickedDocFile = { uri: string; name: string; type: string; size?: number };

/**
 * Format checks for the centrally-standardized documents — mirrors the
 * shopkeeper app / backend exactly. Driving License and Vehicle Registration
 * deliberately have no entry (state-RTO-issued, no fixed national format,
 * same treatment as Trade License on the shopkeeper side). Back-side docs
 * also have no entry — the number is on the front only.
 */
export const DOC_NUMBER_PATTERNS: Partial<Record<RequiredDocKey, RegExp>> = {
  aadhaar_front: /^[2-9][0-9]{11}$/,
  pan_front: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
};

export const DOC_NUMBER_FORMATS: Partial<Record<RequiredDocKey, { description: string; example: string }>> = {
  aadhaar_front: { description: "12 digits", example: "234567890123" },
  pan_front: { description: "5 letters + 4 digits + 1 letter (10 characters)", example: "ABCDE1234F" },
};

export function docNumberErrorMessage(docType: RequiredDocKey): string {
  const format = DOC_NUMBER_FORMATS[docType];
  if (!format) return "Invalid document number format.";
  const label = docType.replace(/_/g, " ").toUpperCase();
  return `Invalid ${label} number.\nFormat: ${format.description}\nExample: ${format.example}`;
}

export const DOC_NUMBER_LENGTHS: Partial<Record<RequiredDocKey, number>> = {
  aadhaar_front: 12,
  pan_front: 10,
};

export function validateDocNumber(docType: RequiredDocKey, number: string): boolean {
  const pattern = DOC_NUMBER_PATTERNS[docType];
  if (!pattern) return true;
  return pattern.test(number);
}

/** For a freshly picked (not yet saved) file's raw byte count — server documents already come formatted. */
export function formatPickedFileSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Fetch the caller's verification documents, each with a signed URL. */
export async function fetchVerificationDocuments(token: string): Promise<VerificationDocument[]> {
  const json = await apiFetch<{ success: boolean; documents?: VerificationDocument[] }>(
    "/delivery-partner/verification-documents",
    {},
    token
  );
  return json?.documents ?? [];
}

/**
 * Save one verification document's number and/or file. Uploads are proxied
 * through the backend (multipart) rather than direct-to-Supabase-Storage —
 * same reasoning as the shopkeeper app. Uses a raw fetch (not the shared
 * apiFetch wrapper), since apiFetch always JSON-stringifies its body and sets
 * Content-Type: application/json, which would break a multipart upload.
 */
export async function saveVerificationDocument(
  token: string,
  docType: RequiredDocKey,
  fields: { number?: string; file?: PickedDocFile }
): Promise<
  | { ok: true; document: VerificationDocument; riderSuspended: boolean }
  | { ok: false; error: string }
> {
  const form = new FormData();
  if (fields.number) form.append("number", fields.number);
  if (fields.file) {
    form.append("file", {
      uri: fields.file.uri,
      name: fields.file.name,
      type: fields.file.type,
    } as unknown as Blob);
  }

  try {
    const res = await fetch(`${API_BASE}/delivery-partner/verification-documents/${docType}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return { ok: false, error: json?.error || "Failed to save document" };
    }
    return { ok: true, document: json.document, riderSuspended: !!json.riderSuspended };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error" };
  }
}

/**
 * Delete an already-uploaded document, removing both the file and its record
 * so it can be re-uploaded from scratch. If the rider was already approved,
 * editing/removing a document sends them back for full re-verification.
 */
export async function deleteVerificationDocument(
  token: string,
  docType: RequiredDocKey
): Promise<{ ok: true; riderSuspended: boolean } | { ok: false; error: string }> {
  try {
    const json = await apiFetch<{ success: boolean; riderSuspended?: boolean; error?: string }>(
      `/delivery-partner/verification-documents/${docType}`,
      { method: "DELETE" },
      token
    );
    if (!json?.success) {
      return { ok: false, error: json?.error || "Failed to delete document" };
    }
    return { ok: true, riderSuspended: !!json.riderSuspended };
  } catch (e: any) {
    return { ok: false, error: e?.message || e?.error || "Network error" };
  }
}

/** Sets the rider's vehicle type, which drives whether vehicle_registration is required. */
export async function updateVehicleType(token: string, vehicleType: VehicleType): Promise<void> {
  await apiFetch("/delivery-partner/vehicle-type", {
    method: "PATCH",
    body: { vehicle_type: vehicleType },
  }, token);
}

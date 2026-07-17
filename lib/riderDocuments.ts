import { apiFetch } from "../constants/api";

export type VehicleType = "bike" | "cycle" | "ev_scooty";

export type PickedDocument = {
  uri: string;
  base64: string;
  mimeType: string;
};

type UploadInput = {
  token: string;
  aadhaar: PickedDocument;
  pan: PickedDocument;
  vehicleType: VehicleType;
  registrationNumber: string | null;
};

function stripDataUrl(base64: string) {
  const idx = base64.indexOf("base64,");
  return idx >= 0 ? base64.slice(idx + 7) : base64;
}

/**
 * Upload rider KYC docs via PATCH /delivery-partner/documents (base64 JSON,
 * same pattern as profile-image).
 */
export async function uploadRiderDocuments(input: UploadInput) {
  return apiFetch(
    "/delivery-partner/documents",
    {
      method: "PATCH",
      body: {
        aadhaar_image_base64: stripDataUrl(input.aadhaar.base64),
        aadhaar_mime_type: input.aadhaar.mimeType || "image/jpeg",
        pan_image_base64: stripDataUrl(input.pan.base64),
        pan_mime_type: input.pan.mimeType || "image/jpeg",
        vehicle_type: input.vehicleType,
        registration_number: input.registrationNumber,
      },
    },
    input.token,
    0
  );
}

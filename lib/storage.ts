/**
 * Supabase Storage helpers for uploading images from the app.
 *
 * Buckets used directly from the app:
 *   delivery_partner_image    – rider's own profile photo (public)
 *   delivery_partner_vehicle  – rider's vehicle photo (public)
 *
 * Both should be PUBLIC so the returned URL is directly usable in
 * <Image source={{ uri }}> without signed-URL expiry.
 *
 * Verification documents (Aadhaar, PAN, Driving License, Vehicle RC) are NOT
 * uploaded from here — that bucket (delivery-partner-documents) is private,
 * and uploads are proxied through the backend instead (see
 * lib/riderVerificationDocuments.ts), since this app has no real Supabase
 * Auth session to scope a client-side storage policy to.
 *
 * Buckets, the delivery_partners.profile_image_url/vehicle_image_url columns,
 * and the anon-key write policies these uploads rely on are created by
 * supabase/migrations/20260804000000_delivery_partner_verification_documents.sql
 * in the near-and-now repo — mirrors the shopkeeper app's
 * store-images/store-owner-images pair exactly (20260802000000).
 *
 * This supersedes the rider's previous profile-photo flow (base64 POST to
 * PATCH /delivery-partner/profile-image, writing to the rider-avatars
 * bucket) for consistency with the shopkeeper build — that old bucket is
 * left orphaned, not deleted.
 */

import { supabase } from './supabase';

type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Upload an image file from a local URI to a Supabase Storage bucket.
 * Returns the public URL on success.
 */
async function uploadImage(
  bucket: string,
  path: string,
  localUri: string,
  mimeType = 'image/jpeg'
): Promise<UploadResult> {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };

  try {
    // React Native: fetch the local file and convert to ArrayBuffer
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();

    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, arrayBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) return { ok: false, error: error.message };

    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Upload failed' };
  }
}

/** Upload the rider's own profile photo. */
export async function uploadRiderImage(
  riderId: string,
  localUri: string
): Promise<UploadResult> {
  const ext = localUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${riderId}/avatar.${ext}`;
  return uploadImage('delivery_partner_image', path, localUri);
}

/** Upload the rider's vehicle photo. */
export async function uploadVehicleImage(
  riderId: string,
  localUri: string
): Promise<UploadResult> {
  const ext = localUri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const path = `${riderId}/vehicle.${ext}`;
  return uploadImage('delivery_partner_vehicle', path, localUri);
}

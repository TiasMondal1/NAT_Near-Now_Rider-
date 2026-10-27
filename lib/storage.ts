/**
 * Uploads the rider's own profile photo.
 *
 * Bucket: delivery_partner_image (public, so the returned URL works directly
 * in <Image>).
 *
 * How (2026-10-27): the backend hands out a one-photo upload token for a fresh
 * path in this rider's own folder (POST /delivery-partner/profile-photo/upload-url);
 * the photo then goes straight to Storage with uploadToSignedUrl, which needs
 * no Storage policy. This used to upload with the anon key and `upsert: true`
 * to `<riderId>/avatar.*`, so the bucket had to let anyone write — anyone
 * holding the (public) key could overwrite any rider's photo. A new path per
 * upload means nothing is ever overwritten. Because the token, not RLS,
 * authorises the upload, it also works through a client that has been given a
 * Supabase Auth session for Realtime (see pending-verification.tsx).
 *
 * Verification documents (Aadhaar, PAN, Driving License, Vehicle RC and the
 * three vehicle photos) are NOT uploaded from here — they go through the
 * backend into the private delivery-partner-documents bucket
 * (lib/riderVerificationDocuments.ts).
 */

import { apiFetch } from '../constants/api';
import { getSession } from '../session';
import { supabase } from './supabase';

type UploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

type UploadUrl = { bucket: string; path: string; token: string; public_url: string };

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};

/** MIME type from a picker URI; extension-less content:// paths are JPEG. */
function imageMime(localUri: string): string {
  const lastSegment = localUri.split(/[?#]/)[0].split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  const ext = dot >= 0 ? lastSegment.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] ?? 'image/jpeg';
}

/** Upload the signed-in rider's profile photo. Returns its public URL. */
export async function uploadRiderImage(localUri: string): Promise<UploadResult> {
  if (!supabase) return { ok: false, error: 'Supabase not configured' };

  try {
    const session = await getSession();
    if (!session?.token) return { ok: false, error: 'Please log in again to upload your photo.' };

    // React Native: fetch the local file and convert to ArrayBuffer
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) return { ok: false, error: 'Selected image is empty or could not be read' };

    const contentType = imageMime(localUri);
    const upload = await apiFetch<UploadUrl>(
      '/delivery-partner/profile-photo/upload-url',
      { method: 'POST', body: { content_type: contentType } },
      session.token,
      0
    );

    const { error } = await supabase.storage
      .from(upload.bucket)
      .uploadToSignedUrl(upload.path, upload.token, arrayBuffer, { contentType });
    if (error) return { ok: false, error: error.message };

    return { ok: true, url: upload.public_url };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Upload failed' };
  }
}

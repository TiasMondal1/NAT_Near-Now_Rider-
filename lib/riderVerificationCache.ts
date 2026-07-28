import type { RiderVerificationProfile } from "./riderVerification";
import type { VerificationDocument } from "./riderVerificationDocuments";

/**
 * Tiny in-memory, session-lifetime cache of the last successful verification
 * check — read synchronously so a screen that already fetched this once
 * (e.g. the rider bounces Details → Status → Documents via the verification
 * nav bar) can render real content immediately instead of a blank spinner
 * while a background refresh runs. Not persisted, not a substitute for the
 * real fetch — just avoids re-showing "loading" for data we already have.
 */
export type CachedRiderVerification = {
  profile: RiderVerificationProfile | null;
  documents: VerificationDocument[];
  documentsUploaded: boolean;
  verified: boolean;
};

let cache: CachedRiderVerification | null = null;

export function peekRiderVerification(): CachedRiderVerification | null {
  return cache;
}

export function setRiderVerificationCache(result: CachedRiderVerification): void {
  cache = result;
}

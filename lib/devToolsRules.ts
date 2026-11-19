/**
 * Rules for the developer tools (lib/devTools.ts), kept free of React Native
 * imports so scripts/check-dev-tools.mjs can run them in plain Node.
 */

/** Taps on the build number that switch the developer tools on. */
export const DEV_TOOLS_TAPS_TO_UNLOCK = 7;
/** A pause longer than this between taps starts the count again. */
export const DEV_TOOLS_TAP_WINDOW_MS = 2000;

/**
 * Whether this build contains developer tools at all: a dev client, or a
 * release built with EXPO_PUBLIC_ENV=preview (the EAS "preview" profile, or
 * `npm run build:apk -- --env=preview`). Every other release, production
 * included, has no entry point, however many times the build number is tapped.
 */
export function devToolsAvailable(environment: string | null | undefined, isDevBuild: boolean): boolean {
  return isDevBuild || environment === "preview";
}

export type UnlockTaps = { count: number; lastAt: number };

/** One tap on the build number. `unlocked` is true on the seventh quick tap. */
export function registerUnlockTap(prev: UnlockTaps, now: number): UnlockTaps & { unlocked: boolean } {
  const count = now - prev.lastAt > DEV_TOOLS_TAP_WINDOW_MS ? 1 : prev.count + 1;
  const unlocked = count >= DEV_TOOLS_TAPS_TO_UNLOCK;
  return { count: unlocked ? 0 : count, lastAt: now, unlocked };
}

// ─── Password ────────────────────────────────────────────────────────────────

/**
 * The seventh tap asks for a password before the tools switch on. Only its
 * salted SHA-256 is kept here: this repository is public, and a build's
 * JavaScript can be read out of the APK, so the password itself must not
 * appear in the code, the tests or the docs. To change it:
 *   node -e "console.log(require('crypto').createHash('sha256').update('near-now-rider-dev-tools:' + 'NEW PASSWORD').digest('hex'))"
 *
 * This keeps a curious tester out; it is not strong security. The tools are
 * absent from production builds altogether, which is the real protection.
 */
const DEV_TOOLS_PASSWORD_SALT = "near-now-rider-dev-tools:";
const DEV_TOOLS_PASSWORD_SHA256 = "e6eda5a2e0d4fcc1231c7832a56df2d8f2f2a28a9fa0b6be1b96c4298d100fae";

export function isDevToolsPassword(input: string): boolean {
  return sha256Hex(DEV_TOOLS_PASSWORD_SALT + input) === DEV_TOOLS_PASSWORD_SHA256;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
];

/** SHA-256 of a string (as UTF-8), in hex. Plain JS so it runs in Hermes and in Node alike. */
export function sha256Hex(text: string): string {
  // UTF-8 bytes without TextEncoder, which Hermes does not always have.
  const bytes: number[] = [];
  const utf8 = unescape(encodeURIComponent(text));
  for (let i = 0; i < utf8.length; i++) bytes.push(utf8.charCodeAt(i));

  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, "0")).join("");
}

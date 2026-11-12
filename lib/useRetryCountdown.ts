import { useEffect, useRef, useState } from "react";

/** "m:ss" for a seconds count. */
export function fmtCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Drives a live "wait Xs" countdown from apiFetch's `err.retryAfterSeconds`
 * (the real Retry-After header the backend's rate limiter sends on a 429)
 * instead of a static "wait 3 minutes" the rider has no way to act on.
 * `secondsLeft` is null once expired/idle; `onExpire` fires once at zero.
 */
export function useRetryCountdown(onExpire?: () => void) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  useEffect(() => {
    if (secondsLeft === null) return;
    if (secondsLeft <= 0) {
      onExpireRef.current?.();
      return;
    }
    const id = setTimeout(() => setSecondsLeft((s) => (s !== null ? s - 1 : null)), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);
  const start = (seconds: number) => setSecondsLeft(Math.max(1, Math.round(seconds)));
  return { secondsLeft: secondsLeft && secondsLeft > 0 ? secondsLeft : null, start };
}

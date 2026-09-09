import { useEffect, useRef, useState } from "react";
import { getSession } from "../session";
import { apiFetch } from "../constants/api";
import { fetchUnreadNotificationsShared, invalidateUnreadNotificationsCache } from "./unreadNotificationsCache";

const POLL_MS = 20_000;

export type ProfileChangeOutcome = {
  notificationId: string;
  approved: boolean;
  rejectionReason: string | null;
};

/**
 * Surfaces the outcome of an admin-reviewed rider profile-change request as
 * a blocking, app-wide acknowledgment — not just a banner on the Profile
 * screen. Approving/rejecting already persists an unread
 * `profile_change_reviewed` notification (notification.service.ts); this
 * polls that same store independent of whatever screen is focused, so the
 * rider can't miss the outcome by being on Home/Orders when it's reviewed.
 * Marking the notification read (dismiss()) is the "acknowledgment" — until
 * then the same outcome keeps reappearing on every poll.
 */
export function useProfileChangeOutcomeGate(isLoggedIn: boolean) {
  const [outcome, setOutcome] = useState<ProfileChangeOutcome | null>(null);
  const dismissingRef = useRef(false);

  useEffect(() => {
    // getSession()/check() already no-op without a token, but the interval
    // itself used to start unconditionally at app mount and run for the
    // app's entire lifetime — including the phone/OTP screens pre-login,
    // where it can never do anything. Gating the timer itself on isLoggedIn
    // avoids that needless idle poll. Found 2026-09-09.
    if (!isLoggedIn) return;
    let cancelled = false;

    const check = async () => {
      if (dismissingRef.current) return;
      try {
        const s: any = await getSession();
        if (!s?.token || cancelled) return;
        const data = await fetchUnreadNotificationsShared(s.token);
        if (cancelled || !Array.isArray(data)) return;
        const next = data.find((n) => n.type === "profile_change_reviewed");
        if (next) {
          setOutcome({
            notificationId: next.id,
            approved: !!next.data?.approved,
            rejectionReason: next.data?.rejectionReason ?? null,
          });
        }
      } catch {
        // Non-critical — next poll tick tries again.
      }
    };

    void check();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [isLoggedIn]);

  const dismiss = async () => {
    const current = outcome;
    if (!current) return;
    dismissingRef.current = true;
    setOutcome(null);
    try {
      const s: any = await getSession();
      if (s?.token) {
        await apiFetch(`/delivery-partner/notifications/${current.notificationId}/read`, { method: "PUT" }, s.token);
        invalidateUnreadNotificationsCache();
      }
    } catch {
      // Non-fatal — worst case the same outcome reappears next poll, still dismissible.
    } finally {
      dismissingRef.current = false;
    }
  };

  return { outcome, dismiss };
}

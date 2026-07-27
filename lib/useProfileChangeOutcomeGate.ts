import { useEffect, useRef, useState } from "react";
import { getSession } from "../session";
import { apiFetch } from "../constants/api";

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
export function useProfileChangeOutcomeGate() {
  const [outcome, setOutcome] = useState<ProfileChangeOutcome | null>(null);
  const dismissingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (dismissingRef.current) return;
      try {
        const s: any = await getSession();
        if (!s?.token || cancelled) return;
        const data = await apiFetch<any[]>("/delivery-partner/notifications?unreadOnly=true", {}, s.token);
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
  }, []);

  const dismiss = async () => {
    const current = outcome;
    if (!current) return;
    dismissingRef.current = true;
    setOutcome(null);
    try {
      const s: any = await getSession();
      if (s?.token) {
        await apiFetch(`/delivery-partner/notifications/${current.notificationId}/read`, { method: "PUT" }, s.token);
      }
    } catch {
      // Non-fatal — worst case the same outcome reappears next poll, still dismissible.
    } finally {
      dismissingRef.current = false;
    }
  };

  return { outcome, dismiss };
}

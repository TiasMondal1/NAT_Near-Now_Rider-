import { useEffect, useState } from "react";
import { apiFetch } from "../constants/api";
import { ADMIN_CONTACTS } from "../constants/config";
import { getSession } from "../session";

export type SupportContact = { name: string; phone: string };

/**
 * Admin/support numbers a rider can call. Fetched from the backend so they
 * can be rotated without shipping a new build; the hardcoded list in
 * constants/config.ts is only the fallback for when the endpoint is
 * unavailable (older backend, offline).
 *
 * Expected response: `{ contacts: [{ name, phone }] }` (phone in E.164).
 */
const ENDPOINT = "/delivery-partner/support-contacts";
const TTL_MS = 10 * 60 * 1000;

let cached: { contacts: SupportContact[]; ts: number } | null = null;
let inFlight: Promise<SupportContact[]> | null = null;

function isValid(c: unknown): c is SupportContact {
  const x = c as Partial<SupportContact> | null;
  return !!x && typeof x.name === "string" && typeof x.phone === "string" && /^\+?\d{8,15}$/.test(x.phone);
}

export function fetchSupportContacts(token?: string): Promise<SupportContact[]> {
  if (cached && Date.now() - cached.ts < TTL_MS) return Promise.resolve(cached.contacts);
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      // The endpoint sits behind the backend's rider-auth middleware, so a
      // request without a token can only come back 401. Callers that don't
      // hold the token (pending-verification) get it from the session here;
      // with no session at all, use the fallback without a request and
      // without caching it, so the first signed-in call still asks.
      const authToken = token || (await getSession())?.token;
      if (!authToken) return [...ADMIN_CONTACTS];

      let list: SupportContact[] = [];
      try {
        const res = await apiFetch<{ contacts?: unknown[] }>(ENDPOINT, {}, authToken, 0);
        list = Array.isArray(res?.contacts) ? res.contacts.filter(isValid) : [];
      } catch {
        // 404 (backend without the endpoint), offline, 5xx: fallback below.
      }
      // The fallback is cached too. It used to be returned uncached, so on a
      // backend without the endpoint every Home / pending-verification mount
      // sent the same failing request again.
      const contacts = list.length > 0 ? list : [...ADMIN_CONTACTS];
      cached = { contacts, ts: Date.now() };
      return contacts;
    } catch {
      return [...ADMIN_CONTACTS];
    }
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Renders the fallback list immediately, then swaps in the server list. */
export function useSupportContacts(token?: string | null): SupportContact[] {
  const [contacts, setContacts] = useState<SupportContact[]>(cached?.contacts ?? [...ADMIN_CONTACTS]);
  useEffect(() => {
    let active = true;
    fetchSupportContacts(token || undefined).then((list) => {
      if (active) setContacts(list);
    });
    return () => {
      active = false;
    };
  }, [token]);
  return contacts;
}

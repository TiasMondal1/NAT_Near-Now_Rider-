import { useEffect, useState } from "react";
import { apiFetch } from "../constants/api";
import { ADMIN_CONTACTS } from "../constants/config";

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

export async function fetchSupportContacts(token?: string): Promise<SupportContact[]> {
  if (cached && Date.now() - cached.ts < TTL_MS) return cached.contacts;
  if (inFlight) return inFlight;

  inFlight = apiFetch<{ contacts?: unknown[] }>(ENDPOINT, {}, token, 0)
    .then((res) => {
      const list = Array.isArray(res?.contacts) ? res.contacts.filter(isValid) : [];
      if (list.length === 0) return [...ADMIN_CONTACTS];
      cached = { contacts: list, ts: Date.now() };
      return list;
    })
    .catch(() => [...ADMIN_CONTACTS])
    .finally(() => {
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

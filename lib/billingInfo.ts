import { apiFetch } from "../constants/api";

export type BillingInfo = {
  name: string | null;
  profileImageUrl: string | null;
  upiId: string | null;
};

export async function fetchBillingInfo(token: string): Promise<BillingInfo> {
  const json = await apiFetch<{ success: boolean; billingInfo?: BillingInfo }>(
    "/delivery-partner/billing-info",
    {},
    token
  );
  return json?.billingInfo ?? { name: null, profileImageUrl: null, upiId: null };
}

export async function saveBillingInfo(
  token: string,
  upiId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const json = await apiFetch<{ success: boolean; error?: string }>(
      "/delivery-partner/billing-info",
      { method: "PATCH", body: { upi_id: upiId } },
      token
    );
    if (!json?.success) {
      return { ok: false, error: json?.error || "Failed to save billing info" };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.error || e?.message || "Network error" };
  }
}

/** "12 Mar, 02:45 pm" style timestamp used by the Orders and Earnings lists. */
export function formatOrderDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

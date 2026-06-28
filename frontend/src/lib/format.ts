// Shared display formatters for the dashboard. Amounts follow ui-context.md:
// USDC always 2 decimals with `$`; mQQQ at least 4 decimals; refs/addresses truncated in the middle.

/** USDC — 2 decimals with a leading `$`. Accepts the 6-decimal projection string or a number. */
export function formatUsd(value: string | number): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "$0.00";
}

/** mQQQ — at least 4 decimals, preserving any extra precision the source string carries (no rounding loss). */
export function formatMqqq(value: string | number): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return "0.0000";
  const str = typeof value === "string" ? value.trim() : String(value);
  const dot = str.indexOf(".");
  const decimals = dot === -1 ? 0 : str.length - dot - 1;
  return n.toFixed(Math.max(4, decimals));
}

/** Middle-truncate a hash/address/ref: `0x1234…cd34`. Short values pass through unchanged. */
export function truncateMiddle(value: string, head = 6, tail = 4): string {
  return value.length > head + tail + 1
    ? `${value.slice(0, head)}…${value.slice(-tail)}`
    : value;
}

/** ISO timestamp → local 24-hour clock time; empty string for an unparseable input. */
export function formatClock(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour12: false });
}

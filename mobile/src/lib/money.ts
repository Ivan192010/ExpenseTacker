/**
 * Integer-cent money helpers. Never use floats for amounts.
 * `allocate` mirrors the backend's largest-remainder split (ties -> lower index),
 * so the live preview on the Add Expense screen matches what the server stores.
 */
import { CURRENCY, LOCALE } from "./config";

/** Parse a user-typed decimal ("1,234.5", "12.") into an integer scaled by 10^places. null if invalid. */
export function parseScaled(input: string | null | undefined, places: number): bigint | null {
  if (input == null) return null;
  const s = String(input).trim().replace(/,/g, "");
  if (!/^\d*(\.\d*)?$/.test(s) || s === "" || s === ".") return null;
  const [int = "", frac = ""] = s.split(".");
  if (frac.length > places) return null;
  return BigInt(int || "0") * 10n ** BigInt(places) + BigInt((frac + "0".repeat(places)).slice(0, places) || "0");
}

/** "1250.5" -> 125050. NaN when invalid or more than 2 decimals. */
export function toCents(input: string | null | undefined): number {
  const v = parseScaled(input, 2);
  return v == null ? NaN : Number(v);
}

/** 125050 -> "1250.50" (API format). */
export function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Keep only digits and one dot; accept comma as decimal separator. */
export function sanitizeDecimal(text: string, places = 2): string {
  let s = text.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const dot = s.indexOf(".");
  if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "").slice(0, places);
  return s;
}

/** Split `total` cents proportionally to non-negative integer weights. Always sums to total. */
export function allocate(total: number, weights: bigint[]): number[] {
  const W = weights.reduce((a, b) => a + b, 0n);
  if (W <= 0n || weights.length === 0) return weights.map(() => 0);
  const T = BigInt(total);
  const floors = weights.map((w) => (T * w) / W);
  const rems = weights.map((w, i) => T * w - floors[i] * W);
  let remainder = T - floors.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (rems[b] > rems[a] ? 1 : rems[b] < rems[a] ? -1 : a - b));
  const out = floors.slice();
  for (const i of order) {
    if (remainder <= 0n) break;
    out[i] += 1n;
    remainder -= 1n;
  }
  return out.map(Number);
}

const formatters = new Map<string, Intl.NumberFormat>();
function fmt(signed: boolean): Intl.NumberFormat {
  const key = signed ? "s" : "u";
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency: CURRENCY,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...(signed ? { signDisplay: "exceptZero" as const } : {}),
    });
    formatters.set(key, f);
  }
  return f;
}

/** Format an API money string or a cent integer. */
export function formatMoney(value: string | number | null | undefined, opts: { signed?: boolean } = {}): string {
  const cents = typeof value === "number" ? value : toSignedCents(value);
  if (!Number.isFinite(cents)) return "—";
  return fmt(!!opts.signed).format(cents / 100);
}

/** API strings can be negative ("-125.00"). */
export function toSignedCents(value: string | null | undefined): number {
  if (value == null) return NaN;
  const s = String(value).trim();
  return s.startsWith("-") ? -toCents(s.slice(1)) : toCents(s);
}

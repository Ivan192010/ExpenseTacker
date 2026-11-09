export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));

export interface YM {
  year: number;
  month: number; // 1-12
}

export function currentYM(): YM {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function addMonths({ year, month }: YM, k: number): YM {
  const idx = year * 12 + (month - 1) + k;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function ymLabel({ year, month }: YM, short = false): string {
  return `${(short ? MONTHS_SHORT : MONTHS)[month - 1]} ${year}`;
}

/** Local date -> "YYYY-MM-DD" (no timezone shift). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" -> local Date at midnight. */
export function fromISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function prettyDate(s: string): string {
  const d = fromISODate(s);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (toISODate(d) === toISODate(today)) return "Today";
  if (toISODate(d) === toISODate(yesterday)) return "Yesterday";
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Default date for a new entry in a monthly ledger: today if inside it, else the 1st. */
export function defaultDateFor(ym: YM | null): Date {
  const today = new Date();
  if (!ym || (today.getFullYear() === ym.year && today.getMonth() + 1 === ym.month)) return today;
  return new Date(ym.year, ym.month - 1, 1);
}

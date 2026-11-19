// Month helpers. A "month" is the string YYYY-MM.

const NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function isMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number);
  const total = year * 12 + (index - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${NAMES[index - 1]} ${year}`;
}

/** "Sep 2026", as printed on the cover and in the footers. */
export function monthShort(month: string): string {
  const [year, index] = month.split("-").map(Number);
  return `${NAMES[index - 1].slice(0, 3)} ${year}`;
}

/** Posts of month M are published as the edition of month M+1. */
export function editionLabel(contentMonth: string): string {
  return monthLabel(shiftMonth(contentMonth, 1));
}

/** [start, end) as MySQL datetime strings. */
export function monthRange(month: string): [string, string] {
  return [`${month}-01 00:00:00`, `${shiftMonth(month, 1)}-01 00:00:00`];
}

export function currentMonth(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

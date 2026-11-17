const ISO_DATE = /^(\d{4}-\d{2}-\d{2})/;
const DAY_MS = 86_400_000;

/** Normalizes Procore date or datetime values to YYYY-MM-DD. */
export function toIsoDate(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return ISO_DATE.exec(value)?.[1];
}

export function todayIn(timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function toUtc(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Mon–Fri days strictly between `from` and `to`, exclusive on both ends. */
export function workdaysBetween(from: string, to: string): number {
  let count = 0;
  for (let t = toUtc(from) + DAY_MS; t < toUtc(to); t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

// Currency + date formatting/parsing shared across the whole app.

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "₹0";
  return inrFormatter.format(amount);
}

const dateDisplayFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

// "2026-08-09" or a Date -> "09 Aug 2026"
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date + "T00:00:00") : date;
  if (Number.isNaN(d.getTime())) return "—";
  return dateDisplayFormatter.format(d);
}

// Convert a Date to "YYYY-MM-DD" for storing/sending to Postgres date columns.
export function toISODateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

function expandYear(y: number): number {
  return y < 100 ? 2000 + y : y;
}

function isValidYMD(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// Accepts things like "9/8/26", "09-08-2026", "9 Aug 26", "9 August 2026".
// Day-first (Indian convention). Returns null if it can't be parsed.
export function parseFlexibleDate(input: string): Date | null {
  const raw = input.trim();
  if (!raw) return null;

  // Numeric with separators: D/M/Y, D-M-Y, D.M.Y
  const numericMatch = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (numericMatch) {
    const day = parseInt(numericMatch[1], 10);
    const month = parseInt(numericMatch[2], 10);
    const year = expandYear(parseInt(numericMatch[3], 10));
    if (isValidYMD(year, month, day)) return new Date(year, month - 1, day);
    return null;
  }

  // "9 Aug 26", "9 August 2026", "9Aug26"
  const wordMatch = raw.match(/^(\d{1,2})\s*([A-Za-z]{3,})\s*(\d{2,4})$/);
  if (wordMatch) {
    const day = parseInt(wordMatch[1], 10);
    const monthText = wordMatch[2].toLowerCase().slice(0, 3);
    const monthIndex = MONTH_NAMES.indexOf(monthText);
    const year = expandYear(parseInt(wordMatch[3], 10));
    if (monthIndex >= 0 && isValidYMD(year, monthIndex + 1, day)) {
      return new Date(year, monthIndex, day);
    }
    return null;
  }

  // Fall back to a plain ISO date like "2026-08-09"
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    const day = parseInt(isoMatch[3], 10);
    if (isValidYMD(year, month, day)) return new Date(year, month - 1, day);
  }

  return null;
}

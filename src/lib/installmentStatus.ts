// Computes an EMI installment's collection status from what's actually been
// received against it so far.

export type InstallmentStatus = "PENDING" | "OVERDUE" | "PARTIAL" | "SHORT" | "PAID" | "PAID_LATE";

export interface InstallmentStatusResult {
  status: InstallmentStatus;
  label: string;
  toneClass: string;
}

const LABELS: Record<InstallmentStatus, string> = {
  PENDING: "Pending",
  OVERDUE: "Overdue",
  PARTIAL: "Partial",
  SHORT: "Short",
  PAID: "On time",
  PAID_LATE: "Delayed",
};

const TONES: Record<InstallmentStatus, string> = {
  PENDING: "text-slate-600 bg-slate-100",
  OVERDUE: "text-rose-700 bg-rose-100",
  PARTIAL: "text-amber-700 bg-amber-100",
  SHORT: "text-rose-700 bg-rose-100",
  PAID: "text-emerald-700 bg-emerald-100",
  PAID_LATE: "text-amber-700 bg-amber-100",
};

const ROUNDING_TOLERANCE = 1; // rupees; avoids status flicker from paisa-level rounding

// Whole days between two ISO (yyyy-mm-dd) dates, computed in UTC so DST
// shifts near a receipt's local midnight can't skew the count by a day.
function isoDaysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

export function getInstallmentStatus(
  totalDue: number,
  totalReceived: number,
  lastReceiptDate: string | null,
  dueDate: string, // ISO yyyy-mm-dd
  today: string // ISO yyyy-mm-dd
): InstallmentStatusResult {
  const isPastDue = dueDate < today;
  let status: InstallmentStatus;

  if (totalReceived <= 0) {
    status = isPastDue ? "OVERDUE" : "PENDING";
  } else if (totalReceived < totalDue - ROUNDING_TOLERANCE) {
    status = isPastDue ? "SHORT" : "PARTIAL";
  } else {
    status = lastReceiptDate && lastReceiptDate > dueDate ? "PAID_LATE" : "PAID";
  }

  let label = LABELS[status];
  if (status === "PAID") {
    label = lastReceiptDate && lastReceiptDate < dueDate ? "Early" : "On time";
  } else if (status === "PAID_LATE" && lastReceiptDate) {
    const days = isoDaysBetween(dueDate, lastReceiptDate);
    label = `Delay (by ${days} day${days === 1 ? "" : "s"})`;
  }

  return { status, label, toneClass: TONES[status] };
}

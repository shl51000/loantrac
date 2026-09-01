import type { SupabaseClient } from "@supabase/supabase-js";
import { addDays, toISODateString } from "@/lib/format";

export interface PendingInstallment {
  id: string;
  loanId: string;
  dueDate: string;
  totalDue: number;
  received: number;
  interestDue: number;
  principalDue: number;
}

// Every EMI installment on an active loan that has not been fully received
// yet (partially received counts as pending too). Shared by the sidebar
// reminder badge, the Reminders screen, and the Dashboard's cash-flow cards
// so they can never disagree with each other.
export async function getPendingInstallments(
  supabase: SupabaseClient
): Promise<PendingInstallment[]> {
  const { data: installments } = await supabase
    .from("emi_installments")
    .select("id, loan_id, interest_due, principal_due, due_date, loans!inner(status)")
    .eq("loans.status", "ACTIVE");

  if (!installments || installments.length === 0) return [];

  const ids = installments.map((i) => i.id);
  const { data: receipts } = await supabase
    .from("emi_receipts")
    .select("installment_id, received_amount, tds_amount")
    .in("installment_id", ids);

  const receivedByInstallment = new Map<string, number>();
  for (const r of receipts ?? []) {
    receivedByInstallment.set(
      r.installment_id,
      (receivedByInstallment.get(r.installment_id) ?? 0) + Number(r.received_amount) + Number(r.tds_amount)
    );
  }

  const pending: PendingInstallment[] = [];
  for (const inst of installments) {
    const interestDue = Number(inst.interest_due);
    const principalDue = Number(inst.principal_due);
    const totalDue = interestDue + principalDue;
    const received = receivedByInstallment.get(inst.id) ?? 0;
    if (received < totalDue - 0.5) {
      pending.push({
        id: inst.id,
        loanId: inst.loan_id,
        dueDate: inst.due_date,
        totalDue,
        received,
        interestDue,
        principalDue,
      });
    }
  }
  return pending;
}

export interface PendingBuckets {
  overdue: number;
  dueIn7: number;
  dueIn30: number;
  dueIn90: number;
}

// Cumulative windows: "due in 30" includes what's due in the next 7, etc.
export function bucketPendingAmounts(
  pending: PendingInstallment[],
  today: Date = new Date()
): PendingBuckets {
  const todayStr = toISODateString(today);
  const in7 = toISODateString(addDays(today, 7));
  const in30 = toISODateString(addDays(today, 30));
  const in90 = toISODateString(addDays(today, 90));

  const buckets: PendingBuckets = { overdue: 0, dueIn7: 0, dueIn30: 0, dueIn90: 0 };

  for (const p of pending) {
    const remaining = p.totalDue - p.received;
    if (p.dueDate < todayStr) {
      buckets.overdue += remaining;
    } else if (p.dueDate <= in7) {
      buckets.dueIn7 += remaining;
      buckets.dueIn30 += remaining;
      buckets.dueIn90 += remaining;
    } else if (p.dueDate <= in30) {
      buckets.dueIn30 += remaining;
      buckets.dueIn90 += remaining;
    } else if (p.dueDate <= in90) {
      buckets.dueIn90 += remaining;
    }
  }

  return buckets;
}

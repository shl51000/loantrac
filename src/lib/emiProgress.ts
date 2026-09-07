import type { SupabaseClient } from "@supabase/supabase-js";

export interface EmiProgress {
  paid: number;
  total: number;
}

// Per-loan count of fully-received EMI installments out of the total, for
// every active EMI loan — regardless of whether an installment is still
// pending. Used to show an "EMI x/y" progress indicator on the Reminders
// and Repayment Calendar screens.
export async function getEmiProgressByLoan(
  supabase: SupabaseClient
): Promise<Map<string, EmiProgress>> {
  const { data: installments } = await supabase
    .from("emi_installments")
    .select("id, loan_id, interest_due, principal_due, loans!inner(status)")
    .eq("loans.status", "ACTIVE");

  if (!installments || installments.length === 0) return new Map();

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

  const progress = new Map<string, EmiProgress>();
  for (const inst of installments) {
    const totalDue = Number(inst.interest_due) + Number(inst.principal_due);
    const received = receivedByInstallment.get(inst.id) ?? 0;
    const entry = progress.get(inst.loan_id) ?? { paid: 0, total: 0 };
    entry.total += 1;
    if (received >= totalDue - 0.5) entry.paid += 1;
    progress.set(inst.loan_id, entry);
  }
  return progress;
}

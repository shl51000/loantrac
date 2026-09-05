import type { SupabaseClient } from "@supabase/supabase-js";

// On-Call loans can receive top-up draws after disbursement, so "the loan
// amount" for one of these is the initial amount plus every top-up — not
// just the original disbursement figure stored on the loan row.
export async function getTotalDrawsByLoan(
  supabase: SupabaseClient,
  loanIds: string[]
): Promise<Map<string, number>> {
  const draws = new Map<string, number>();
  if (loanIds.length === 0) return draws;

  const { data } = await supabase
    .from("oncall_transactions")
    .select("loan_id, transaction_type, amount")
    .eq("transaction_type", "DRAW")
    .in("loan_id", loanIds);

  for (const t of (data as { loan_id: string; amount: number }[]) ?? []) {
    draws.set(t.loan_id, (draws.get(t.loan_id) ?? 0) + Number(t.amount));
  }
  return draws;
}

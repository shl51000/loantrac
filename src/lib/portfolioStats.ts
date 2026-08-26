import type { SupabaseClient } from "@supabase/supabase-js";

export interface PortfolioStats {
  activeCapitalDeployed: number;
  outstandingPrincipal: number;
  capitalByReferral: { referralId: string; amount: number }[];
  activeLoanCount: number;
}

// All figures are for currently-ACTIVE loans only.
export async function getPortfolioStats(supabase: SupabaseClient): Promise<PortfolioStats> {
  const { data: loansData } = await supabase
    .from("loans")
    .select("id, loan_amount, loan_type, referral_id")
    .eq("status", "ACTIVE");

  const activeLoans = loansData ?? [];
  const activeCapitalDeployed = activeLoans.reduce((s, l) => s + Number(l.loan_amount), 0);

  const emiLoanIds = activeLoans.filter((l) => l.loan_type === "EMI").map((l) => l.id);
  const oncallLoanIds = activeLoans.filter((l) => l.loan_type === "ON_CALL").map((l) => l.id);

  let emiPrincipalReceived = 0;
  if (emiLoanIds.length > 0) {
    const { data: installments } = await supabase
      .from("emi_installments")
      .select("id, loan_id")
      .in("loan_id", emiLoanIds);
    const instIds = (installments ?? []).map((i) => i.id);
    if (instIds.length > 0) {
      const { data: receipts } = await supabase
        .from("emi_receipts")
        .select("received_amount, installment_id")
        .eq("receipt_type", "PRINCIPAL")
        .in("installment_id", instIds);
      emiPrincipalReceived = (receipts ?? []).reduce((s, r) => s + Number(r.received_amount), 0);
    }
  }

  let oncallNetDraws = 0;
  let oncallPrincipalRepaid = 0;
  if (oncallLoanIds.length > 0) {
    const { data: txns } = await supabase
      .from("oncall_transactions")
      .select("transaction_type, amount, principal_portion, loan_id")
      .in("loan_id", oncallLoanIds);
    for (const t of txns ?? []) {
      if (t.transaction_type === "DRAW") oncallNetDraws += Number(t.amount);
      if (t.transaction_type === "REPAYMENT") oncallPrincipalRepaid += Number(t.principal_portion);
    }
  }

  const outstandingPrincipal =
    activeCapitalDeployed + oncallNetDraws - oncallPrincipalRepaid - emiPrincipalReceived;

  const capitalMap = new Map<string, number>();
  for (const l of activeLoans) {
    capitalMap.set(l.referral_id, (capitalMap.get(l.referral_id) ?? 0) + Number(l.loan_amount));
  }
  const capitalByReferral = Array.from(capitalMap.entries()).map(([referralId, amount]) => ({
    referralId,
    amount,
  }));

  return {
    activeCapitalDeployed,
    outstandingPrincipal,
    capitalByReferral,
    activeLoanCount: activeLoans.length,
  };
}

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getPlannedXirr,
  getActualXirr,
  type XirrLoan,
  type XirrInstallment,
  type XirrTransaction,
  type LoanXirrResult,
} from "@/lib/loanXirr";

interface RawInstallment {
  id: string;
  loan_id: string;
  due_date: string;
  interest_due: number;
  principal_due: number;
}

interface RawReceipt {
  installment_id: string;
  receipt_date: string;
  received_amount: number;
  tds_amount: number;
}

interface RawTransaction {
  loan_id: string;
  transaction_type: "DRAW" | "REPAYMENT";
  transaction_date: string;
  amount: number;
  principal_portion: number;
  interest_portion: number;
  tds_on_interest: number;
}

// Fetches every loan (active and closed) and everything needed to compute
// its Planned and Actual XIRR. Spans both statuses because closed loans
// still count toward Actual XIRR (via their final settlement) — unlike
// portfolioStats.ts, which is about currently-deployed capital only.
export async function getAllLoanXirrResults(
  supabase: SupabaseClient,
  today: Date = new Date()
): Promise<LoanXirrResult[]> {
  const { data: loans } = await supabase
    .from("loans")
    .select(
      "id, referral_id, loan_type, disbursement_date, loan_amount, status, closure_date, closure_settlement_amount, oncall_annual_rate"
    );
  const loanRows = (loans as XirrLoan[]) ?? [];
  if (loanRows.length === 0) return [];

  const emiLoanIds = loanRows.filter((l) => l.loan_type === "EMI").map((l) => l.id);
  const oncallLoanIds = loanRows.filter((l) => l.loan_type === "ON_CALL").map((l) => l.id);

  const installmentsByLoan = new Map<string, XirrInstallment[]>();
  if (emiLoanIds.length > 0) {
    const { data: instData } = await supabase
      .from("emi_installments")
      .select("id, loan_id, due_date, interest_due, principal_due")
      .in("loan_id", emiLoanIds);
    const instRows = (instData as RawInstallment[]) ?? [];
    const instIds = instRows.map((i) => i.id);

    const receiptsByInstallment = new Map<string, XirrInstallment["receipts"]>();
    if (instIds.length > 0) {
      const { data: receiptData } = await supabase
        .from("emi_receipts")
        .select("installment_id, receipt_date, received_amount, tds_amount")
        .in("installment_id", instIds);
      for (const r of (receiptData as RawReceipt[]) ?? []) {
        const list = receiptsByInstallment.get(r.installment_id) ?? [];
        list.push({ receipt_date: r.receipt_date, received_amount: r.received_amount, tds_amount: r.tds_amount });
        receiptsByInstallment.set(r.installment_id, list);
      }
    }

    for (const inst of instRows) {
      const list = installmentsByLoan.get(inst.loan_id) ?? [];
      list.push({
        due_date: inst.due_date,
        interest_due: inst.interest_due,
        principal_due: inst.principal_due,
        receipts: receiptsByInstallment.get(inst.id) ?? [],
      });
      installmentsByLoan.set(inst.loan_id, list);
    }
  }

  const transactionsByLoan = new Map<string, XirrTransaction[]>();
  if (oncallLoanIds.length > 0) {
    const { data: txnData } = await supabase
      .from("oncall_transactions")
      .select("loan_id, transaction_type, transaction_date, amount, principal_portion, interest_portion, tds_on_interest")
      .in("loan_id", oncallLoanIds);
    for (const t of (txnData as RawTransaction[]) ?? []) {
      const list = transactionsByLoan.get(t.loan_id) ?? [];
      list.push(t);
      transactionsByLoan.set(t.loan_id, list);
    }
  }

  return loanRows.map((loan) => {
    const installments = installmentsByLoan.get(loan.id) ?? [];
    const transactions = transactionsByLoan.get(loan.id) ?? [];
    return {
      loanId: loan.id,
      referralId: loan.referral_id,
      loanAmount: Number(loan.loan_amount),
      planned: getPlannedXirr(loan, installments),
      actual: getActualXirr(loan, installments, transactions, today),
    };
  });
}

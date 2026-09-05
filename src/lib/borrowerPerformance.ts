// Per-borrower rollup for the Borrowers page: loan count, capital deployed,
// outstanding principal, EMI late rate, and capital-weighted Planned/Actual
// XIRR — computed across every loan (active and closed) for each borrower.

import type { SupabaseClient } from "@supabase/supabase-js";
import { toISODateString } from "@/lib/format";
import { getInstallmentStatus } from "@/lib/installmentStatus";
import { getPlannedXirr, getActualXirr, type XirrLoan, type XirrInstallment, type XirrTransaction } from "@/lib/loanXirr";

interface RawLoan {
  id: string;
  borrower_id: string;
  referral_id: string;
  loan_type: "EMI" | "ON_CALL";
  loan_amount: number;
  disbursement_date: string;
  status: "ACTIVE" | "CLOSED";
  closure_date: string | null;
  closure_settlement_amount: number | null;
  oncall_annual_rate: number | null;
}

interface RawInstallment {
  id: string;
  loan_id: string;
  due_date: string;
  interest_due: number;
  principal_due: number;
}

interface RawReceipt {
  installment_id: string;
  receipt_type: "INTEREST" | "PRINCIPAL";
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

export interface BorrowerPerformanceRow {
  borrowerId: string;
  loanCount: number;
  activeLoanCount: number;
  borrowedCapital: number;
  outstandingAmt: number;
  lateRatePct: number | null;
  planned: number | null;
  actual: number | null;
}

export async function getBorrowerPerformance(
  supabase: SupabaseClient,
  today: Date = new Date()
): Promise<Map<string, BorrowerPerformanceRow>> {
  const { data: loanData } = await supabase
    .from("loans")
    .select(
      "id, borrower_id, referral_id, loan_type, loan_amount, disbursement_date, status, closure_date, closure_settlement_amount, oncall_annual_rate"
    );
  const loans = (loanData as RawLoan[]) ?? [];
  if (loans.length === 0) return new Map();

  const emiLoanIds = loans.filter((l) => l.loan_type === "EMI").map((l) => l.id);
  const oncallLoanIds = loans.filter((l) => l.loan_type === "ON_CALL").map((l) => l.id);

  const installmentsByLoan = new Map<string, RawInstallment[]>();
  const receiptsByInstallment = new Map<string, RawReceipt[]>();
  if (emiLoanIds.length > 0) {
    const { data: instData } = await supabase
      .from("emi_installments")
      .select("id, loan_id, due_date, interest_due, principal_due")
      .in("loan_id", emiLoanIds);
    const instRows = (instData as RawInstallment[]) ?? [];
    for (const inst of instRows) {
      const list = installmentsByLoan.get(inst.loan_id) ?? [];
      list.push(inst);
      installmentsByLoan.set(inst.loan_id, list);
    }

    const instIds = instRows.map((i) => i.id);
    if (instIds.length > 0) {
      const { data: receiptData } = await supabase
        .from("emi_receipts")
        .select("installment_id, receipt_type, receipt_date, received_amount, tds_amount")
        .in("installment_id", instIds);
      for (const r of (receiptData as RawReceipt[]) ?? []) {
        const list = receiptsByInstallment.get(r.installment_id) ?? [];
        list.push(r);
        receiptsByInstallment.set(r.installment_id, list);
      }
    }
  }

  const transactionsByLoan = new Map<string, RawTransaction[]>();
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

  const todayStr = toISODateString(today);

  interface LoanPerf {
    borrowerId: string;
    status: "ACTIVE" | "CLOSED";
    loanAmount: number;
    capitalDeployed: number;
    outstanding: number;
    dueCount: number;
    lateCount: number;
    planned: number | null;
    actual: number | null;
  }

  const perLoan: LoanPerf[] = loans.map((loan) => {
    const installments = installmentsByLoan.get(loan.id) ?? [];
    let dueCount = 0;
    let lateCount = 0;
    let principalReceived = 0;

    const xirrInstallments: XirrInstallment[] = installments.map((inst) => {
      const receipts = receiptsByInstallment.get(inst.id) ?? [];
      const totalDue = Number(inst.interest_due) + Number(inst.principal_due);
      const totalReceived = receipts.reduce((s, r) => s + Number(r.received_amount) + Number(r.tds_amount), 0);
      const lastReceiptDate = receipts.length > 0 ? receipts.map((r) => r.receipt_date).sort().slice(-1)[0] : null;

      principalReceived += receipts
        .filter((r) => r.receipt_type === "PRINCIPAL")
        .reduce((s, r) => s + Number(r.received_amount) + Number(r.tds_amount), 0);

      if (inst.due_date <= todayStr && totalDue > 0.5) {
        dueCount++;
        const { status } = getInstallmentStatus(totalDue, totalReceived, lastReceiptDate, inst.due_date, todayStr);
        if (status !== "PAID" && status !== "PENDING") lateCount++;
      }

      return {
        due_date: inst.due_date,
        interest_due: inst.interest_due,
        principal_due: inst.principal_due,
        receipts: receipts.map((r) => ({
          receipt_date: r.receipt_date,
          received_amount: r.received_amount,
          tds_amount: r.tds_amount,
        })),
      };
    });

    const transactions = transactionsByLoan.get(loan.id) ?? [];
    const xirrTransactions: XirrTransaction[] = transactions;

    const xirrLoan: XirrLoan = {
      id: loan.id,
      referral_id: loan.referral_id,
      loan_type: loan.loan_type,
      disbursement_date: loan.disbursement_date,
      loan_amount: loan.loan_amount,
      status: loan.status,
      closure_date: loan.closure_date,
      closure_settlement_amount: loan.closure_settlement_amount,
      oncall_annual_rate: loan.oncall_annual_rate,
    };

    const totalDraws = transactions
      .filter((t) => t.transaction_type === "DRAW")
      .reduce((s, t) => s + Number(t.amount), 0);

    let outstanding = 0;
    if (loan.status === "ACTIVE") {
      if (loan.loan_type === "EMI") {
        outstanding = Math.max(0, Number(loan.loan_amount) - principalReceived);
      } else {
        let net = Number(loan.loan_amount);
        for (const t of transactions) {
          if (t.transaction_type === "DRAW") net += Number(t.amount);
          else net -= Number(t.principal_portion);
        }
        outstanding = Math.max(0, net);
      }
    }

    return {
      borrowerId: loan.borrower_id,
      status: loan.status,
      loanAmount: Number(loan.loan_amount),
      // Includes On-Call top-up draws so it's never less than outstanding.
      capitalDeployed: Number(loan.loan_amount) + totalDraws,
      outstanding,
      dueCount,
      lateCount,
      planned: getPlannedXirr(xirrLoan, xirrInstallments),
      actual: getActualXirr(xirrLoan, xirrInstallments, xirrTransactions, today),
    };
  });

  const byBorrower = new Map<string, LoanPerf[]>();
  for (const lp of perLoan) {
    const list = byBorrower.get(lp.borrowerId) ?? [];
    list.push(lp);
    byBorrower.set(lp.borrowerId, list);
  }

  const result = new Map<string, BorrowerPerformanceRow>();
  for (const [borrowerId, group] of byBorrower) {
    const dueCount = group.reduce((s, g) => s + g.dueCount, 0);
    const lateCount = group.reduce((s, g) => s + g.lateCount, 0);
    let plannedWeightedSum = 0;
    let plannedWeight = 0;
    let actualWeightedSum = 0;
    let actualWeight = 0;
    for (const g of group) {
      if (g.planned !== null) {
        plannedWeightedSum += g.planned * g.loanAmount;
        plannedWeight += g.loanAmount;
      }
      if (g.actual !== null) {
        actualWeightedSum += g.actual * g.loanAmount;
        actualWeight += g.loanAmount;
      }
    }
    result.set(borrowerId, {
      borrowerId,
      loanCount: group.length,
      activeLoanCount: group.filter((g) => g.status === "ACTIVE").length,
      borrowedCapital: group.reduce((s, g) => s + g.capitalDeployed, 0),
      outstandingAmt: group.reduce((s, g) => s + g.outstanding, 0),
      lateRatePct: dueCount > 0 ? (lateCount / dueCount) * 100 : null,
      planned: plannedWeight > 0 ? plannedWeightedSum / plannedWeight : null,
      actual: actualWeight > 0 ? actualWeightedSum / actualWeight : null,
    });
  }

  return result;
}

// Builds Planned and Actual/Current XIRR for a single loan, and aggregates
// per-loan XIRRs into a capital-weighted portfolio/referral figure.
//
// Planned XIRR = the loan's pure contracted cash flows (disbursement +
// the generated schedule for EMI; for On-Call it's just the contracted
// annual rate, since there's no fixed schedule to build a cash flow from).
//
// Actual/Current XIRR = disbursement + every real receipt/repayment on its
// real date, PLUS whatever hasn't come in yet:
//   - EMI, overdue and unreceived: assumed collected TODAY.
//   - EMI, not yet due: assumed collected on its own real due date (not
//     pulled forward to today).
//   - On-Call, still active: the current outstanding principal is assumed
//     collected today (there's no due-date schedule to fall back on).
//   - Any loan that's been force-closed: only real receipts plus the final
//     settlement amount on the closure date — no assumed amounts at all.
//
// TDS is treated as part of the value received (Amount = Principal +
// Interest + TDS, per the app's confirmed convention), so every receipt's
// cash-flow value includes its TDS.

import { calculateXIRR, type CashFlow } from "@/lib/xirr";

export type LoanType = "EMI" | "ON_CALL";

export interface XirrLoan {
  id: string;
  referral_id: string;
  loan_type: LoanType;
  disbursement_date: string;
  loan_amount: number;
  status: "ACTIVE" | "CLOSED";
  closure_date: string | null;
  closure_settlement_amount: number | null;
  oncall_annual_rate: number | null;
}

export interface XirrInstallment {
  due_date: string;
  interest_due: number;
  principal_due: number;
  receipts: { receipt_date: string; received_amount: number; tds_amount: number }[];
}

export interface XirrTransaction {
  transaction_type: "DRAW" | "REPAYMENT";
  transaction_date: string;
  amount: number;
  principal_portion: number;
  interest_portion: number;
  tds_on_interest: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function receiptValue(r: { received_amount: number; tds_amount: number }): number {
  return Number(r.received_amount) + Number(r.tds_amount);
}

export function getPlannedXirr(loan: XirrLoan, installments: XirrInstallment[]): number | null {
  if (loan.loan_type === "ON_CALL") {
    return loan.oncall_annual_rate != null ? Number(loan.oncall_annual_rate) / 100 : null;
  }
  const flows: CashFlow[] = [{ date: new Date(loan.disbursement_date), amount: -Number(loan.loan_amount) }];
  for (const inst of installments) {
    flows.push({
      date: new Date(inst.due_date),
      amount: Number(inst.interest_due) + Number(inst.principal_due),
    });
  }
  return calculateXIRR(flows);
}

export function getActualXirr(
  loan: XirrLoan,
  installments: XirrInstallment[],
  transactions: XirrTransaction[],
  today: Date
): number | null {
  const flows: CashFlow[] = [{ date: new Date(loan.disbursement_date), amount: -Number(loan.loan_amount) }];
  const isClosed = loan.status === "CLOSED";

  if (loan.loan_type === "EMI") {
    for (const inst of installments) {
      const totalDue = Number(inst.interest_due) + Number(inst.principal_due);
      let received = 0;
      for (const r of inst.receipts) {
        const value = receiptValue(r);
        flows.push({ date: new Date(r.receipt_date), amount: value });
        received += value;
      }
      const remaining = round2(totalDue - received);
      if (remaining > 0.5 && !isClosed) {
        const dueDate = new Date(inst.due_date);
        flows.push({ date: dueDate < today ? today : dueDate, amount: remaining });
      }
    }
  } else {
    let outstanding = Number(loan.loan_amount);
    for (const t of transactions) {
      if (t.transaction_type === "DRAW") {
        flows.push({ date: new Date(t.transaction_date), amount: -Number(t.amount) });
        outstanding += Number(t.amount);
      } else {
        const value = Number(t.principal_portion) + Number(t.interest_portion) + Number(t.tds_on_interest);
        flows.push({ date: new Date(t.transaction_date), amount: value });
        outstanding -= Number(t.principal_portion);
      }
    }
    if (!isClosed && outstanding > 0.5) {
      flows.push({ date: today, amount: outstanding });
    }
  }

  if (isClosed && loan.closure_date && loan.closure_settlement_amount != null) {
    flows.push({ date: new Date(loan.closure_date), amount: Number(loan.closure_settlement_amount) });
  }

  return calculateXIRR(flows);
}

export interface LoanXirrResult {
  loanId: string;
  referralId: string;
  loanAmount: number;
  planned: number | null;
  actual: number | null;
}

// Capital-weighted average across loans (weight = loan_amount). This is how
// Planned/Actual XIRR are rolled up to portfolio and per-referral level —
// each loan keeps its own XIRR (cash-flow-based for EMI, the flat rate for
// On-Call) rather than pooling every loan's cash flows into one XIRR calc,
// which would be mathematically murky when mixing fixed-rate and
// schedule-based instruments together.
export function weightedAverageXirr(results: LoanXirrResult[], pick: "planned" | "actual"): number | null {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const r of results) {
    const value = pick === "planned" ? r.planned : r.actual;
    if (value === null) continue;
    weightedSum += value * r.loanAmount;
    totalWeight += r.loanAmount;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

const TOLERANCE = 0.0005; // 0.05 percentage points

export type XirrComparison = "AHEAD" | "ON_TRACK" | "BEHIND";

export function compareXirr(actual: number | null, planned: number | null): XirrComparison | null {
  if (actual === null || planned === null) return null;
  const diff = actual - planned;
  if (Math.abs(diff) <= TOLERANCE) return "ON_TRACK";
  return diff > 0 ? "AHEAD" : "BEHIND";
}

// Everything the Dashboard's deeper analytics sections need: referral
// performance, concentration (top borrowers / capital by lender),
// interest-structure and moratorium breakdowns, and biggest yield leakage.
// All computed live from ACTIVE loans and their real EMI receipts — nothing
// here is pre-aggregated or stored separately.

import type { SupabaseClient } from "@supabase/supabase-js";
import { toISODateString } from "@/lib/format";
import { getInstallmentStatus } from "@/lib/installmentStatus";
import { getPlannedXirr, getActualXirr, type XirrLoan, type XirrInstallment } from "@/lib/loanXirr";
import type { EmiInterestMethod } from "@/lib/emiSchedule";

const SHORT_INTEREST_LABELS: Record<EmiInterestMethod, string> = {
  FLAT_MONTHLY: "Monthly, flat rate",
  LUMPSUM_ADVANCE: "Lumpsum in advance",
  PA_DIVIDED_365: "Monthly, p.a./365",
};

interface RawLoan {
  id: string;
  referral_id: string;
  lender_name: string;
  loan_type: "EMI" | "ON_CALL";
  loan_amount: number;
  disbursement_date: string;
  status: "ACTIVE" | "CLOSED";
  closure_date: string | null;
  closure_settlement_amount: number | null;
  oncall_annual_rate: number | null;
  emi_interest_method: EmiInterestMethod | null;
  emi_moratorium_months: number | null;
  borrowers: { name: string } | null;
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
  receipt_date: string;
  received_amount: number;
  tds_amount: number;
}

interface LoanAnalytics {
  loanId: string;
  referralId: string;
  lenderName: string;
  borrowerName: string;
  loanAmount: number;
  loanType: "EMI" | "ON_CALL";
  interestMethod: EmiInterestMethod | null;
  hasMoratorium: boolean;
  planned: number | null;
  actual: number | null;
  dueCount: number;
  lateCount: number; // OVERDUE + SHORT + PAID_LATE, among due installments
  shortCount: number;
  paidLateDelayDays: number[]; // one entry per PAID_LATE installment
}

export interface ReferralPerformanceRow {
  referralId: string;
  loanCount: number;
  capital: number;
  lateRatePct: number | null;
  shortfalls: number;
  avgDelayDays: number | null;
  planned: number | null;
  actual: number | null;
}

export interface ConcentrationRow {
  label: string;
  amount: number;
  percent: number;
}

export interface GroupStatsRow {
  label: string;
  loanCount: number;
  avgDelayDays: number | null;
  actual: number | null;
}

export interface YieldLeakageRow {
  loanId: string;
  borrowerName: string;
  lateCount: number;
  shortCount: number;
  planned: number;
  actual: number;
  leakage: number; // planned - actual
}

export interface DashboardAnalytics {
  referralPerformance: ReferralPerformanceRow[];
  topBorrowers: ConcentrationRow[];
  capitalByLender: ConcentrationRow[];
  byInterestStructure: GroupStatsRow[];
  moratoriumImpact: GroupStatsRow[];
  yieldLeakage: YieldLeakageRow[];
}

function average(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function weightedAverage(entries: { value: number | null; weight: number }[]): number | null {
  let sum = 0;
  let totalWeight = 0;
  for (const e of entries) {
    if (e.value === null) continue;
    sum += e.value * e.weight;
    totalWeight += e.weight;
  }
  return totalWeight === 0 ? null : sum / totalWeight;
}

export async function getDashboardAnalytics(
  supabase: SupabaseClient,
  today: Date = new Date()
): Promise<DashboardAnalytics> {
  const { data: loanData } = await supabase
    .from("loans")
    .select(
      "id, referral_id, lender_name, loan_type, loan_amount, disbursement_date, status, closure_date, closure_settlement_amount, oncall_annual_rate, emi_interest_method, emi_moratorium_months, borrowers(name)"
    )
    .eq("status", "ACTIVE");
  const loans = (loanData as unknown as RawLoan[]) ?? [];
  if (loans.length === 0) {
    return {
      referralPerformance: [],
      topBorrowers: [],
      capitalByLender: [],
      byInterestStructure: [],
      moratoriumImpact: [],
      yieldLeakage: [],
    };
  }

  const emiLoanIds = loans.filter((l) => l.loan_type === "EMI").map((l) => l.id);
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
        .select("installment_id, receipt_date, received_amount, tds_amount")
        .in("installment_id", instIds);
      for (const r of (receiptData as RawReceipt[]) ?? []) {
        const list = receiptsByInstallment.get(r.installment_id) ?? [];
        list.push(r);
        receiptsByInstallment.set(r.installment_id, list);
      }
    }
  }

  const todayStr = toISODateString(today);
  const loanAnalytics: LoanAnalytics[] = loans.map((loan) => {
    const installments = installmentsByLoan.get(loan.id) ?? [];

    let dueCount = 0;
    let lateCount = 0;
    let shortCount = 0;
    const paidLateDelayDays: number[] = [];

    const xirrInstallments: XirrInstallment[] = installments.map((inst) => {
      const receipts = receiptsByInstallment.get(inst.id) ?? [];
      const totalDue = Number(inst.interest_due) + Number(inst.principal_due);
      const totalReceived = receipts.reduce((s, r) => s + Number(r.received_amount) + Number(r.tds_amount), 0);
      const lastReceiptDate = receipts.length > 0 ? receipts.map((r) => r.receipt_date).sort().slice(-1)[0] : null;

      if (inst.due_date <= todayStr) {
        dueCount++;
        const { status } = getInstallmentStatus(totalDue, totalReceived, lastReceiptDate, inst.due_date, todayStr);
        if (status !== "PAID" && status !== "PENDING") lateCount++;
        if (status === "SHORT") shortCount++;
        if (status === "PAID_LATE" && lastReceiptDate) {
          const days = Math.round(
            (new Date(lastReceiptDate).getTime() - new Date(inst.due_date).getTime()) / 86400000
          );
          paidLateDelayDays.push(days);
        }
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
    const planned = getPlannedXirr(xirrLoan, xirrInstallments);
    const actual = getActualXirr(xirrLoan, xirrInstallments, [], today);

    return {
      loanId: loan.id,
      referralId: loan.referral_id,
      lenderName: loan.lender_name,
      borrowerName: loan.borrowers?.name ?? "Unknown",
      loanAmount: Number(loan.loan_amount),
      loanType: loan.loan_type,
      interestMethod: loan.emi_interest_method,
      hasMoratorium: (loan.emi_moratorium_months ?? 0) > 0,
      planned,
      actual,
      dueCount,
      lateCount,
      shortCount,
      paidLateDelayDays,
    };
  });

  // ---- Referral performance ----
  const byReferral = new Map<string, LoanAnalytics[]>();
  for (const la of loanAnalytics) {
    const list = byReferral.get(la.referralId) ?? [];
    list.push(la);
    byReferral.set(la.referralId, list);
  }
  const referralPerformance: ReferralPerformanceRow[] = Array.from(byReferral.entries()).map(
    ([referralId, group]) => {
      const dueCount = group.reduce((s, g) => s + g.dueCount, 0);
      const lateCount = group.reduce((s, g) => s + g.lateCount, 0);
      const shortfalls = group.reduce((s, g) => s + g.shortCount, 0);
      const delays = group.flatMap((g) => g.paidLateDelayDays);
      return {
        referralId,
        loanCount: group.length,
        capital: group.reduce((s, g) => s + g.loanAmount, 0),
        lateRatePct: dueCount > 0 ? (lateCount / dueCount) * 100 : null,
        shortfalls,
        avgDelayDays: average(delays),
        planned: weightedAverage(group.map((g) => ({ value: g.planned, weight: g.loanAmount }))),
        actual: weightedAverage(group.map((g) => ({ value: g.actual, weight: g.loanAmount }))),
      };
    }
  );

  // ---- Concentration: top borrowers ----
  const byBorrower = new Map<string, number>();
  for (const la of loanAnalytics) {
    byBorrower.set(la.borrowerName, (byBorrower.get(la.borrowerName) ?? 0) + la.loanAmount);
  }
  const totalCapital = loanAnalytics.reduce((s, l) => s + l.loanAmount, 0);
  const topBorrowers: ConcentrationRow[] = Array.from(byBorrower.entries())
    .map(([label, amount]) => ({ label, amount, percent: totalCapital > 0 ? (amount / totalCapital) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // ---- Concentration: capital by lender ----
  const byLender = new Map<string, number>();
  for (const la of loanAnalytics) {
    byLender.set(la.lenderName, (byLender.get(la.lenderName) ?? 0) + la.loanAmount);
  }
  const capitalByLender: ConcentrationRow[] = Array.from(byLender.entries())
    .map(([label, amount]) => ({ label, amount, percent: totalCapital > 0 ? (amount / totalCapital) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);

  // ---- By interest structure (EMI only) ----
  const emiLoans = loanAnalytics.filter((l) => l.loanType === "EMI" && l.interestMethod);
  const byMethod = new Map<EmiInterestMethod, LoanAnalytics[]>();
  for (const la of emiLoans) {
    const method = la.interestMethod as EmiInterestMethod;
    const list = byMethod.get(method) ?? [];
    list.push(la);
    byMethod.set(method, list);
  }
  const byInterestStructure: GroupStatsRow[] = Array.from(byMethod.entries()).map(([method, group]) => ({
    label: SHORT_INTEREST_LABELS[method],
    loanCount: group.length,
    avgDelayDays: average(group.flatMap((g) => g.paidLateDelayDays)),
    actual: weightedAverage(group.map((g) => ({ value: g.actual, weight: g.loanAmount }))),
  }));

  // ---- Moratorium impact (EMI only) ----
  const withMoratorium = emiLoans.filter((l) => l.hasMoratorium);
  const withoutMoratorium = emiLoans.filter((l) => !l.hasMoratorium);
  const moratoriumImpact: GroupStatsRow[] = [
    {
      label: "With moratorium",
      loanCount: withMoratorium.length,
      avgDelayDays: average(withMoratorium.flatMap((g) => g.paidLateDelayDays)),
      actual: weightedAverage(withMoratorium.map((g) => ({ value: g.actual, weight: g.loanAmount }))),
    },
    {
      label: "No moratorium",
      loanCount: withoutMoratorium.length,
      avgDelayDays: average(withoutMoratorium.flatMap((g) => g.paidLateDelayDays)),
      actual: weightedAverage(withoutMoratorium.map((g) => ({ value: g.actual, weight: g.loanAmount }))),
    },
  ].filter((row) => row.loanCount > 0);

  // ---- Biggest yield leakage (per loan) ----
  const yieldLeakage: YieldLeakageRow[] = loanAnalytics
    .filter((l) => l.planned !== null && l.actual !== null)
    .map((l) => ({
      loanId: l.loanId,
      borrowerName: l.borrowerName,
      lateCount: l.lateCount,
      shortCount: l.shortCount,
      planned: l.planned as number,
      actual: l.actual as number,
      leakage: (l.planned as number) - (l.actual as number),
    }))
    .sort((a, b) => b.leakage - a.leakage)
    .slice(0, 10);

  return { referralPerformance, topBorrowers, capitalByLender, byInterestStructure, moratoriumImpact, yieldLeakage };
}

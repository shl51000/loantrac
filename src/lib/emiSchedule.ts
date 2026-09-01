// EMI repayment schedule generator.
//
// 3 interest collection methods x 2 principal repayment methods, with an
// optional moratorium (months with no principal due yet). Due dates land on
// the same day-of-month as the disbursement date, one calendar month apart
// (clamped to the last day of a shorter month), except the special
// LUMPSUM_ADVANCE interest row which is due the day after disbursement.

import { addDays, toISODateString } from "@/lib/format";

export type EmiInterestMethod = "FLAT_MONTHLY" | "LUMPSUM_ADVANCE" | "PA_DIVIDED_365";
export type EmiPrincipalMethod = "MONTHWISE" | "LUMPSUM";

export const INTEREST_METHOD_LABELS: Record<EmiInterestMethod, string> = {
  FLAT_MONTHLY: "Flat monthly on outstanding",
  LUMPSUM_ADVANCE: "Lumpsum in advance",
  PA_DIVIDED_365: "Monthly, per-annum ÷ 365 exact days",
};

export const PRINCIPAL_METHOD_LABELS: Record<EmiPrincipalMethod, string> = {
  MONTHWISE: "Month-wise even split",
  LUMPSUM: "Lumpsum in final month",
};

export interface EmiScheduleParams {
  disbursementDate: Date;
  loanAmount: number;
  interestRate: number; // annual percent, e.g. 12 for 12% p.a.
  tenureMonths: number;
  moratoriumMonths: number;
  interestMethod: EmiInterestMethod;
  principalMethod: EmiPrincipalMethod;
}

export interface GeneratedInstallment {
  installment_number: number;
  due_date: string; // ISO yyyy-mm-dd
  interest_due: number;
  principal_due: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Same day-of-month, `months` later; clamps to the last day of the target
// month (e.g. 31 Jan + 1 month -> 28/29 Feb, not 3 Mar).
function addCalendarMonths(date: Date, months: number): Date {
  const targetMonthIndex = date.getMonth() + months;
  const daysInTargetMonth = new Date(date.getFullYear(), targetMonthIndex + 1, 0).getDate();
  const day = Math.min(date.getDate(), daysInTargetMonth);
  return new Date(date.getFullYear(), targetMonthIndex, day);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function buildPrincipalSchedule(
  loanAmount: number,
  tenureMonths: number,
  moratoriumMonths: number,
  principalMethod: EmiPrincipalMethod
): number[] {
  const principalDue = new Array(tenureMonths).fill(0);

  if (principalMethod === "LUMPSUM") {
    principalDue[tenureMonths - 1] = loanAmount;
    return principalDue;
  }

  const payingMonths = tenureMonths - moratoriumMonths;
  if (payingMonths <= 0) {
    throw new Error("Moratorium must be shorter than the tenure.");
  }
  const evenShare = round2(loanAmount / payingMonths);
  let allocated = 0;
  for (let i = moratoriumMonths; i < tenureMonths; i++) {
    const isLast = i === tenureMonths - 1;
    principalDue[i] = isLast ? round2(loanAmount - allocated) : evenShare;
    allocated += principalDue[i];
  }
  return principalDue;
}

export function generateEmiSchedule(params: EmiScheduleParams): GeneratedInstallment[] {
  const {
    disbursementDate,
    loanAmount,
    interestRate,
    tenureMonths,
    moratoriumMonths,
    interestMethod,
    principalMethod,
  } = params;

  const dueDates = Array.from({ length: tenureMonths }, (_, i) =>
    addCalendarMonths(disbursementDate, i + 1)
  );
  const principalDue = buildPrincipalSchedule(loanAmount, tenureMonths, moratoriumMonths, principalMethod);

  if (interestMethod === "LUMPSUM_ADVANCE") {
    // Unlike the other two methods, this rate is per month, not per annum:
    // interest = principal * (rate p.m. * tenure).
    const totalInterest = round2(loanAmount * (interestRate / 100) * tenureMonths);
    const advanceRow: GeneratedInstallment = {
      installment_number: 1,
      due_date: toISODateString(addDays(disbursementDate, 1)),
      interest_due: totalInterest,
      principal_due: 0,
    };
    const principalRows: GeneratedInstallment[] = dueDates.map((due, i) => ({
      installment_number: i + 2,
      due_date: toISODateString(due),
      interest_due: 0,
      principal_due: principalDue[i],
    }));
    return [advanceRow, ...principalRows];
  }

  let outstanding = loanAmount;
  let prevDate = disbursementDate;
  const rows: GeneratedInstallment[] = [];
  for (let i = 0; i < tenureMonths; i++) {
    const due = dueDates[i];
    const interest =
      interestMethod === "FLAT_MONTHLY"
        ? round2(outstanding * (interestRate / 100 / 12))
        : round2(outstanding * (interestRate / 100) * (daysBetween(prevDate, due) / 365));

    rows.push({
      installment_number: i + 1,
      due_date: toISODateString(due),
      interest_due: interest,
      principal_due: principalDue[i],
    });

    outstanding = round2(outstanding - principalDue[i]);
    prevDate = due;
  }
  return rows;
}

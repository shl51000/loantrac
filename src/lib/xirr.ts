// Generic XIRR (money-weighted annual rate of return) solver, via bisection
// on NPV. Assumes the cash-flow stream has at least one negative and one
// positive amount — true for every shape this app builds (an outflow at
// disbursement/draw time, inflows from receipts/repayments). Bisection is
// used instead of Newton's method because it can't diverge: as long as we
// can bracket a sign change in NPV(rate), it's guaranteed to converge.

export interface CashFlow {
  date: Date;
  amount: number;
}

const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;

function npv(sorted: CashFlow[], years: number[], rate: number): number {
  let sum = 0;
  for (let i = 0; i < sorted.length; i++) {
    sum += sorted[i].amount / Math.pow(1 + rate, years[i]);
  }
  return sum;
}

// Returns the annual rate as a decimal (0.12 = 12%), or null if no solution
// could be found (e.g. all cash flows are the same sign).
export function calculateXIRR(cashFlows: CashFlow[]): number | null {
  if (cashFlows.length < 2) return null;
  const hasNeg = cashFlows.some((cf) => cf.amount < 0);
  const hasPos = cashFlows.some((cf) => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  const sorted = [...cashFlows].sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sorted[0].date.getTime();
  const years = sorted.map((cf) => (cf.date.getTime() - t0) / MS_PER_YEAR);

  let lo = -0.9999;
  let hi = 10;
  let fLo = npv(sorted, years, lo);
  let fHi = npv(sorted, years, hi);

  let expandGuard = 0;
  while (fLo * fHi > 0 && hi < 1000 && expandGuard < 50) {
    hi *= 2;
    fHi = npv(sorted, years, hi);
    expandGuard++;
  }
  if (fLo * fHi > 0) return null;

  let mid = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    mid = (lo + hi) / 2;
    const fMid = npv(sorted, years, mid);
    if (Math.abs(fMid) < 1e-6) return mid;
    if (fLo < 0 === fMid < 0) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return mid;
}

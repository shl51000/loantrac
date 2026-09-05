// On-Call loan interest accrual: day-count (actual/365) accrual on the
// loan's outstanding principal, at its contracted annual rate, walking the
// principal's real balance history (disbursement, draws, repayments).

export interface OncallLoanInfo {
  disbursement_date: string;
  loan_amount: number;
  oncall_annual_rate: number | null;
}

export interface OncallTransactionInfo {
  transaction_type: "DRAW" | "REPAYMENT";
  transaction_date: string;
  principal_portion: number;
  interest_portion: number;
  tds_on_interest: number;
}

export interface OncallAccrual {
  outstandingPrincipal: number;
  accruedInterest: number;
  interestReceived: number;
  unpaidAccruedInterest: number;
  totalOwedToday: number;
}

// Whole days between two ISO (yyyy-mm-dd) dates, computed in UTC so DST
// shifts near midnight can't skew the count by a day.
function isoDaysBetween(fromDate: string, toDate: string): number {
  const [fy, fm, fd] = fromDate.split("-").map(Number);
  const [ty, tm, td] = toDate.split("-").map(Number);
  const from = Date.UTC(fy, fm - 1, fd);
  const to = Date.UTC(ty, tm - 1, td);
  return Math.round((to - from) / 86400000);
}

export function getOncallAccrual(
  loan: OncallLoanInfo,
  transactions: OncallTransactionInfo[],
  asOfIso: string
): OncallAccrual {
  const rate = loan.oncall_annual_rate != null ? Number(loan.oncall_annual_rate) / 100 : 0;

  const events: { date: string; principalDelta: number }[] = [
    { date: loan.disbursement_date, principalDelta: Number(loan.loan_amount) },
  ];
  let interestReceived = 0;
  for (const t of transactions) {
    if (t.transaction_type === "DRAW") {
      events.push({ date: t.transaction_date, principalDelta: Number(t.principal_portion) });
    } else {
      events.push({ date: t.transaction_date, principalDelta: -Number(t.principal_portion) });
      interestReceived += Number(t.interest_portion) + Number(t.tds_on_interest);
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  let balance = 0;
  let accruedInterest = 0;
  for (let i = 0; i < events.length; i++) {
    balance += events[i].principalDelta;
    if (events[i].date > asOfIso) continue;
    const segmentEnd = i + 1 < events.length && events[i + 1].date < asOfIso ? events[i + 1].date : asOfIso;
    const days = isoDaysBetween(events[i].date, segmentEnd);
    if (days > 0 && balance > 0) {
      accruedInterest += balance * rate * (days / 365);
    }
  }

  const outstandingPrincipal = Math.max(0, balance);
  const unpaidAccruedInterest = Math.max(0, accruedInterest - interestReceived);

  return {
    outstandingPrincipal,
    accruedInterest,
    interestReceived,
    unpaidAccruedInterest,
    totalOwedToday: outstandingPrincipal + unpaidAccruedInterest,
  };
}

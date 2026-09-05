"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { formatDate, formatINR, toISODateString } from "@/lib/format";
import { getReferralColor } from "@/lib/referralColors";
import { getReminderCount } from "@/lib/reminders";
import { exportBackup } from "@/lib/exportBackup";
import { onLoansChanged } from "@/lib/loansRefresh";
import { getInstallmentStatus } from "@/lib/installmentStatus";
import { getOncallAccrual } from "@/lib/oncallAccrual";
import { isAdvanceInterestMethod, type EmiInterestMethod } from "@/lib/emiSchedule";
import { getErrorMessage } from "@/lib/errors";
import { IconBarChart, IconPlus, IconCalendar, IconWarning, IconUsers } from "@/components/icons";

const MOBILE_BREAKPOINT = 768;

type SortOption = "date-asc" | "date-desc" | "name-asc" | "name-desc";

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "name-asc", label: "A to Z ▲" },
  { value: "name-desc", label: "Z to A ▼" },
  { value: "date-asc", label: "Date ▲" },
  { value: "date-desc", label: "Date ▼" },
];

interface Referral {
  id: string;
  name: string;
  color_seq: number;
}

interface ActiveLoan {
  id: string;
  lender_name: string;
  loan_amount: number;
  disbursement_date: string;
  referral_id: string;
  loan_type: "EMI" | "ON_CALL";
  emi_interest_method: EmiInterestMethod | null;
  oncall_annual_rate: number | null;
  borrowers: { name: string } | null;
}

interface EmiProgress {
  paid: number;
  total: number;
}

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: IconBarChart, primary: true },
  { href: "/new-loan", label: "New loan", icon: IconPlus },
  { href: "/calendar", label: "Repayment calendar", icon: IconCalendar },
  { href: "/reminders", label: "Reminders", icon: IconWarning, showReminderBadge: true },
  { href: "/borrowers", label: "Borrowers", icon: IconUsers },
];

export default function Sidebar() {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    function check() {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  if (isMobile === null) return null;

  return (
    <>
      {isMobile && (
        <div className="print-hide fixed top-0 left-0 right-0 z-30 h-14 bg-slate-900 flex items-center gap-3 px-4">
          <button
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="text-white p-2 -ml-2"
          >
            <span className="block w-6 h-0.5 bg-white mb-1.5" />
            <span className="block w-6 h-0.5 bg-white mb-1.5" />
            <span className="block w-6 h-0.5 bg-white" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 border-2 border-slate-300 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-serif font-bold text-teal-400">SF</span>
            </div>
            <span className="text-white font-bold text-lg">LoanTrac</span>
          </div>
        </div>
      )}

      {isMobile && drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <div
        className={
          "print-hide " +
          (isMobile
            ? "fixed top-0 left-0 bottom-0 z-50 w-72 bg-slate-900 transform transition-transform duration-200 overflow-y-auto " +
              (drawerOpen ? "translate-x-0" : "-translate-x-full")
            : "fixed top-0 left-0 bottom-0 w-64 bg-slate-900 overflow-y-auto")
        }
      >
        <SidebarContent onNavigate={() => setDrawerOpen(false)} />
      </div>
    </>
  );
}

function SidebarContent({ onNavigate }: { onNavigate: () => void }) {
  const [supabase] = useState(() => createClient());
  const pathname = usePathname();
  const { isAdmin } = useAuth();

  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [activeReferralId, setActiveReferralId] = useState<string | null>(null);
  const [loans, setLoans] = useState<ActiveLoan[]>([]);
  const [emiProgressByLoan, setEmiProgressByLoan] = useState<Map<string, EmiProgress>>(new Map());
  const [oncallOutstandingByLoan, setOncallOutstandingByLoan] = useState<Map<string, number>>(new Map());
  const [sort, setSort] = useState<SortOption>("name-asc");
  const [closedCount, setClosedCount] = useState(0);
  const [reminderCount, setReminderCount] = useState(0);
  const [exporting, setExporting] = useState(false);

  const loadData = useCallback(async () => {
    const [{ data: referralData }, { data: loanData }, { count }, reminders] =
      await Promise.all([
        supabase.from("referrals").select("id, name, color_seq").order("color_seq"),
        supabase
          .from("loans")
          .select(
            "id, lender_name, loan_amount, disbursement_date, referral_id, loan_type, emi_interest_method, oncall_annual_rate, borrowers(name)"
          )
          .eq("status", "ACTIVE"),
        supabase
          .from("loans")
          .select("id", { count: "exact", head: true })
          .eq("status", "CLOSED"),
        getReminderCount(supabase),
      ]);

    const activeLoans = (loanData as unknown as ActiveLoan[]) ?? [];
    setReferrals((referralData as Referral[]) ?? []);
    setLoans(activeLoans);

    const emiLoans = activeLoans.filter((l) => l.loan_type === "EMI");
    if (emiLoans.length > 0) {
      const emiLoanIds = emiLoans.map((l) => l.id);
      const { data: instData } = await supabase
        .from("emi_installments")
        .select("id, loan_id, installment_number, due_date, interest_due, principal_due")
        .in("loan_id", emiLoanIds);
      const instRows =
        (instData as {
          id: string;
          loan_id: string;
          installment_number: number;
          due_date: string;
          interest_due: number;
          principal_due: number;
        }[]) ?? [];
      const instIds = instRows.map((i) => i.id);

      const receiptsByInstallment = new Map<string, { receipt_date: string; received_amount: number; tds_amount: number }[]>();
      if (instIds.length > 0) {
        const { data: receiptData } = await supabase
          .from("emi_receipts")
          .select("installment_id, receipt_date, received_amount, tds_amount")
          .in("installment_id", instIds);
        for (const r of (receiptData as { installment_id: string; receipt_date: string; received_amount: number; tds_amount: number }[]) ?? []) {
          const list = receiptsByInstallment.get(r.installment_id) ?? [];
          list.push(r);
          receiptsByInstallment.set(r.installment_id, list);
        }
      }

      const today = toISODateString(new Date());
      const progress = new Map<string, EmiProgress>();
      for (const loan of emiLoans) {
        const isAdvanceRow = (n: number) => isAdvanceInterestMethod(loan.emi_interest_method) && n === 1;
        // Moratorium months carry nothing due, so they don't count as a step
        // in the "x paid of y" tally either.
        const loanInstallments = instRows.filter(
          (i) =>
            i.loan_id === loan.id &&
            !isAdvanceRow(i.installment_number) &&
            Number(i.interest_due) + Number(i.principal_due) > 0.5
        );
        let paid = 0;
        for (const inst of loanInstallments) {
          const receipts = receiptsByInstallment.get(inst.id) ?? [];
          const totalDue = Number(inst.interest_due) + Number(inst.principal_due);
          const totalReceived = receipts.reduce((s, r) => s + Number(r.received_amount) + Number(r.tds_amount), 0);
          const lastReceiptDate = receipts.length > 0 ? receipts.map((r) => r.receipt_date).sort().slice(-1)[0] : null;
          const { status } = getInstallmentStatus(totalDue, totalReceived, lastReceiptDate, inst.due_date, today);
          if (status === "PAID" || status === "PAID_LATE") paid++;
        }
        progress.set(loan.id, { paid, total: loanInstallments.length });
      }
      setEmiProgressByLoan(progress);
    } else {
      setEmiProgressByLoan(new Map());
    }

    const oncallLoans = activeLoans.filter((l) => l.loan_type === "ON_CALL");
    if (oncallLoans.length > 0) {
      const oncallLoanIds = oncallLoans.map((l) => l.id);
      const { data: txnData } = await supabase
        .from("oncall_transactions")
        .select("loan_id, transaction_type, transaction_date, principal_portion, interest_portion, tds_on_interest")
        .in("loan_id", oncallLoanIds);
      const txnRows =
        (txnData as {
          loan_id: string;
          transaction_type: "DRAW" | "REPAYMENT";
          transaction_date: string;
          principal_portion: number;
          interest_portion: number;
          tds_on_interest: number;
        }[]) ?? [];

      const today = toISODateString(new Date());
      const outstanding = new Map<string, number>();
      for (const loan of oncallLoans) {
        const loanTxns = txnRows.filter((t) => t.loan_id === loan.id);
        const accrual = getOncallAccrual(loan, loanTxns, today);
        outstanding.set(loan.id, accrual.outstandingPrincipal);
      }
      setOncallOutstandingByLoan(outstanding);
    } else {
      setOncallOutstandingByLoan(new Map());
    }

    setClosedCount(count ?? 0);
    setReminderCount(reminders);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      await loadData();
    })();
  }, [loadData]);

  useEffect(() => onLoansChanged(loadData), [loadData]);

  const referralById = new Map(referrals.map((r) => [r.id, r]));

  const filteredLoans = loans.filter(
    (l) => !activeReferralId || l.referral_id === activeReferralId
  );

  const sortedLoans = [...filteredLoans].sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return (a.borrowers?.name ?? "").localeCompare(b.borrowers?.name ?? "");
      case "name-desc":
        return (b.borrowers?.name ?? "").localeCompare(a.borrowers?.name ?? "");
      case "date-asc":
        return a.disbursement_date.localeCompare(b.disbursement_date);
      case "date-desc":
        return b.disbursement_date.localeCompare(a.disbursement_date);
      default:
        return 0;
    }
  });

  async function handleExport() {
    setExporting(true);
    try {
      await exportBackup(supabase);
    } catch (err) {
      alert(getErrorMessage(err, "Export failed"));
    } finally {
      setExporting(false);
    }
  }

  function handleImportClick() {
    alert("Import backup will be available once we're ready to migrate your historical data.");
  }

  return (
    <div className="flex flex-col min-h-full text-slate-200 pb-4">
      <div className="p-5 pb-4 hidden md:block">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 border-2 border-slate-300 flex items-center justify-center shrink-0">
            <span className="text-sm font-serif font-bold text-teal-400">SF</span>
          </div>
          <span className="text-white font-bold text-lg leading-tight">LoanTrac</span>
        </div>
        <div className="text-teal-400 text-xs leading-tight mt-1 pl-[52px]">Payment &amp; XIRR tracker</div>
      </div>

      <nav className="px-3 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          const base =
            "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors";
          const style = item.primary
            ? "bg-teal-600 text-white hover:bg-teal-700"
            : active
            ? "bg-slate-800 text-white border border-slate-600"
            : "border border-slate-700 text-slate-200 hover:bg-slate-800";
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`${base} ${style}`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.showReminderBadge && reminderCount > 0 && (
                <span className="bg-rose-600 text-white text-xs font-bold rounded-full px-2 py-0.5">
                  {reminderCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {referrals.length > 0 && (
        <div className="px-3 mt-3 flex flex-nowrap gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveReferralId(null)}
            className={
              "shrink-0 text-xs font-semibold rounded-full px-2 py-1 " +
              (activeReferralId === null
                ? "bg-white text-slate-900"
                : "bg-slate-800 text-slate-300 hover:bg-slate-700")
            }
          >
            All
          </button>
          {referrals.map((r) => {
            const color = getReferralColor(r.color_seq);
            const active = activeReferralId === r.id;
            return (
              <button
                key={r.id}
                onClick={() => setActiveReferralId(r.id)}
                className={
                  "shrink-0 text-xs font-semibold rounded-full px-2 py-1 flex items-center gap-1 " +
                  (active ? color.tabActiveBg + " " + color.tabActiveText : "bg-slate-800 text-slate-300 hover:bg-slate-700")
                }
              >
                <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                {r.name}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-3 mt-3 flex items-center justify-between">
        <Link
          href="/active-loans"
          onClick={onNavigate}
          className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400 font-semibold hover:text-white"
        >
          Active loans
          <span className="text-xs normal-case bg-slate-800 rounded-full px-2 py-0.5">{loans.length}</span>
        </Link>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="bg-slate-800 text-slate-200 text-xs rounded px-1.5 py-1 border border-slate-700"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="px-3 mt-2 flex-1 space-y-1.5">
        {sortedLoans.length === 0 && (
          <p className="text-xs text-slate-500 px-1 py-2">
            No active loans yet.{" "}
            <Link href="/new-loan" onClick={onNavigate} className="text-teal-400 hover:underline">
              Create your first loan
            </Link>
            .
          </p>
        )}
        {sortedLoans.map((loan) => {
          const referral = referralById.get(loan.referral_id);
          const dotClass = referral ? getReferralColor(referral.color_seq).dot : "bg-slate-500";
          return (
            <Link
              key={loan.id}
              href={`/loans/${loan.id}`}
              onClick={onNavigate}
              className="block rounded-lg bg-slate-800/60 hover:bg-slate-800 px-3 py-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-white truncate">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass}`} />
                    <span className="truncate">{loan.borrowers?.name ?? "Unknown borrower"}</span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {formatINR(
                      loan.loan_type === "ON_CALL" ? oncallOutstandingByLoan.get(loan.id) ?? loan.loan_amount : loan.loan_amount
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs text-slate-400">
                    {loan.loan_type === "ON_CALL"
                      ? "On-call"
                      : `${emiProgressByLoan.get(loan.id)?.paid ?? 0} / ${emiProgressByLoan.get(loan.id)?.total ?? 0}`}
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">{formatDate(loan.disbursement_date)}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="px-3 mt-3">
        <Link
          href="/closed-loans"
          onClick={onNavigate}
          className="flex items-center justify-between text-sm text-slate-300 hover:text-white px-1 py-1.5"
        >
          <span>Closed loans</span>
          <span className="text-xs bg-slate-800 rounded-full px-2 py-0.5">{closedCount}</span>
        </Link>
      </div>

      <div className="px-3 mt-2 pt-2 border-t border-slate-800 space-y-1">
        {isAdmin && (
          <div className="flex items-center gap-3 px-1 py-1">
            <Link href="/users" onClick={onNavigate} className="text-sm text-slate-300 hover:text-white">
              Users
            </Link>
            <Link href="/borrowers/manage" onClick={onNavigate} className="text-sm text-slate-300 hover:text-white">
              Borrowers
            </Link>
            <Link href="/referrals" onClick={onNavigate} className="text-sm text-slate-300 hover:text-white">
              Referrals
            </Link>
          </div>
        )}
        <div className="flex items-center gap-3 px-1 py-1">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-sm text-slate-300 hover:text-white disabled:opacity-60"
          >
            {exporting ? "Exporting…" : "Export"}
          </button>
          <span className="text-slate-700">/</span>
          <button
            onClick={handleImportClick}
            disabled={!isAdmin}
            className={isAdmin ? "text-sm text-slate-300 hover:text-white" : "text-sm text-slate-600 cursor-not-allowed"}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

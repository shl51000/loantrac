"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatINR } from "@/lib/format";
import { getReferralColor } from "@/lib/referralColors";
import { getAllLoanXirrResults } from "@/lib/portfolioXirr";
import { compareXirr, type LoanXirrResult } from "@/lib/loanXirr";
import { getTotalDrawsByLoan } from "@/lib/oncallDraws";

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

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
  loan_type: "EMI" | "ON_CALL";
  referral_id: string;
  disbursement_date: string;
  borrowers: { name: string } | null;
}

export default function ActiveLoansPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<ActiveLoan[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [activeReferralId, setActiveReferralId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("name-asc");
  const [xirrResults, setXirrResults] = useState<LoanXirrResult[]>([]);
  const [drawsByLoan, setDrawsByLoan] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [{ data: loanData }, { data: referralData }, xirr] = await Promise.all([
        supabase
          .from("loans")
          .select("id, lender_name, loan_amount, loan_type, referral_id, disbursement_date, borrowers(name)")
          .eq("status", "ACTIVE"),
        supabase.from("referrals").select("id, name, color_seq").order("color_seq"),
        getAllLoanXirrResults(supabase),
      ]);
      if (!mounted) return;
      const loans = (loanData as unknown as ActiveLoan[]) ?? [];
      setLoans(loans);
      setReferrals((referralData as Referral[]) ?? []);
      setXirrResults(xirr);

      const oncallLoanIds = loans.filter((l) => l.loan_type === "ON_CALL").map((l) => l.id);
      const draws = await getTotalDrawsByLoan(supabase, oncallLoanIds);
      if (!mounted) return;
      setDrawsByLoan(draws);
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const filteredLoans = loans.filter((l) => !activeReferralId || l.referral_id === activeReferralId);

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

  const referralById = new Map(referrals.map((r) => [r.id, r]));
  const xirrByLoanId = new Map(xirrResults.map((r) => [r.loanId, r]));

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">Active loans</h1>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setActiveReferralId(null)}
            className={
              "text-xs font-semibold rounded-full px-2.5 py-1 " +
              (activeReferralId === null ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200")
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
                  "text-xs font-semibold rounded-full px-2.5 py-1 flex items-center gap-1.5 " +
                  (active ? `${color.badgeBg} ${color.badgeText}` : "bg-slate-100 text-slate-600 hover:bg-slate-200")
                }
              >
                <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
                {r.name}
              </button>
            );
          })}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortOption)}
          className="bg-white text-slate-700 text-sm rounded-lg px-2 py-1.5 border border-slate-300"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {sortedLoans.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          No active loans yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">Borrower</th>
                <th className="px-4 py-3">Lender</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Referral</th>
                <th className="px-4 py-3">Loan amount</th>
                <th className="px-4 py-3">Disbursed</th>
                <th className="px-4 py-3">Planned XIRR</th>
                <th className="px-4 py-3">Actual / current XIRR</th>
              </tr>
            </thead>
            <tbody>
              {sortedLoans.map((loan) => {
                const referral = referralById.get(loan.referral_id);
                const color = referral ? getReferralColor(referral.color_seq) : null;
                const xirr = xirrByLoanId.get(loan.id);
                const comparison = compareXirr(xirr?.actual ?? null, xirr?.planned ?? null);
                const actualTone =
                  comparison === "BEHIND" ? "text-rose-600" : comparison === "AHEAD" ? "text-emerald-600" : "text-slate-700";
                return (
                  <tr key={loan.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/loans/${loan.id}`} className="text-teal-700 hover:underline font-medium">
                        {loan.borrowers?.name ?? "Unknown"}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{loan.lender_name}</td>
                    <td className="px-4 py-3">{loan.loan_type === "EMI" ? "EMI" : "On-Call"}</td>
                    <td className="px-4 py-3">
                      {referral && color && (
                        <span className={`text-xs font-semibold rounded-full px-2 py-1 ${color.badgeBg} ${color.badgeText}`}>
                          {referral.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {formatINR(Number(loan.loan_amount) + (drawsByLoan.get(loan.id) ?? 0))}
                    </td>
                    <td className="px-4 py-3">{formatDate(loan.disbursement_date)}</td>
                    <td className="px-4 py-3">{formatPercent(xirr?.planned ?? null)}</td>
                    <td className={`px-4 py-3 font-semibold ${actualTone}`}>{formatPercent(xirr?.actual ?? null)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

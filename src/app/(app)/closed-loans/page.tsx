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

interface ClosedLoan {
  id: string;
  lender_name: string;
  loan_amount: number;
  loan_type: "EMI" | "ON_CALL";
  referral_id: string;
  disbursement_date: string;
  closure_date: string;
  closure_settlement_amount: number;
  borrowers: { name: string } | null;
}

// One row's worth of already-resolved display data, so every column
// definition below can read plain fields instead of re-deriving them.
interface Row {
  id: string;
  borrowerName: string;
  lenderName: string;
  loanType: "EMI" | "ON_CALL";
  referralId: string;
  referralName: string;
  referralColorSeq: number | null;
  loanAmount: number;
  loanDate: string;
  closureDate: string;
  settlementAmount: number;
  plannedXirr: number | null;
  actualXirr: number | null;
  actualTone: string;
}

interface Column {
  key: string;
  label: string;
  getKey: (r: Row) => string;
  getLabel: (r: Row) => string;
  render: (r: Row) => React.ReactNode;
}

export default function ClosedLoansPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [loans, setLoans] = useState<ClosedLoan[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [activeReferralId, setActiveReferralId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>("date-desc");
  const [xirrResults, setXirrResults] = useState<LoanXirrResult[]>([]);
  const [drawsByLoan, setDrawsByLoan] = useState<Map<string, number>>(new Map());
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [{ data: loanData }, { data: referralData }, xirr] = await Promise.all([
        supabase
          .from("loans")
          .select(
            "id, lender_name, loan_amount, loan_type, referral_id, disbursement_date, closure_date, closure_settlement_amount, borrowers(name)"
          )
          .eq("status", "CLOSED"),
        supabase.from("referrals").select("id, name, color_seq").order("color_seq"),
        getAllLoanXirrResults(supabase),
      ]);
      if (!mounted) return;
      const loans = (loanData as unknown as ClosedLoan[]) ?? [];
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

  const referralById = new Map(referrals.map((r) => [r.id, r]));
  const xirrByLoanId = new Map(xirrResults.map((r) => [r.loanId, r]));

  const rows: Row[] = loans.map((loan) => {
    const referral = referralById.get(loan.referral_id);
    const xirr = xirrByLoanId.get(loan.id);
    const comparison = compareXirr(xirr?.actual ?? null, xirr?.planned ?? null);
    return {
      id: loan.id,
      borrowerName: loan.borrowers?.name ?? "Unknown",
      lenderName: loan.lender_name,
      loanType: loan.loan_type,
      referralId: loan.referral_id,
      referralName: referral?.name ?? "—",
      referralColorSeq: referral?.color_seq ?? null,
      loanAmount: Number(loan.loan_amount) + (drawsByLoan.get(loan.id) ?? 0),
      loanDate: loan.disbursement_date,
      closureDate: loan.closure_date,
      settlementAmount: Number(loan.closure_settlement_amount),
      plannedXirr: xirr?.planned ?? null,
      actualXirr: xirr?.actual ?? null,
      actualTone: comparison === "BEHIND" ? "text-rose-600" : comparison === "AHEAD" ? "text-emerald-600" : "text-slate-700",
    };
  });

  const columns: Column[] = [
    {
      key: "borrower",
      label: "Borrower",
      getKey: (r) => r.borrowerName,
      getLabel: (r) => r.borrowerName,
      render: (r) => (
        <Link href={`/loans/${r.id}`} className="text-teal-700 hover:underline font-medium">
          {r.borrowerName}
        </Link>
      ),
    },
    {
      key: "lender",
      label: "Lender",
      getKey: (r) => r.lenderName,
      getLabel: (r) => r.lenderName,
      render: (r) => r.lenderName,
    },
    {
      key: "type",
      label: "Type",
      getKey: (r) => r.loanType,
      getLabel: (r) => (r.loanType === "EMI" ? "EMI" : "On-Call"),
      render: (r) => (r.loanType === "EMI" ? "EMI" : "On-Call"),
    },
    {
      key: "referral",
      label: "Referral",
      getKey: (r) => r.referralId,
      getLabel: (r) => r.referralName,
      render: (r) => {
        const color = r.referralColorSeq != null ? getReferralColor(r.referralColorSeq) : null;
        return color ? (
          <span className={`text-xs font-semibold rounded-full px-2 py-1 ${color.badgeBg} ${color.badgeText}`}>
            {r.referralName}
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      key: "loanAmount",
      label: "Loan amount",
      getKey: (r) => String(r.loanAmount),
      getLabel: (r) => formatINR(r.loanAmount),
      render: (r) => formatINR(r.loanAmount),
    },
    {
      key: "loanDate",
      label: "Loan date",
      getKey: (r) => r.loanDate,
      getLabel: (r) => formatDate(r.loanDate),
      render: (r) => formatDate(r.loanDate),
    },
    {
      key: "closureDate",
      label: "Closure date",
      getKey: (r) => r.closureDate,
      getLabel: (r) => formatDate(r.closureDate),
      render: (r) => formatDate(r.closureDate),
    },
    {
      key: "settlementAmount",
      label: "Settlement amount",
      getKey: (r) => String(r.settlementAmount),
      getLabel: (r) => formatINR(r.settlementAmount),
      render: (r) => formatINR(r.settlementAmount),
    },
    {
      key: "plannedXirr",
      label: "Planned XIRR",
      getKey: (r) => (r.plannedXirr === null ? "—" : r.plannedXirr.toFixed(4)),
      getLabel: (r) => formatPercent(r.plannedXirr),
      render: (r) => formatPercent(r.plannedXirr),
    },
    {
      key: "actualXirr",
      label: "Actual XIRR",
      getKey: (r) => (r.actualXirr === null ? "—" : r.actualXirr.toFixed(4)),
      getLabel: (r) => formatPercent(r.actualXirr),
      render: (r) => <span className={`font-semibold ${r.actualTone}`}>{formatPercent(r.actualXirr)}</span>,
    },
  ];

  // Distinct, sorted {key,label} options per column, built from every
  // closed loan regardless of other active filters — keeps each dropdown's
  // choices stable no matter what else is currently selected.
  const optionsByColumn = new Map<string, { key: string; label: string }[]>();
  for (const col of columns) {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const k = col.getKey(r);
      if (!seen.has(k)) seen.set(k, col.getLabel(r));
    }
    optionsByColumn.set(
      col.key,
      [...seen.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
    );
  }

  const filteredRows = rows.filter((r) => {
    if (activeReferralId && r.referralId !== activeReferralId) return false;
    for (const col of columns) {
      const selected = colFilters[col.key];
      if (selected && col.getKey(r) !== selected) return false;
    }
    return true;
  });

  const sortedRows = [...filteredRows].sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return a.borrowerName.localeCompare(b.borrowerName);
      case "name-desc":
        return b.borrowerName.localeCompare(a.borrowerName);
      case "date-asc":
        return a.loanDate.localeCompare(b.loanDate);
      case "date-desc":
        return b.loanDate.localeCompare(a.loanDate);
      default:
        return 0;
    }
  });

  function setColFilter(key: string, value: string) {
    setColFilters((prev) => ({ ...prev, [key]: value }));
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">Closed loans</h1>

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

      {rows.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          No closed loans yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-3 whitespace-nowrap">
                    {col.label}
                  </th>
                ))}
              </tr>
              <tr className="text-left border-b border-slate-200 bg-slate-50">
                {columns.map((col) => (
                  <th key={col.key} className="px-4 py-2">
                    <select
                      value={colFilters[col.key] ?? ""}
                      onChange={(e) => setColFilter(col.key, e.target.value)}
                      className="w-full max-w-[10rem] bg-white text-slate-600 text-xs rounded border border-slate-300 px-1.5 py-1 font-normal normal-case"
                    >
                      <option value="">All</option>
                      {(optionsByColumn.get(col.key) ?? []).map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-6 text-center text-sm text-slate-500">
                    No closed loans match these filters.
                  </td>
                </tr>
              ) : (
                sortedRows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        {col.render(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

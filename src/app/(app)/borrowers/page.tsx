"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatINR } from "@/lib/format";
import { getBorrowerPerformance, type BorrowerPerformanceRow } from "@/lib/borrowerPerformance";
import { compareXirr } from "@/lib/loanXirr";

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

interface BorrowerRow {
  id: string;
  name: string;
  whatsapp_number: string;
}

interface BorrowerWithStats extends BorrowerRow {
  loanCount: number;
  activeLoanCount: number;
  borrowedCapital: number;
  outstandingAmt: number;
  lateRatePct: number | null;
  planned: number | null;
  actual: number | null;
}

type SortKey = "name" | "borrowedCapital";

const EMPTY_PERFORMANCE: BorrowerPerformanceRow = {
  borrowerId: "",
  loanCount: 0,
  activeLoanCount: 0,
  borrowedCapital: 0,
  outstandingAmt: 0,
  lateRatePct: null,
  planned: null,
  actual: null,
};

export default function BorrowersPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [borrowers, setBorrowers] = useState<BorrowerRow[]>([]);
  const [performance, setPerformance] = useState<Map<string, BorrowerPerformanceRow>>(new Map());
  const [tab, setTab] = useState<"active" | "inactive">("active");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [{ data: borrowerData }, perf] = await Promise.all([
        supabase.from("borrowers").select("id, name, whatsapp_number").order("name"),
        getBorrowerPerformance(supabase),
      ]);
      if (!mounted) return;
      setBorrowers((borrowerData as BorrowerRow[]) ?? []);
      setPerformance(perf);
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const withStats: BorrowerWithStats[] = useMemo(() => {
    return borrowers.map((b) => {
      const perf = performance.get(b.id) ?? EMPTY_PERFORMANCE;
      return {
        ...b,
        loanCount: perf.loanCount,
        activeLoanCount: perf.activeLoanCount,
        borrowedCapital: perf.borrowedCapital,
        outstandingAmt: perf.outstandingAmt,
        lateRatePct: perf.lateRatePct,
        planned: perf.planned,
        actual: perf.actual,
      };
    });
  }, [borrowers, performance]);

  const activeBorrowers = withStats.filter((b) => b.activeLoanCount > 0);
  const inactiveBorrowers = withStats.filter((b) => b.activeLoanCount === 0);
  const shown = tab === "active" ? activeBorrowers : inactiveBorrowers;

  const sorted = [...shown].sort((a, b) => {
    if (sortKey === "name") return sortDir * a.name.localeCompare(b.name);
    return sortDir * (a.borrowedCapital - b.borrowedCapital);
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(key);
      setSortDir(1);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">Borrowers</h1>

      <div className="flex gap-2 mt-5 border-b border-slate-200">
        <button
          onClick={() => setTab("active")}
          className={
            "px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
            (tab === "active" ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700")
          }
        >
          Active ({activeBorrowers.length})
        </button>
        <button
          onClick={() => setTab("inactive")}
          className={
            "px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
            (tab === "inactive" ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700")
          }
        >
          Inactive ({inactiveBorrowers.length})
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          No {tab} borrowers yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort("name")} className="hover:text-slate-800">
                    Name {sortKey === "name" ? (sortDir === 1 ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th className="px-4 py-3">No. of loans</th>
                <th className="px-4 py-3">
                  <button onClick={() => toggleSort("borrowedCapital")} className="hover:text-slate-800">
                    Borrowed capital {sortKey === "borrowedCapital" ? (sortDir === 1 ? "▲" : "▼") : ""}
                  </button>
                </th>
                <th className="px-4 py-3">Outstanding amt</th>
                <th className="px-4 py-3">Late rate</th>
                <th className="px-4 py-3">Planned XIRR</th>
                <th className="px-4 py-3">Actual XIRR</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((b) => {
                const comparison = compareXirr(b.actual, b.planned);
                const tone =
                  comparison === "BEHIND" ? "text-rose-600" : comparison === "AHEAD" ? "text-emerald-600" : "text-slate-700";
                return (
                  <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/borrowers/${b.id}`} className="text-teal-700 hover:underline font-medium">
                        {b.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{b.loanCount}</td>
                    <td className="px-4 py-3">{formatINR(b.borrowedCapital)}</td>
                    <td className="px-4 py-3">{formatINR(b.outstandingAmt)}</td>
                    <td className="px-4 py-3">{b.lateRatePct === null ? "—" : `${b.lateRatePct.toFixed(0)}%`}</td>
                    <td className="px-4 py-3">{formatPercent(b.planned)}</td>
                    <td className={`px-4 py-3 font-semibold ${tone}`}>{formatPercent(b.actual)}</td>
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

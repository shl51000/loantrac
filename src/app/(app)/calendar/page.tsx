"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { addDays, formatDate, formatINR, toISODateString } from "@/lib/format";
import { getInstallmentStatus } from "@/lib/installmentStatus";

interface RawInstallment {
  id: string;
  loan_id: string;
  due_date: string;
  interest_due: number;
  principal_due: number;
  loans: { lender_name: string; borrowers: { name: string } | null } | null;
}

interface CalendarInstallment {
  id: string;
  loanId: string;
  dueDate: string;
  totalDue: number;
  received: number;
  lastReceiptDate: string | null;
  borrowerName: string;
  lenderName: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const startWeekday = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  return cells;
}

export default function CalendarPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [installments, setInstallments] = useState<CalendarInstallment[]>([]);
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [borrowerFilter, setBorrowerFilter] = useState("");
  const [lenderFilter, setLenderFilter] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      const { data: raw } = await supabase
        .from("emi_installments")
        .select("id, loan_id, due_date, interest_due, principal_due, loans!inner(status, lender_name, borrowers(name))")
        .eq("loans.status", "ACTIVE");

      const rows = (raw as unknown as RawInstallment[]) ?? [];
      const ids = rows.map((r) => r.id);

      const receivedByInstallment = new Map<string, number>();
      const lastReceiptDateByInstallment = new Map<string, string>();
      if (ids.length > 0) {
        const { data: receipts } = await supabase
          .from("emi_receipts")
          .select("installment_id, received_amount, tds_amount, receipt_date")
          .in("installment_id", ids);
        for (const r of receipts ?? []) {
          receivedByInstallment.set(
            r.installment_id,
            (receivedByInstallment.get(r.installment_id) ?? 0) + Number(r.received_amount) + Number(r.tds_amount)
          );
          const prevLast = lastReceiptDateByInstallment.get(r.installment_id);
          if (!prevLast || r.receipt_date > prevLast) {
            lastReceiptDateByInstallment.set(r.installment_id, r.receipt_date);
          }
        }
      }

      if (!mounted) return;
      setInstallments(
        rows.map((r) => ({
          id: r.id,
          loanId: r.loan_id,
          dueDate: r.due_date,
          totalDue: Number(r.interest_due) + Number(r.principal_due),
          received: receivedByInstallment.get(r.id) ?? 0,
          lastReceiptDate: lastReceiptDateByInstallment.get(r.id) ?? null,
          borrowerName: r.loans?.borrowers?.name ?? "Unknown",
          lenderName: r.loans?.lender_name ?? "—",
        }))
      );
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const borrowerOptions = useMemo(
    () => Array.from(new Set(installments.map((i) => i.borrowerName))).sort(),
    [installments]
  );
  const lenderOptions = useMemo(
    () => Array.from(new Set(installments.map((i) => i.lenderName))).sort(),
    [installments]
  );

  const filteredInstallments = useMemo(
    () =>
      installments.filter(
        (i) =>
          (!borrowerFilter || i.borrowerName === borrowerFilter) &&
          (!lenderFilter || i.lenderName === lenderFilter)
      ),
    [installments, borrowerFilter, lenderFilter]
  );

  const byDate = useMemo(() => {
    const map = new Map<string, CalendarInstallment[]>();
    for (const inst of filteredInstallments) {
      const list = map.get(inst.dueDate) ?? [];
      list.push(inst);
      map.set(inst.dueDate, list);
    }
    return map;
  }, [filteredInstallments]);

  const today = toISODateString(new Date());
  const grid = getMonthGrid(cursor.getFullYear(), cursor.getMonth());
  const monthLabel = cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  function goToMonth(offset: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + offset, 1));
    setSelectedDate(null);
  }

  function goToday() {
    const d = new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
    setSelectedDate(today);
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  const selectedRows = selectedDate ? byDate.get(selectedDate) ?? [] : [];

  const in7 = toISODateString(addDays(new Date(), 7));
  const in15 = toISODateString(addDays(new Date(), 15));
  const in30 = toISODateString(addDays(new Date(), 30));
  const next30Days = filteredInstallments
    .filter((i) => i.dueDate >= today && i.dueDate <= in30 && i.totalDue - i.received > 0.5)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  function sumRemaining(filter: (i: CalendarInstallment) => boolean): number {
    return filteredInstallments
      .filter(filter)
      .reduce((s, i) => s + Math.max(0, i.totalDue - i.received), 0);
  }
  const alreadyDue = sumRemaining((i) => i.dueDate < today);
  const dueIn7 = sumRemaining((i) => i.dueDate >= today && i.dueDate <= in7);
  const dueIn15 = sumRemaining((i) => i.dueDate >= today && i.dueDate <= in15);
  const dueIn30 = sumRemaining((i) => i.dueDate >= today && i.dueDate <= in30);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">Repayment calendar</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToMonth(-1)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            ← Prev
          </button>
          <span className="text-sm font-semibold text-slate-700 min-w-[140px] text-center">{monthLabel}</span>
          <button
            onClick={() => goToMonth(1)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Next →
          </button>
          <button
            onClick={goToday}
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white px-3 py-1.5 text-sm font-semibold"
          >
            Today
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <select
          value={borrowerFilter}
          onChange={(e) => {
            setBorrowerFilter(e.target.value);
            setSelectedDate(null);
          }}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 bg-white"
        >
          <option value="">All borrowers</option>
          {borrowerOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={lenderFilter}
          onChange={(e) => {
            setLenderFilter(e.target.value);
            setSelectedDate(null);
          }}
          className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-700 bg-white"
        >
          <option value="">All lenders</option>
          {lenderOptions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        {(borrowerFilter || lenderFilter) && (
          <button
            onClick={() => {
              setBorrowerFilter("");
              setLenderFilter("");
              setSelectedDate(null);
            }}
            className="text-sm text-teal-700 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 max-w-2xl">
        <StatBox label="Already due" value={formatINR(alreadyDue)} tone="red" />
        <StatBox label="Due in 7 days" value={formatINR(dueIn7)} tone="orange" />
        <StatBox label="Due in 15 days" value={formatINR(dueIn15)} tone="mustard" />
        <StatBox label="Due in 30 days" value={formatINR(dueIn30)} tone="teal" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 mt-4 p-3 max-w-sm">
        <div className="grid grid-cols-7 text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1 text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-0.5">
          {grid.map((date, i) => {
            if (!date) return <div key={`blank-${i}`} />;
            const iso = toISODateString(date);
            const dayInstallments = byDate.get(iso) ?? [];
            const remainingDue = dayInstallments.reduce((s, r) => s + (r.totalDue - r.received), 0);
            const allPaid = dayInstallments.length > 0 && remainingDue <= 0.5;
            const isPast = iso < today;
            const isToday = iso === today;
            const isSelected = selectedDate === iso;

            let dot = "";
            if (dayInstallments.length > 0) {
              dot = allPaid ? "bg-emerald-500" : isPast ? "bg-rose-500" : isToday ? "bg-amber-500" : "bg-slate-400";
            }

            return (
              <button
                key={iso}
                onClick={() => setSelectedDate(dayInstallments.length > 0 ? iso : null)}
                className={
                  "aspect-square rounded-lg flex flex-col items-center justify-center gap-0.5 border transition-colors " +
                  (isSelected
                    ? "border-teal-500 bg-teal-50"
                    : "border-transparent hover:bg-slate-50")
                }
              >
                <span
                  className={
                    "text-xs w-6 h-6 flex items-center justify-center rounded-full " +
                    (isToday ? "bg-teal-600 text-white font-semibold" : "text-slate-600")
                  }
                >
                  {date.getDate()}
                </span>
                <span className={`w-1.5 h-1.5 rounded-full ${dot || "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
      </div>

      {selectedDate && (
        <div className="mt-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">{formatDate(selectedDate)}</h2>
          <div className="space-y-2">
            {selectedRows.map((r) => {
              const { label, toneClass } = getInstallmentStatus(r.totalDue, r.received, r.lastReceiptDate, r.dueDate, today);
              return (
                <Link
                  key={r.id}
                  href={`/loans/${r.loanId}`}
                  className="bg-white rounded-xl border border-slate-200 p-3 flex items-center justify-between hover:border-teal-300 hover:bg-teal-50/40 transition-colors"
                >
                  <div>
                    <span className="font-medium text-teal-700">{r.borrowerName}</span>
                    <span className="text-slate-400 text-sm"> · {r.lenderName}</span>
                    <div className="text-sm text-slate-500">{formatINR(r.totalDue)}</div>
                  </div>
                  <span className={`text-xs font-semibold rounded-full px-2 py-1 ${toneClass}`}>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">Next 30 days ({next30Days.length})</h2>
        {next30Days.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
            Nothing expected in the next 30 days.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {next30Days.map((r) => {
              const remaining = r.totalDue - r.received;
              const { label, toneClass } = getInstallmentStatus(r.totalDue, r.received, r.lastReceiptDate, r.dueDate, today);
              return (
                <Link
                  key={r.id}
                  href={`/loans/${r.loanId}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-teal-50/40 transition-colors"
                >
                  <div>
                    <span className="font-medium text-teal-700">{r.borrowerName}</span>
                    <span className="text-slate-400 text-sm"> · {r.lenderName}</span>
                    <div className="text-sm text-slate-500">
                      {formatINR(remaining)} due {formatDate(r.dueDate)}
                    </div>
                  </div>
                  <span className={`text-xs font-semibold rounded-full px-2 py-1 ${toneClass}`}>{label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

const STAT_TONE_CLASSES: Record<string, string> = {
  red: "text-red-600",
  orange: "text-orange-600",
  mustard: "text-yellow-700",
  teal: "text-teal-600",
};

function StatBox({ label, value, tone }: { label: string; value: string; tone: keyof typeof STAT_TONE_CLASSES }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`text-xl font-bold mt-1 ${STAT_TONE_CLASSES[tone]}`}>{value}</div>
    </div>
  );
}

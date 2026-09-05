"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { formatINR } from "@/lib/format";
import { getReferralColor } from "@/lib/referralColors";
import { getPortfolioStats, type PortfolioStats } from "@/lib/portfolioStats";
import { getPendingInstallments, bucketPendingAmounts, type PendingBuckets } from "@/lib/pendingInstallments";
import { getAllLoanXirrResults } from "@/lib/portfolioXirr";
import { weightedAverageXirr, compareXirr, type LoanXirrResult } from "@/lib/loanXirr";
import { getDashboardAnalytics, type DashboardAnalytics } from "@/lib/dashboardAnalytics";
import { IconTrendingUp, IconTrendingDown, IconWarning, IconClock, IconBarChart, IconInfo } from "@/components/icons";

interface Referral {
  id: string;
  name: string;
  color_seq: number;
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

function formatDays(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${Math.round(value)}d`;
}

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [buckets, setBuckets] = useState<PendingBuckets | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [xirrResults, setXirrResults] = useState<LoanXirrResult[]>([]);
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);
  const [closedCount, setClosedCount] = useState(0);
  const [totalReturned, setTotalReturned] = useState(0);

  useEffect(() => {
    (async () => {
      const [portfolioStats, pending, { data: referralData }, xirr, dashAnalytics, { count: closed }, { data: closedLoans }] =
        await Promise.all([
          getPortfolioStats(supabase),
          getPendingInstallments(supabase),
          supabase.from("referrals").select("id, name, color_seq").order("color_seq"),
          getAllLoanXirrResults(supabase),
          getDashboardAnalytics(supabase),
          supabase.from("loans").select("id", { count: "exact", head: true }).eq("status", "CLOSED"),
          supabase.from("loans").select("closure_settlement_amount").eq("status", "CLOSED"),
        ]);
      setStats(portfolioStats);
      setBuckets(bucketPendingAmounts(pending));
      setReferrals((referralData as Referral[]) ?? []);
      setXirrResults(xirr);
      setAnalytics(dashAnalytics);
      setClosedCount(closed ?? 0);
      setTotalReturned(
        ((closedLoans as { closure_settlement_amount: number }[]) ?? []).reduce(
          (s, l) => s + Number(l.closure_settlement_amount),
          0
        )
      );
      setLoading(false);
    })();
  }, [supabase]);

  const referralById = new Map(referrals.map((r) => [r.id, r]));
  const capitalChartData = (stats?.capitalByReferral ?? [])
    .map((c) => {
      const referral = referralById.get(c.referralId);
      return {
        name: referral?.name ?? "Unknown",
        value: c.amount,
        color: referral ? getReferralColor(referral.color_seq).chart : "#94a3b8",
      };
    })
    .filter((c) => c.value > 0);

  const hasActiveLoans = (stats?.activeLoanCount ?? 0) > 0;

  const portfolioPlannedXirr = weightedAverageXirr(xirrResults, "planned");
  const portfolioActualXirr = weightedAverageXirr(xirrResults, "actual");
  const portfolioComparison = compareXirr(portfolioActualXirr, portfolioPlannedXirr);
  const actualXirrTone =
    portfolioComparison === "BEHIND" ? "text-rose-700" : portfolioComparison === "AHEAD" ? "text-emerald-700" : undefined;
  const comparisonNote =
    portfolioComparison === "BEHIND" ? "Behind plan" : portfolioComparison === "AHEAD" ? "Ahead of plan" : "On track";

  const xirrByReferral = new Map<string, LoanXirrResult[]>();
  for (const r of xirrResults) {
    const list = xirrByReferral.get(r.referralId) ?? [];
    list.push(r);
    xirrByReferral.set(r.referralId, list);
  }
  const xirrChartData = referrals
    .map((ref) => {
      const group = xirrByReferral.get(ref.id) ?? [];
      if (group.length === 0) return null;
      const planned = weightedAverageXirr(group, "planned");
      const actual = weightedAverageXirr(group, "actual");
      return {
        name: ref.name,
        Planned: planned !== null ? Number((planned * 100).toFixed(2)) : null,
        Actual: actual !== null ? Number((actual * 100).toFixed(2)) : null,
      };
    })
    .filter((x): x is { name: string; Planned: number | null; Actual: number | null } => x !== null);

  const maxBorrowerPercent = Math.max(1, ...(analytics?.topBorrowers.map((b) => b.percent) ?? [1]));
  const maxLenderPercent = Math.max(1, ...(analytics?.capitalByLender.map((b) => b.percent) ?? [1]));

  return (
    <div>

      <h1 className="text-3xl font-bold text-teal-700 underline decoration-2 underline-offset-4 uppercase tracking-wide">Dashboard</h1>
      <p className="text-sm text-slate-500 mt-1">
        Rolled up across {stats?.activeLoanCount ?? 0} active loans ({closedCount} closed, {formatINR(totalReturned)} returned).
      </p>

      {/* Top 4 headline stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <BigStat
          label="Active capital deployed"
          value={formatINR(stats?.activeCapitalDeployed)}
          note={`across ${stats?.activeLoanCount ?? 0} loans`}
          loading={loading}
        />
        <BigStat label="Outstanding principal" value={formatINR(stats?.outstandingPrincipal)} loading={loading} />
        <BigStat
          label="Portfolio planned XIRR"
          value={formatPercent(portfolioPlannedXirr)}
          note="capital-weighted"
          icon={<IconTrendingUp className="w-4 h-4 text-teal-600" />}
          loading={loading}
        />
        <BigStat
          label="Portfolio actual XIRR"
          value={formatPercent(portfolioActualXirr)}
          note={comparisonNote}
          icon={
            portfolioComparison === "BEHIND" ? (
              <IconTrendingDown className="w-4 h-4 text-rose-600" />
            ) : (
              <IconTrendingUp className="w-4 h-4 text-emerald-600" />
            )
          }
          loading={loading}
          valueClassName={actualXirrTone}
        />
      </div>

      {/* Cash-flow cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <SmallStat label="Overdue right now" value={formatINR(buckets?.overdue)} tone="rose" icon={<IconWarning className="w-4 h-4" />} loading={loading} />
        <SmallStat label="Due in next 30 days" value={formatINR(buckets?.dueIn30)} tone="amber" icon={<IconClock className="w-4 h-4" />} loading={loading} />
        <SmallStat label="Due in next 90 days" value={formatINR(buckets?.dueIn90)} tone="slate" icon={<IconClock className="w-4 h-4" />} loading={loading} />
      </div>

      {/* Referral performance */}
      <div className="bg-white rounded-xl border border-slate-200 mt-6 overflow-x-auto">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
          <IconBarChart className="w-4 h-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Referral performance</h2>
        </div>
        {!analytics || analytics.referralPerformance.length === 0 ? (
          <p className="text-sm text-slate-400 px-4 py-6 text-center">No active loans yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-2">Referral</th>
                <th className="px-4 py-2">Loans</th>
                <th className="px-4 py-2">Capital</th>
                <th className="px-4 py-2">Late rate</th>
                <th className="px-4 py-2">Shortfalls</th>
                <th className="px-4 py-2">Avg delay</th>
                <th className="px-4 py-2">Planned XIRR</th>
                <th className="px-4 py-2">Actual XIRR</th>
              </tr>
            </thead>
            <tbody>
              {analytics.referralPerformance.map((row) => {
                const referral = referralById.get(row.referralId);
                const color = referral ? getReferralColor(referral.color_seq) : null;
                const comparison = compareXirr(row.actual, row.planned);
                const tone = comparison === "BEHIND" ? "text-rose-600" : comparison === "AHEAD" ? "text-emerald-600" : "text-slate-700";
                return (
                  <tr key={row.referralId} className="border-b border-slate-100">
                    <td className="px-4 py-2.5">
                      {color && referral && (
                        <span className={`text-xs font-semibold rounded-full px-2 py-1 ${color.badgeBg} ${color.badgeText}`}>
                          {referral.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">{row.loanCount}</td>
                    <td className="px-4 py-2.5">{formatINR(row.capital)}</td>
                    <td className="px-4 py-2.5">{row.lateRatePct === null ? "—" : `${row.lateRatePct.toFixed(0)}%`}</td>
                    <td className="px-4 py-2.5">{row.shortfalls}</td>
                    <td className="px-4 py-2.5">{formatDays(row.avgDelayDays)}</td>
                    <td className="px-4 py-2.5">{formatPercent(row.planned)}</td>
                    <td className={`px-4 py-2.5 font-semibold ${tone}`}>{formatPercent(row.actual)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">Capital by referral</h2>
          <p className="text-xs text-slate-400 -mt-1 mb-2">Share of active capital deployed, by referral source</p>
          {capitalChartData.length === 0 ? (
            <EmptyChartState />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={capitalChartData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2}>
                  {capitalChartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatINR(Number(value))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2 uppercase tracking-wide">Planned vs Actual XIRR by referral</h2>
          <p className="text-xs text-slate-400 -mt-1 mb-2">Capital-weighted return, contracted vs realised</p>
          {xirrChartData.length === 0 ? (
            <EmptyChartState note="Populates once loans have repayment schedules." />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={xirrChartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} unit="%" />
                <Tooltip formatter={(value) => `${value}%`} />
                <Legend />
                <Bar dataKey="Planned" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Actual" fill="#0d9488" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Concentration */}
      {analytics && (analytics.topBorrowers.length > 0 || analytics.capitalByLender.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Concentration — top borrowers</h2>
            <div className="space-y-3">
              {analytics.topBorrowers.map((row) => (
                <ConcentrationBar key={row.label} row={row} barColor="bg-teal-500" maxPercent={maxBorrowerPercent} />
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h2 className="text-sm font-semibold text-slate-700 mb-3 uppercase tracking-wide">Capital by lender</h2>
            <div className="space-y-3">
              {analytics.capitalByLender.map((row) => (
                <ConcentrationBar key={row.label} row={row} barColor="bg-indigo-500" maxPercent={maxLenderPercent} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Interest structure / moratorium */}
      {analytics && (analytics.byInterestStructure.length > 0 || analytics.moratoriumImpact.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
          <GroupTable title="By interest structure" rows={analytics.byInterestStructure} />
          <GroupTable title="Moratorium impact" rows={analytics.moratoriumImpact} />
        </div>
      )}

      {analytics && analytics.referralPerformance.length > 0 && (
        <p className="text-xs text-slate-400 flex items-start gap-1.5 mt-3">
          <IconInfo className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          All averages here are capital-weighted (bigger loans move the number more) and recompute live from
          every loan&apos;s recorded receipts. &quot;Actual XIRR&quot; assumes overdue amounts are collected
          today and future amounts on schedule — it&apos;s a current projection, not only cash already in
          hand. Nothing here is stored separately.
        </p>
      )}

      {/* Biggest yield leakage */}
      {analytics && analytics.yieldLeakage.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 mt-6">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
            <IconTrendingDown className="w-4 h-4 text-rose-500" />
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Biggest yield leakage</h2>
            <span className="text-xs text-slate-400">(planned − actual XIRR)</span>
          </div>
          <div className="divide-y divide-slate-100">
            {analytics.yieldLeakage.map((row) => (
              <Link
                key={row.loanId}
                href={`/loans/${row.loanId}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50"
              >
                <div>
                  <div className="text-sm font-medium text-slate-800">{row.borrowerName}</div>
                  <div className="text-xs text-slate-400">
                    {row.lateCount} late · {row.shortCount} short
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <span className="text-slate-500 w-16 text-right">{formatPercent(row.planned)}</span>
                  <span className="text-emerald-600 font-semibold w-16 text-right">{formatPercent(row.actual)}</span>
                  <span className="text-rose-600 font-semibold w-20 text-right">
                    −{Math.abs(row.leakage * 100).toFixed(2)}%
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {!hasActiveLoans && !loading && (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          No active loans yet. Once you create loans, this dashboard fills in with referral performance,
          yield leakage, and concentration breakdowns.
        </div>
      )}
    </div>
  );
}

function BigStat({
  label,
  value,
  loading,
  note,
  icon,
  valueClassName,
}: {
  label: string;
  value: string;
  loading: boolean;
  note?: string;
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-teal-200 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-teal-700/80 uppercase tracking-wide">{label}</div>
        {icon}
      </div>
      <div className={`text-2xl md:text-3xl font-bold mt-1 ${valueClassName ?? "text-teal-700"}`}>
        {loading ? "…" : value}
      </div>
      {note && <div className="text-xs text-slate-400 mt-0.5">{note}</div>}
    </div>
  );
}

const TONE_CLASSES: Record<string, string> = {
  rose: "text-rose-600",
  amber: "text-amber-600",
  slate: "text-slate-700",
};

function SmallStat({
  label,
  value,
  tone,
  icon,
  loading,
}: {
  label: string;
  value: string;
  tone: keyof typeof TONE_CLASSES;
  icon?: React.ReactNode;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium text-slate-500">{label}</div>
        {icon && <span className={TONE_CLASSES[tone]}>{icon}</span>}
      </div>
      <div className={`text-xl font-bold mt-1 ${TONE_CLASSES[tone]}`}>{loading ? "…" : value}</div>
    </div>
  );
}

function EmptyChartState({ note }: { note?: string }) {
  return (
    <div className="h-[240px] flex items-center justify-center text-sm text-slate-400 text-center px-4">
      {note ?? "No data yet."}
    </div>
  );
}

function ConcentrationBar({
  row,
  barColor,
  maxPercent,
}: {
  row: { label: string; amount: number; percent: number };
  barColor: string;
  maxPercent: number;
}) {
  const widthPct = Math.max(2, (row.percent / maxPercent) * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-slate-700 font-medium truncate">{row.label}</span>
        <span className="text-slate-400 text-xs whitespace-nowrap ml-2">
          {formatINR(row.amount)} · {row.percent.toFixed(0)}%
        </span>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
}

function GroupTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; loanCount: number; avgDelayDays: number | null; actual: number | null }[];
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
      <div className="px-4 py-3 border-b border-slate-200">
        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{title}</h2>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
            <th className="px-4 py-2">{title.includes("interest") ? "Structure" : "Group"}</th>
            <th className="px-4 py-2">Loans</th>
            <th className="px-4 py-2">Avg delay</th>
            <th className="px-4 py-2">Actual XIRR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-slate-100">
              <td className="px-4 py-2.5 text-slate-700">{row.label}</td>
              <td className="px-4 py-2.5">{row.loanCount}</td>
              <td className="px-4 py-2.5">{formatDays(row.avgDelayDays)}</td>
              <td className="px-4 py-2.5 font-semibold text-slate-700">{formatPercent(row.actual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

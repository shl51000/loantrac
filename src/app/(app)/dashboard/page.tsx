"use client";

import { useEffect, useState } from "react";
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

interface Referral {
  id: string;
  name: string;
  color_seq: number;
}

export default function DashboardPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [buckets, setBuckets] = useState<PendingBuckets | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [portfolioStats, pending, { data: referralData }] = await Promise.all([
        getPortfolioStats(supabase),
        getPendingInstallments(supabase),
        supabase.from("referrals").select("id, name, color_seq").order("color_seq"),
      ]);
      if (!mounted) return;
      setStats(portfolioStats);
      setBuckets(bucketPendingAmounts(pending));
      setReferrals((referralData as Referral[]) ?? []);
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
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

  return (
    <div>
      <h1 className="text-3xl font-bold text-teal-700 underline decoration-2 underline-offset-4">
        Dashboard
      </h1>

      {/* Top 4 headline stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <BigStat label="Active capital deployed" value={formatINR(stats?.activeCapitalDeployed)} loading={loading} />
        <BigStat label="Outstanding principal" value={formatINR(stats?.outstandingPrincipal)} loading={loading} />
        <BigStat label="Portfolio planned XIRR" value="—" loading={loading} />
        <BigStat label="Portfolio actual XIRR" value="—" loading={loading} />
      </div>

      {/* Cash-flow cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <SmallStat label="Overdue" value={formatINR(buckets?.overdue)} tone="rose" loading={loading} />
        <SmallStat label="Due in next 30 days" value={formatINR(buckets?.dueIn30)} tone="amber" loading={loading} />
        <SmallStat label="Due in next 90 days" value={formatINR(buckets?.dueIn90)} tone="slate" loading={loading} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Capital by referral</h2>
          {capitalChartData.length === 0 ? (
            <EmptyChartState />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={capitalChartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                >
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
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Planned vs Actual XIRR by referral</h2>
          <EmptyChartState note="Populates once loans have repayment schedules." />
        </div>
      </div>

      {!hasActiveLoans && !loading && (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          No active loans yet. Once you create loans, this dashboard fills in with referral performance,
          yield leakage, repeat late payers, and concentration breakdowns.
        </div>
      )}
    </div>
  );
}

function BigStat({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-teal-200 p-5 shadow-sm">
      <div className="text-xs font-medium text-teal-700/80 uppercase tracking-wide">{label}</div>
      <div className="text-2xl md:text-3xl font-bold text-teal-700 mt-1">
        {loading ? "…" : value}
      </div>
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
  loading,
}: {
  label: string;
  value: string;
  tone: keyof typeof TONE_CLASSES;
  loading: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
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

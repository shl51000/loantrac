"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { formatDate, formatINR } from "@/lib/format";
import { getPendingInstallments } from "@/lib/pendingInstallments";
import { onLoansChanged } from "@/lib/loansRefresh";
import { IconWarning, IconRefresh, IconLogout } from "@/components/icons";
import RoleBadge from "@/components/RoleBadge";

// Shared across every page under (app): the "N installments due/overdue"
// banner and the Sync now / date / role strip. Lives in the layout so it's
// consistent everywhere, not just the Dashboard.
export default function TopBar() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [count, setCount] = useState(0);
  const [amount, setAmount] = useState(0);

  async function handleSignOut() {
    await signOut();
    router.push("/login");
  }

  const load = useCallback(async () => {
    const todayISO = new Date().toISOString().slice(0, 10);
    const pending = await getPendingInstallments(supabase);
    const dueNowOrEarlier = pending.filter((p) => p.dueDate <= todayISO);
    setCount(dueNowOrEarlier.length);
    setAmount(dueNowOrEarlier.reduce((s, p) => s + (p.totalDue - p.received), 0));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  useEffect(() => onLoansChanged(load), [load]);

  async function handleSync() {
    setSyncing(true);
    await load();
    setSyncing(false);
  }

  return (
    <div className="print-hide">
      {!dismissed && !loading && count > 0 && (
        <div className="-mx-4 md:-mx-8 -mt-4 md:-mt-8 mb-4 bg-amber-50 border-b border-amber-200 px-4 md:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-amber-900">
            <IconWarning className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <span className="font-bold">{count}</span> installment{count === 1 ? " is" : "s are"} due today or
              overdue, totalling <span className="font-bold">{formatINR(amount)}</span>.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/reminders" className="text-sm font-semibold text-amber-800 hover:underline">
              View & send reminders
            </Link>
            <button
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              className="text-amber-600 hover:text-amber-900 text-sm"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-4 text-sm text-slate-500 mb-2">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 hover:text-slate-700 disabled:opacity-60"
        >
          <IconRefresh className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>
        <span>{formatDate(new Date())}</span>
        <RoleBadge />
        <button
          aria-label="Sign out"
          onClick={handleSignOut}
          className="text-slate-500 hover:text-slate-700"
        >
          <IconLogout className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

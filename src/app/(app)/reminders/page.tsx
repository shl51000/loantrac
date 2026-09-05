"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import {
  formatDate,
  formatINR,
  toISODateString,
  parseFlexibleDate,
  formatAmountInput,
  parseAmountInput,
} from "@/lib/format";
import { getReferralColor } from "@/lib/referralColors";
import { getPendingInstallments, type PendingInstallment } from "@/lib/pendingInstallments";

interface LoanInfo {
  id: string;
  lender_name: string;
  borrowers: { name: string; whatsapp_number: string } | null;
  referrals: { name: string; whatsapp_number: string; color_seq: number } | null;
}

interface ReminderRow extends PendingInstallment {
  borrowerName: string;
  borrowerWhatsapp: string;
  referralName: string | null;
  referralWhatsapp: string | null;
  referralColorSeq: number | null;
  lenderName: string;
}

interface MonthGroupData {
  key: string;
  label: string;
  rows: ReminderRow[];
}

function waLink(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function borrowerMessage(borrowerName: string, amount: string, dueDate: string, overdue: boolean): string {
  return overdue
    ? `Hi ${borrowerName}, this is a reminder that your loan installment of *${amount}* was due on *${dueDate}* and is now overdue. Kindly arrange payment at the earliest. Thank you.`
    : `Hi ${borrowerName}, this is a reminder that your loan installment of *${amount}* is due on *${dueDate}*. Kindly ensure timely payment. Thank you.`;
}

function referralMessage(borrowerName: string, amount: string, dueDate: string, overdue: boolean): string {
  return overdue
    ? `Hi, an update on ${borrowerName}'s loan referred by you — the installment of *${amount}* was due on *${dueDate}* and is currently overdue. Please follow up if you can. Thank you.`
    : `Hi, an update on ${borrowerName}'s loan referred by you — the installment of *${amount}* is due on *${dueDate}*. Just a heads-up. Thank you.`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

export default function RemindersPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReminderRow[]>([]);
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set());
  const defaultsInitialized = useRef(false);

  const loadReminders = useCallback(async () => {
    const pending = await getPendingInstallments(supabase);
    if (pending.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    const loanIds = [...new Set(pending.map((p) => p.loanId))];
    const { data: loanData } = await supabase
      .from("loans")
      .select("id, lender_name, borrowers(name, whatsapp_number), referrals(name, whatsapp_number, color_seq)")
      .in("id", loanIds);

    const loanById = new Map((loanData as unknown as LoanInfo[]).map((l) => [l.id, l]));
    const merged: ReminderRow[] = pending.map((p) => {
      const loan = loanById.get(p.loanId);
      return {
        ...p,
        borrowerName: loan?.borrowers?.name ?? "Unknown borrower",
        borrowerWhatsapp: loan?.borrowers?.whatsapp_number ?? "919003151000",
        referralName: loan?.referrals?.name ?? null,
        referralWhatsapp: loan?.referrals?.whatsapp_number ?? null,
        referralColorSeq: loan?.referrals?.color_seq ?? null,
        lenderName: loan?.lender_name ?? "—",
      };
    });
    merged.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    setRows(merged);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  const today = toISODateString(new Date());
  const overdue = rows.filter((r) => r.dueDate < today);
  const upcoming = rows.filter((r) => r.dueDate >= today);

  const monthGroups: MonthGroupData[] = useMemo(() => {
    const map = new Map<string, ReminderRow[]>();
    for (const r of upcoming) {
      const key = r.dueDate.slice(0, 7);
      const list = map.get(key) ?? [];
      list.push(r);
      map.set(key, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, groupRows]) => ({ key, label: monthLabel(key), rows: groupRows }));
  }, [upcoming]);

  useEffect(() => {
    if (defaultsInitialized.current || monthGroups.length === 0) return;
    defaultsInitialized.current = true;
    setCollapsedMonths(new Set(monthGroups.slice(1).map((g) => g.key)));
  }, [monthGroups]);

  function toggleMonth(key: string) {
    setCollapsedMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div>
      <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">Reminders</h1>

      {rows.length === 0 ? (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          Nothing pending — every installment is fully received.
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-rose-700 mb-2">
                Overdue ({overdue.length})
              </h2>
              <div className="space-y-3">
                {overdue.map((r) => (
                  <ReminderCard key={r.id} r={r} isOverdue supabase={supabase} onRecorded={loadReminders} />
                ))}
              </div>
            </div>
          )}

          {upcoming.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm font-bold uppercase tracking-wide text-amber-700 mb-2">
                Upcoming ({upcoming.length})
              </h2>
              {monthGroups.map((g) => (
                <MonthGroup
                  key={g.key}
                  groupKey={g.key}
                  label={g.label}
                  rows={g.rows}
                  collapsed={collapsedMonths.has(g.key)}
                  onToggle={toggleMonth}
                  supabase={supabase}
                  onRecorded={loadReminders}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MonthGroup({
  groupKey,
  label,
  rows,
  collapsed,
  onToggle,
  supabase,
  onRecorded,
}: {
  groupKey: string;
  label: string;
  rows: ReminderRow[];
  collapsed: boolean;
  onToggle: (key: string) => void;
  supabase: SupabaseClient;
  onRecorded: () => void;
}) {
  return (
    <div className="mb-3">
      <button
        onClick={() => onToggle(groupKey)}
        className="w-full flex items-center justify-between text-left bg-white border border-slate-200 rounded-lg px-4 py-2.5 hover:bg-slate-50"
      >
        <span className="text-sm font-semibold text-slate-700">
          {label} <span className="text-slate-400 font-normal">({rows.length})</span>
        </span>
        <span className="text-slate-400 text-sm">{collapsed ? "▸" : "▾"}</span>
      </button>
      {!collapsed && (
        <div className="space-y-3 mt-2">
          {rows.map((r) => (
            <ReminderCard key={r.id} r={r} isOverdue={false} supabase={supabase} onRecorded={onRecorded} />
          ))}
        </div>
      )}
    </div>
  );
}

const inputClass =
  "rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";

function ReminderCard({
  r,
  isOverdue,
  supabase,
  onRecorded,
}: {
  r: ReminderRow;
  isOverdue: boolean;
  supabase: SupabaseClient;
  onRecorded: () => void;
}) {
  const remaining = r.totalDue - r.received;
  const amountStr = formatINR(remaining);
  const dueDateStr = formatDate(r.dueDate);
  const referralColor = r.referralColorSeq ? getReferralColor(r.referralColorSeq) : null;

  const [recording, setRecording] = useState(false);
  const [dateText, setDateText] = useState("");
  const [principalText, setPrincipalText] = useState("");
  const [interestText, setInterestText] = useState("");
  const [tdsText, setTdsText] = useState("");
  // Tracks whether the principal/interest fields still show the tentative
  // (due-amount) prefill, so it can be rendered in grey until edited.
  const [principalIsDefault, setPrincipalIsDefault] = useState(false);
  const [interestIsDefault, setInterestIsDefault] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startRecording() {
    setRecording(true);
    setDateText("");
    // Only prefill the full due amounts when nothing's been received yet —
    // for a partially-paid installment we don't know how the prior receipt
    // split between interest and principal, so leave it to the user.
    const prefillPrincipal = r.received <= 0.5 && r.principalDue > 0;
    const prefillInterest = r.received <= 0.5 && r.interestDue > 0;
    setPrincipalText(prefillPrincipal ? formatAmountInput(String(r.principalDue)) : "");
    setInterestText(prefillInterest ? formatAmountInput(String(r.interestDue)) : "");
    setPrincipalIsDefault(prefillPrincipal);
    setInterestIsDefault(prefillInterest);
    setTdsText("");
    setError(null);
  }

  async function handleSave() {
    const parsedDate = parseFlexibleDate(dateText);
    if (!parsedDate) {
      setError("Couldn't read that date.");
      return;
    }
    const principalAmt = parseAmountInput(principalText || "0") || 0;
    const interestAmt = parseAmountInput(interestText || "0") || 0;
    const tdsAmt = parseAmountInput(tdsText || "0") || 0;
    if (!(principalAmt > 0) && !(interestAmt > 0)) {
      setError("Enter at least a principal or interest amount.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const receiptDate = toISODateString(parsedDate);
    const payloads: {
      installment_id: string;
      receipt_type: "INTEREST" | "PRINCIPAL";
      receipt_date: string;
      received_amount: number;
      tds_amount: number;
    }[] = [];
    if (interestAmt > 0) {
      payloads.push({
        installment_id: r.id,
        receipt_type: "INTEREST",
        receipt_date: receiptDate,
        received_amount: interestAmt,
        tds_amount: tdsAmt,
      });
    }
    if (principalAmt > 0) {
      payloads.push({
        installment_id: r.id,
        receipt_type: "PRINCIPAL",
        receipt_date: receiptDate,
        received_amount: principalAmt,
        tds_amount: 0,
      });
    }

    const { error: insertError } = await supabase.from("emi_receipts").insert(payloads);
    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setRecording(false);
    onRecorded();
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/loans/${r.loanId}`} className="block hover:opacity-80">
          <span className="font-semibold text-slate-800 hover:underline">{r.borrowerName}</span>
          <span className="text-slate-400 text-sm"> · {r.lenderName}</span>
          {referralColor && r.referralName && (
            <span className={`ml-2 text-xs font-semibold rounded-full px-2 py-0.5 ${referralColor.badgeBg} ${referralColor.badgeText}`}>
              {r.referralName}
            </span>
          )}
          <div className="text-sm text-slate-500 mt-0.5">
            {amountStr} due {dueDateStr}
            {r.received > 0 && ` (₹${r.received.toLocaleString("en-IN")} already received)`}
          </div>
        </Link>
        <div className="flex gap-2">
          <button
            onClick={() => (recording ? setRecording(false) : startRecording())}
            className="text-xs font-semibold rounded-lg border border-teal-300 text-teal-700 hover:bg-teal-50 px-3 py-1.5"
          >
            {recording ? "Cancel" : "Record repayment"}
          </button>
          <a
            href={waLink(r.borrowerWhatsapp, borrowerMessage(r.borrowerName, amountStr, dueDateStr, isOverdue))}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-semibold rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 px-3 py-1.5"
          >
            WhatsApp borrower
          </a>
          {r.referralWhatsapp && r.referralName && (
            <a
              href={waLink(r.referralWhatsapp, referralMessage(r.borrowerName, amountStr, dueDateStr, isOverdue))}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-1.5"
            >
              WhatsApp referral
            </a>
          )}
        </div>
      </div>

      {recording && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-end gap-2">
          <input
            value={dateText}
            onChange={(ev) => setDateText(ev.target.value)}
            onBlur={() => {
              const parsed = parseFlexibleDate(dateText);
              if (parsed) setDateText(formatDate(parsed));
            }}
            placeholder="Date, e.g. 9 Aug 26"
            className={`${inputClass} w-36`}
          />
          <input
            type="text"
            inputMode="numeric"
            value={principalText}
            onChange={(ev) => {
              setPrincipalText(formatAmountInput(ev.target.value));
              setPrincipalIsDefault(false);
            }}
            placeholder="Principal (₹)"
            className={`${inputClass} w-32 ${principalIsDefault ? "text-slate-400" : ""}`}
          />
          <input
            type="text"
            inputMode="numeric"
            value={interestText}
            onChange={(ev) => {
              setInterestText(formatAmountInput(ev.target.value));
              setInterestIsDefault(false);
            }}
            placeholder="Interest (₹)"
            className={`${inputClass} w-32 ${interestIsDefault ? "text-slate-400" : ""}`}
          />
          <input
            type="text"
            inputMode="numeric"
            value={tdsText}
            onChange={(ev) => setTdsText(formatAmountInput(ev.target.value))}
            placeholder="TDS (₹, optional)"
            className={`${inputClass} w-32`}
          />
          <button
            disabled={submitting}
            onClick={handleSave}
            className="shrink-0 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold py-1.5 px-3"
          >
            {submitting ? "Saving…" : "Save"}
          </button>
          {error && <p className="text-xs text-rose-600 whitespace-nowrap">{error}</p>}
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { formatDate, formatINR } from "@/lib/format";
import { getReferralColor } from "@/lib/referralColors";
import { getTotalDrawsByLoan } from "@/lib/oncallDraws";

interface BorrowerRow {
  id: string;
  name: string;
  whatsapp_number: string;
}

interface LoanRow {
  id: string;
  lender_name: string;
  loan_amount: number;
  loan_type: "EMI" | "ON_CALL";
  status: "ACTIVE" | "CLOSED";
  disbursement_date: string;
  referral_id: string;
  referrals: { name: string; color_seq: number } | null;
}

export default function BorrowerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [borrower, setBorrower] = useState<BorrowerRow | null>(null);
  const [loans, setLoans] = useState<LoanRow[]>([]);
  const [drawsByLoan, setDrawsByLoan] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [{ data: borrowerData, error }, { data: loanData }] = await Promise.all([
        supabase.from("borrowers").select("id, name, whatsapp_number").eq("id", id).single(),
        supabase
          .from("loans")
          .select("id, lender_name, loan_amount, loan_type, status, disbursement_date, referral_id, referrals(name, color_seq)")
          .eq("borrower_id", id)
          .order("disbursement_date", { ascending: false }),
      ]);
      if (!mounted) return;
      if (error || !borrowerData) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setBorrower(borrowerData as BorrowerRow);
      const loans = (loanData as unknown as LoanRow[]) ?? [];
      setLoans(loans);

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
  }, [supabase, id]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  if (notFound || !borrower) {
    return (
      <div>
        <p className="text-sm text-slate-500">Borrower not found.</p>
        <Link href="/borrowers" className="text-sm text-teal-700 hover:underline">
          ← Back to Borrowers
        </Link>
      </div>
    );
  }

  const totalLoanAmount = (l: LoanRow) => Number(l.loan_amount) + (drawsByLoan.get(l.id) ?? 0);
  const activeLoans = loans.filter((l) => l.status === "ACTIVE");
  const closedLoans = loans.filter((l) => l.status === "CLOSED");
  const activeCapital = activeLoans.reduce((s, l) => s + totalLoanAmount(l), 0);
  const lifetimeCapital = loans.reduce((s, l) => s + totalLoanAmount(l), 0);

  return (
    <div className="max-w-3xl">
      <Link href="/borrowers" className="text-sm text-teal-700 hover:underline">
        ← Back to Borrowers
      </Link>

      <h1 className="text-3xl font-bold text-teal-700 mt-1">{borrower.name}</h1>
      <p className="text-sm text-slate-500 mt-1">WhatsApp: {borrower.whatsapp_number}</p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5">
        <Stat label="Active loans" value={String(activeLoans.length)} />
        <Stat label="Closed loans" value={String(closedLoans.length)} />
        <Stat label="Active capital" value={formatINR(activeCapital)} />
        <Stat label="Lifetime capital" value={formatINR(lifetimeCapital)} />
      </div>

      <h2 className="text-sm font-semibold text-slate-700 mt-6 mb-2 uppercase tracking-wide">Loans</h2>
      {loans.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-sm text-slate-500">
          No loans recorded for this borrower yet.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="px-4 py-3">Lender</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Referral</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Disbursed</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((loan) => {
                const color = loan.referrals ? getReferralColor(loan.referrals.color_seq) : null;
                return (
                  <tr key={loan.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/loans/${loan.id}`} className="text-teal-700 hover:underline font-medium">
                        {loan.lender_name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{loan.loan_type === "EMI" ? "EMI" : "On-Call"}</td>
                    <td className="px-4 py-3">
                      {loan.referrals && color && (
                        <span className={`text-xs font-semibold rounded-full px-2 py-1 ${color.badgeBg} ${color.badgeText}`}>
                          {loan.referrals.name}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{formatINR(totalLoanAmount(loan))}</td>
                    <td className="px-4 py-3">{formatDate(loan.disbursement_date)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "text-xs font-semibold rounded-full px-2 py-1 " +
                          (loan.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700")
                        }
                      >
                        {loan.status === "ACTIVE" ? "Active" : "Closed"}
                      </span>
                    </td>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="text-xl font-bold text-teal-700 mt-1">{value}</div>
    </div>
  );
}

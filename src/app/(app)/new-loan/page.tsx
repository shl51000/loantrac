"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { parseFlexibleDate, formatDate, toISODateString, formatAmountInput, parseAmountInput } from "@/lib/format";
import { getBorrowers, addBorrower, type Borrower } from "@/lib/borrowers";
import { getReferrals, addReferral, type Referral } from "@/lib/referrals";
import {
  generateEmiSchedule,
  type EmiInterestMethod,
  type EmiPrincipalMethod,
} from "@/lib/emiSchedule";
import { notifyLoansChanged } from "@/lib/loansRefresh";
import { getErrorMessage } from "@/lib/errors";

type LoanType = "EMI" | "ON_CALL";

const INTEREST_METHOD_OPTIONS: { value: EmiInterestMethod; label: string }[] = [
  { value: "FLAT_MONTHLY", label: "Flat monthly on outstanding (monthly)" },
  { value: "FLAT_MONTHLY_ADVANCE", label: "Flat monthly on outstanding (in advance)" },
  {
    value: "LUMPSUM_ADVANCE",
    label: "Lumpsum in advance (due day after disbursement)",
  },
  { value: "PA_DIVIDED_365", label: "Monthly, per-annum ÷ 365 exact days" },
];

const PRINCIPAL_METHOD_OPTIONS: { value: EmiPrincipalMethod; label: string }[] =
  [
    { value: "MONTHWISE", label: "Month-wise even split" },
    { value: "LUMPSUM", label: "Lumpsum in final month" },
  ];

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";
const labelClass = "block text-sm font-medium text-slate-700 mb-1";

export default function NewLoanPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    installmentCount: number;
    loanType: LoanType;
  } | null>(null);

  const [borrowers, setBorrowers] = useState<Borrower[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);

  // Step 1 fields
  const [loanType, setLoanType] = useState<LoanType>("EMI");
  const [borrowerId, setBorrowerId] = useState("");
  const [addingBorrower, setAddingBorrower] = useState(false);
  const [newBorrowerName, setNewBorrowerName] = useState("");
  const [newBorrowerWhatsapp, setNewBorrowerWhatsapp] = useState("");

  const [lenderName, setLenderName] = useState("");
  const [coLender1, setCoLender1] = useState("");
  const [coLender2, setCoLender2] = useState("");

  const [referralId, setReferralId] = useState("");
  const [addingReferral, setAddingReferral] = useState(false);
  const [newReferralName, setNewReferralName] = useState("");
  const [newReferralWhatsapp, setNewReferralWhatsapp] = useState("");

  const [disbursementDateText, setDisbursementDateText] = useState("");
  const [loanAmountText, setLoanAmountText] = useState("");

  const [emiInterestMethod, setEmiInterestMethod] =
    useState<EmiInterestMethod>("FLAT_MONTHLY");
  const [emiPrincipalMethod, setEmiPrincipalMethod] =
    useState<EmiPrincipalMethod>("MONTHWISE");
  const [emiInterestRate, setEmiInterestRate] = useState("");
  const [emiTenureMonths, setEmiTenureMonths] = useState("");
  const [emiMoratoriumMonths, setEmiMoratoriumMonths] = useState("0");

  const [oncallAnnualRate, setOncallAnnualRate] = useState("");

  const [routingAccountName, setRoutingAccountName] = useState("");

  useEffect(() => {
    let mounted = true;
    async function load() {
      const [b, r] = await Promise.all([
        getBorrowers(supabase),
        getReferrals(supabase),
      ]);
      if (!mounted) return;
      setBorrowers(b);
      setReferrals(r);
      setLoading(false);
    }
    load();
    return () => {
      mounted = false;
    };
  }, [supabase]);

  const parsedDisbursementDate = useMemo(
    () => parseFlexibleDate(disbursementDateText),
    [disbursementDateText],
  );
  const loanAmount = parseAmountInput(loanAmountText);
  const interestRate = parseFloat(
    loanType === "EMI" ? emiInterestRate : oncallAnnualRate,
  );
  const tenureMonths = parseInt(emiTenureMonths, 10);
  const moratoriumMonths = parseInt(emiMoratoriumMonths || "0", 10);

  const formValid = useMemo(() => {
    if (!borrowerId) return false;
    if (!lenderName.trim()) return false;
    if (!referralId) return false;
    if (!parsedDisbursementDate) return false;
    if (!(loanAmount > 0)) return false;
    if (loanType === "EMI") {
      if (!(interestRate > 0)) return false;
      if (!(tenureMonths > 0)) return false;
      if (moratoriumMonths < 0 || moratoriumMonths >= tenureMonths)
        return false;
    } else {
      if (!(interestRate > 0)) return false;
    }
    return true;
  }, [
    borrowerId,
    lenderName,
    referralId,
    parsedDisbursementDate,
    loanAmount,
    loanType,
    interestRate,
    tenureMonths,
    moratoriumMonths,
  ]);

  async function handleAddBorrower() {
    if (!newBorrowerName.trim()) return;
    try {
      const created = await addBorrower(
        supabase,
        newBorrowerName,
        newBorrowerWhatsapp,
      );
      setBorrowers((prev) =>
        [...prev, created].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setBorrowerId(created.id);
      setAddingBorrower(false);
      setNewBorrowerName("");
      setNewBorrowerWhatsapp("");
    } catch (err) {
      alert(getErrorMessage(err, "Could not add borrower."));
    }
  }

  async function handleAddReferral() {
    if (!newReferralName.trim() || !newReferralWhatsapp.trim()) return;
    try {
      const created = await addReferral(
        supabase,
        newReferralName,
        newReferralWhatsapp,
      );
      setReferrals((prev) => [...prev, created]);
      setReferralId(created.id);
      setAddingReferral(false);
      setNewReferralName("");
      setNewReferralWhatsapp("");
    } catch (err) {
      alert(getErrorMessage(err, "Could not add referral."));
    }
  }

  async function handleCreateLoan() {
    if (!formValid || !parsedDisbursementDate) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const { data: loan, error: loanError } = await supabase
        .from("loans")
        .insert({
          borrower_id: borrowerId,
          lender_name: lenderName.trim(),
          co_lender_1: coLender1.trim() || null,
          co_lender_2: coLender2.trim() || null,
          referral_id: referralId,
          disbursement_date: toISODateString(parsedDisbursementDate),
          loan_amount: loanAmount,
          loan_type: loanType,
          routing_account_name: routingAccountName.trim() || null,
          emi_interest_method: loanType === "EMI" ? emiInterestMethod : null,
          emi_principal_method: loanType === "EMI" ? emiPrincipalMethod : null,
          emi_interest_rate: loanType === "EMI" ? interestRate : null,
          emi_tenure_months: loanType === "EMI" ? tenureMonths : null,
          emi_moratorium_months: loanType === "EMI" ? moratoriumMonths : 0,
          oncall_annual_rate: loanType === "ON_CALL" ? interestRate : null,
        })
        .select("id")
        .single();

      if (loanError || !loan)
        throw loanError ?? new Error("Loan was not created.");

      let installmentCount = 0;
      if (loanType === "EMI") {
        const schedule = generateEmiSchedule({
          disbursementDate: parsedDisbursementDate,
          loanAmount,
          interestRate,
          tenureMonths,
          moratoriumMonths,
          interestMethod: emiInterestMethod,
          principalMethod: emiPrincipalMethod,
        });
        const { error: scheduleError } = await supabase
          .from("emi_installments")
          .insert(schedule.map((row) => ({ ...row, loan_id: loan.id })));
        if (scheduleError) throw scheduleError;
        installmentCount = schedule.length;
      }

      notifyLoansChanged();
      setSuccess({ installmentCount, loanType });
    } catch (err) {
      setSubmitError(getErrorMessage(err, "Something went wrong creating this loan."));
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setSuccess(null);
    setLoanType("EMI");
    setBorrowerId("");
    setLenderName("");
    setCoLender1("");
    setCoLender2("");
    setReferralId("");
    setDisbursementDateText("");
    setLoanAmountText("");
    setEmiInterestMethod("FLAT_MONTHLY");
    setEmiPrincipalMethod("MONTHWISE");
    setEmiInterestRate("");
    setEmiTenureMonths("");
    setEmiMoratoriumMonths("0");
    setOncallAnnualRate("");
    setRoutingAccountName("");
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  if (success) {
    return (
      <div className="max-w-lg">
        <div className="bg-white rounded-xl border border-emerald-200 p-6 text-center">
          <div className="text-emerald-600 text-3xl mb-2">✓</div>
          <h1 className="text-xl font-bold text-slate-800 uppercase tracking-wide">Loan created</h1>
          <p className="text-sm text-slate-500 mt-2">
            {success.loanType === "EMI"
              ? `A repayment schedule with ${success.installmentCount} installment${success.installmentCount === 1 ? "" : "s"} was generated.`
              : "This On-Call loan is now active — add top-ups and repayments from its ledger."}
          </p>
          <div className="flex gap-3 justify-center mt-6">
            <button
              onClick={() => router.push("/dashboard")}
              className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2 px-4 text-sm"
            >
              Go to Dashboard
            </button>
            <button
              onClick={resetForm}
              className="rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold py-2 px-4 text-sm"
            >
              Create another loan
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">New loan</h1>
      <p className="text-sm text-slate-500 mt-1">Loan details</p>

      <div className="bg-white rounded-xl border border-slate-200 p-6 mt-4 space-y-5">
        <div>
          <span className={labelClass}>Loan type</span>
          <div className="grid grid-cols-2 gap-2">
            {(["EMI", "ON_CALL"] as LoanType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setLoanType(t)}
                className={
                  "rounded-lg py-2.5 text-sm font-semibold border transition-colors " +
                  (loanType === t
                    ? "bg-teal-600 text-white border-teal-600"
                    : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50")
                }
              >
                {t === "EMI" ? "EMI" : "On-Call"}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className={labelClass}>Borrower</span>
          {!addingBorrower ? (
            <div className="flex gap-2">
              <select
                value={borrowerId}
                onChange={(e) => setBorrowerId(e.target.value)}
                className={inputClass}
              >
                <option value="">Select borrower…</option>
                {borrowers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAddingBorrower(true)}
                className="shrink-0 text-sm text-teal-700 hover:underline whitespace-nowrap"
              >
                + Add new
              </button>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
              <input
                value={newBorrowerName}
                onChange={(e) => setNewBorrowerName(e.target.value)}
                placeholder="Borrower name"
                className={inputClass}
              />
              <input
                value={newBorrowerWhatsapp}
                onChange={(e) => setNewBorrowerWhatsapp(e.target.value)}
                placeholder="WhatsApp number (optional, e.g. 919xxxxxxxxx)"
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddBorrower}
                  className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-1.5 px-3"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAddingBorrower(false)}
                  className="text-sm text-slate-500 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Lender</label>
            <input
              value={lenderName}
              onChange={(e) => setLenderName(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Co-lender 1 (optional)</label>
            <input
              value={coLender1}
              onChange={(e) => setCoLender1(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Co-lender 2 (optional)</label>
            <input
              value={coLender2}
              onChange={(e) => setCoLender2(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <span className={labelClass}>Referral</span>
          {!addingReferral ? (
            <div className="flex gap-2">
              <select
                value={referralId}
                onChange={(e) => setReferralId(e.target.value)}
                className={inputClass}
              >
                <option value="">Select referral…</option>
                {referrals.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setAddingReferral(true)}
                className="shrink-0 text-sm text-teal-700 hover:underline whitespace-nowrap"
              >
                + Add new
              </button>
            </div>
          ) : (
            <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-slate-50">
              <input
                value={newReferralName}
                onChange={(e) => setNewReferralName(e.target.value)}
                placeholder="Referral name"
                className={inputClass}
              />
              <input
                value={newReferralWhatsapp}
                onChange={(e) => setNewReferralWhatsapp(e.target.value)}
                placeholder="WhatsApp number, e.g. 919xxxxxxxxx"
                className={inputClass}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleAddReferral}
                  className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-1.5 px-3"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAddingReferral(false)}
                  className="text-sm text-slate-500 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Disbursement date</label>
            <input
              value={disbursementDateText}
              onChange={(e) => setDisbursementDateText(e.target.value)}
              onBlur={() => {
                const parsed = parseFlexibleDate(disbursementDateText);
                if (parsed) setDisbursementDateText(formatDate(parsed));
              }}
              placeholder="e.g. 9 Aug 26 or 9/8/26"
              className={inputClass}
            />
            <p className="text-xs text-slate-400 mt-1">
              {disbursementDateText
                ? parsedDisbursementDate
                  ? formatDate(toISODateString(parsedDisbursementDate))
                  : "Couldn't read that date"
                : " "}
            </p>
          </div>
          <div>
            <label className={labelClass}>Loan amount (₹)</label>
            <input
              type="text"
              inputMode="numeric"
              value={loanAmountText}
              onChange={(e) => setLoanAmountText(formatAmountInput(e.target.value))}
              className={inputClass}
            />
          </div>
        </div>

        {loanType === "EMI" ? (
          <div className="border-t border-slate-200 pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              EMI details
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Interest collection method</label>
                <select
                  value={emiInterestMethod}
                  onChange={(e) =>
                    setEmiInterestMethod(e.target.value as EmiInterestMethod)
                  }
                  className={inputClass}
                >
                  {INTEREST_METHOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Principal repayment method</label>
                <select
                  value={emiPrincipalMethod}
                  onChange={(e) =>
                    setEmiPrincipalMethod(e.target.value as EmiPrincipalMethod)
                  }
                  className={inputClass}
                >
                  {PRINCIPAL_METHOD_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>
                  Interest rate ({emiInterestMethod === "LUMPSUM_ADVANCE" ? "% p.m." : "% p.a."})
                </label>
                <input
                  type="number"
                  value={emiInterestRate}
                  onChange={(e) => setEmiInterestRate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Tenure (months)</label>
                <input
                  type="number"
                  value={emiTenureMonths}
                  onChange={(e) => setEmiTenureMonths(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Moratorium (months)</label>
                <input
                  type="number"
                  value={emiMoratoriumMonths}
                  onChange={(e) => setEmiMoratoriumMonths(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="border-t border-slate-200 pt-4 space-y-4">
            <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
              On-Call details
            </h3>
            <div>
              <label className={labelClass}>Annual interest rate (%)</label>
              <input
                type="number"
                value={oncallAnnualRate}
                onChange={(e) => setOncallAnnualRate(e.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-slate-400 mt-1">
                Interest accrues continuously — rate ÷ 365 × exact days held.
              </p>
            </div>
          </div>
        )}

        <div className="border-t border-slate-200 pt-4">
          <label className={labelClass}>Routing A/c Name (optional)</label>
          <input
            value={routingAccountName}
            onChange={(e) => setRoutingAccountName(e.target.value)}
            className={inputClass}
            placeholder="Account name for routing this loan's payments"
          />
        </div>

        {submitError && (
          <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {submitError}
          </p>
        )}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={!formValid || submitting}
            onClick={handleCreateLoan}
            className="rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2.5 px-5 text-sm"
          >
            {submitting ? "Creating…" : "Create loan & generate schedule"}
          </button>
        </div>
      </div>
    </div>
  );
}

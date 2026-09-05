"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { formatINR, formatDate, parseFlexibleDate, toISODateString, formatAmountInput, parseAmountInput } from "@/lib/format";
import { getReferralColor } from "@/lib/referralColors";
import { getInstallmentStatus } from "@/lib/installmentStatus";
import {
  generateEmiSchedule,
  INTEREST_METHOD_LABELS,
  PRINCIPAL_METHOD_LABELS,
  isAdvanceInterestMethod,
  type EmiInterestMethod,
  type EmiPrincipalMethod,
} from "@/lib/emiSchedule";
import { getPlannedXirr, getActualXirr, compareXirr, type XirrInstallment } from "@/lib/loanXirr";
import { getBorrowers, addBorrower, type Borrower } from "@/lib/borrowers";
import { getReferrals, addReferral, type Referral } from "@/lib/referrals";
import { notifyLoansChanged } from "@/lib/loansRefresh";
import { getErrorMessage } from "@/lib/errors";
import { getOncallAccrual } from "@/lib/oncallAccrual";
import {
  IconGrid,
  IconCalendar,
  IconBarChart,
  IconTrendingUp,
  IconTrendingDown,
  IconRupee,
  IconWarning,
  IconTrash,
  IconPrint,
} from "@/components/icons";

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(2)}%`;
}

type LoanType = "EMI" | "ON_CALL";
type ReceiptType = "INTEREST" | "PRINCIPAL";
type TxnType = "DRAW" | "REPAYMENT";

interface LoanRow {
  id: string;
  borrower_id: string;
  lender_name: string;
  co_lender_1: string | null;
  co_lender_2: string | null;
  referral_id: string;
  disbursement_date: string;
  loan_amount: number;
  loan_type: LoanType;
  routing_account_name: string | null;
  emi_interest_method: EmiInterestMethod | null;
  emi_principal_method: EmiPrincipalMethod | null;
  emi_interest_rate: number | null;
  emi_tenure_months: number | null;
  emi_moratorium_months: number;
  oncall_annual_rate: number | null;
  status: "ACTIVE" | "CLOSED";
  closure_date: string | null;
  closure_settlement_amount: number | null;
  closure_notes: string | null;
  borrowers: { name: string } | null;
  referrals: { name: string; color_seq: number } | null;
}

interface EmiInstallmentRow {
  id: string;
  installment_number: number;
  due_date: string;
  interest_due: number;
  principal_due: number;
}

interface EmiReceiptRow {
  id: string;
  installment_id: string;
  receipt_type: ReceiptType;
  receipt_date: string;
  received_amount: number;
  tds_amount: number;
  notes: string | null;
}

interface OncallTxnRow {
  id: string;
  transaction_type: TxnType;
  transaction_date: string;
  amount: number;
  principal_portion: number;
  interest_portion: number;
  tds_on_interest: number;
  notes: string | null;
}

const INTEREST_METHOD_OPTIONS: { value: EmiInterestMethod; label: string }[] = [
  { value: "FLAT_MONTHLY", label: "Flat monthly on outstanding (monthly)" },
  { value: "FLAT_MONTHLY_ADVANCE", label: "Flat monthly on outstanding (in advance)" },
  { value: "LUMPSUM_ADVANCE", label: "Lumpsum in advance (due day after disbursement)" },
  { value: "PA_DIVIDED_365", label: "Monthly, per-annum ÷ 365 exact days" },
];

const PRINCIPAL_METHOD_OPTIONS: { value: EmiPrincipalMethod; label: string }[] = [
  { value: "MONTHWISE", label: "Month-wise even split" },
  { value: "LUMPSUM", label: "Lumpsum in final month" },
];

const inputClass =
  "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";
const labelClass = "block text-xs font-medium text-slate-600 mb-1";

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export default function LoanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const { isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loan, setLoan] = useState<LoanRow | null>(null);
  const [installments, setInstallments] = useState<EmiInstallmentRow[]>([]);
  const [receipts, setReceipts] = useState<EmiReceiptRow[]>([]);
  const [transactions, setTransactions] = useState<OncallTxnRow[]>([]);
  const [tab, setTab] = useState<"overview" | "schedule" | "ledger" | "reports">("overview");
  const [borrowers, setBorrowers] = useState<Borrower[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);

  useEffect(() => {
    (async () => {
      const [b, r] = await Promise.all([getBorrowers(supabase), getReferrals(supabase)]);
      setBorrowers(b);
      setReferrals(r);
    })();
  }, [supabase]);

  const [editingBasics, setEditingBasics] = useState(false);
  const [editBorrowerId, setEditBorrowerId] = useState("");
  const [editAddingBorrower, setEditAddingBorrower] = useState(false);
  const [editNewBorrowerName, setEditNewBorrowerName] = useState("");
  const [editNewBorrowerWhatsapp, setEditNewBorrowerWhatsapp] = useState("");
  const [editLenderName, setEditLenderName] = useState("");
  const [editCoLender1, setEditCoLender1] = useState("");
  const [editCoLender2, setEditCoLender2] = useState("");
  const [editReferralId, setEditReferralId] = useState("");
  const [editAddingReferral, setEditAddingReferral] = useState(false);
  const [editNewReferralName, setEditNewReferralName] = useState("");
  const [editNewReferralWhatsapp, setEditNewReferralWhatsapp] = useState("");
  const [editDisbursementDateText, setEditDisbursementDateText] = useState("");
  const [editLoanAmountText, setEditLoanAmountText] = useState("");
  const [editEmiInterestMethod, setEditEmiInterestMethod] = useState<EmiInterestMethod>("FLAT_MONTHLY");
  const [editEmiPrincipalMethod, setEditEmiPrincipalMethod] = useState<EmiPrincipalMethod>("MONTHWISE");
  const [editEmiInterestRate, setEditEmiInterestRate] = useState("");
  const [editEmiTenureMonths, setEditEmiTenureMonths] = useState("");
  const [editEmiMoratoriumMonths, setEditEmiMoratoriumMonths] = useState("0");
  const [editOncallAnnualRate, setEditOncallAnnualRate] = useState("");
  const [editRoutingAccountName, setEditRoutingAccountName] = useState("");
  const [editBasicsSubmitting, setEditBasicsSubmitting] = useState(false);
  const [editBasicsError, setEditBasicsError] = useState<string | null>(null);

  const editParsedDisbursementDate = useMemo(
    () => parseFlexibleDate(editDisbursementDateText),
    [editDisbursementDateText]
  );

  const loadAll = useCallback(async () => {
    const { data: loanData, error } = await supabase
      .from("loans")
      .select("*, borrowers(name), referrals(name, color_seq)")
      .eq("id", id)
      .single();

    if (error || !loanData) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const loanRow = loanData as unknown as LoanRow;
    setLoan(loanRow);

    if (loanRow.loan_type === "EMI") {
      const { data: inst } = await supabase
        .from("emi_installments")
        .select("id, installment_number, due_date, interest_due, principal_due")
        .eq("loan_id", id)
        .order("installment_number");
      const instRows = (inst as EmiInstallmentRow[]) ?? [];
      setInstallments(instRows);
      if (instRows.length > 0) {
        const { data: rec } = await supabase
          .from("emi_receipts")
          .select("*")
          .in("installment_id", instRows.map((r) => r.id));
        setReceipts((rec as EmiReceiptRow[]) ?? []);
      } else {
        setReceipts([]);
      }
    } else {
      const { data: txns } = await supabase
        .from("oncall_transactions")
        .select("*")
        .eq("loan_id", id)
        .order("transaction_date");
      setTransactions((txns as OncallTxnRow[]) ?? []);
    }
    setLoading(false);
    notifyLoansChanged();
  }, [supabase, id]);

  useEffect(() => {
    (async () => {
      await loadAll();
    })();
  }, [loadAll]);

  function startEditBasics() {
    if (!loan) return;
    setEditBorrowerId(loan.borrower_id);
    setEditAddingBorrower(false);
    setEditLenderName(loan.lender_name);
    setEditCoLender1(loan.co_lender_1 ?? "");
    setEditCoLender2(loan.co_lender_2 ?? "");
    setEditReferralId(loan.referral_id);
    setEditAddingReferral(false);
    setEditDisbursementDateText(formatDate(loan.disbursement_date));
    setEditLoanAmountText(formatAmountInput(String(loan.loan_amount)));
    setEditEmiInterestMethod(loan.emi_interest_method ?? "FLAT_MONTHLY");
    setEditEmiPrincipalMethod(loan.emi_principal_method ?? "MONTHWISE");
    setEditEmiInterestRate(loan.emi_interest_rate != null ? String(loan.emi_interest_rate) : "");
    setEditEmiTenureMonths(loan.emi_tenure_months != null ? String(loan.emi_tenure_months) : "");
    setEditEmiMoratoriumMonths(String(loan.emi_moratorium_months ?? 0));
    setEditOncallAnnualRate(loan.oncall_annual_rate != null ? String(loan.oncall_annual_rate) : "");
    setEditRoutingAccountName(loan.routing_account_name ?? "");
    setEditBasicsError(null);
    setEditingBasics(true);
  }

  async function handleEditAddBorrower() {
    if (!editNewBorrowerName.trim()) return;
    try {
      const created = await addBorrower(supabase, editNewBorrowerName, editNewBorrowerWhatsapp);
      setBorrowers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setEditBorrowerId(created.id);
      setEditAddingBorrower(false);
      setEditNewBorrowerName("");
      setEditNewBorrowerWhatsapp("");
    } catch (err) {
      alert(getErrorMessage(err, "Could not add borrower."));
    }
  }

  async function handleEditAddReferral() {
    if (!editNewReferralName.trim() || !editNewReferralWhatsapp.trim()) return;
    try {
      const created = await addReferral(supabase, editNewReferralName, editNewReferralWhatsapp);
      setReferrals((prev) => [...prev, created]);
      setEditReferralId(created.id);
      setEditAddingReferral(false);
      setEditNewReferralName("");
      setEditNewReferralWhatsapp("");
    } catch (err) {
      alert(getErrorMessage(err, "Could not add referral."));
    }
  }

  async function handleSaveBasics() {
    if (!loan) return;
    if (!editBorrowerId || !editLenderName.trim() || !editReferralId) {
      setEditBasicsError("Borrower, lender, and referral are all required.");
      return;
    }
    if (!editParsedDisbursementDate) {
      setEditBasicsError("Couldn't read the disbursement date.");
      return;
    }
    const editLoanAmount = parseAmountInput(editLoanAmountText);
    if (!(editLoanAmount > 0)) {
      setEditBasicsError("Enter a loan amount greater than zero.");
      return;
    }

    const isEmi = loan.loan_type === "EMI";
    const editInterestRate = parseFloat(isEmi ? editEmiInterestRate : editOncallAnnualRate);
    const editTenureMonths = parseInt(editEmiTenureMonths, 10);
    const editMoratoriumMonths = parseInt(editEmiMoratoriumMonths || "0", 10);

    if (!(editInterestRate > 0)) {
      setEditBasicsError("Enter an interest rate greater than zero.");
      return;
    }
    if (isEmi) {
      if (!(editTenureMonths > 0)) {
        setEditBasicsError("Enter a tenure greater than zero.");
        return;
      }
      if (editMoratoriumMonths < 0 || editMoratoriumMonths >= editTenureMonths) {
        setEditBasicsError("Moratorium must be shorter than the tenure.");
        return;
      }
    }

    const editDisbursementIso = toISODateString(editParsedDisbursementDate);
    const scheduleAffectingChange =
      isEmi &&
      (editDisbursementIso !== loan.disbursement_date ||
        editLoanAmount !== loan.loan_amount ||
        editEmiInterestMethod !== loan.emi_interest_method ||
        editEmiPrincipalMethod !== loan.emi_principal_method ||
        editInterestRate !== loan.emi_interest_rate ||
        editTenureMonths !== loan.emi_tenure_months ||
        editMoratoriumMonths !== loan.emi_moratorium_months);

    if (scheduleAffectingChange && receipts.length > 0) {
      const proceed = confirm(
        `Changing the loan amount, disbursement date, or EMI terms regenerates the whole repayment schedule and permanently deletes the ${receipts.length} receipt${receipts.length === 1 ? "" : "s"} already recorded against it. This cannot be undone. Continue?`
      );
      if (!proceed) return;
    }

    setEditBasicsSubmitting(true);
    setEditBasicsError(null);

    const { error } = await supabase
      .from("loans")
      .update({
        borrower_id: editBorrowerId,
        lender_name: editLenderName.trim(),
        co_lender_1: editCoLender1.trim() || null,
        co_lender_2: editCoLender2.trim() || null,
        referral_id: editReferralId,
        disbursement_date: editDisbursementIso,
        loan_amount: editLoanAmount,
        routing_account_name: editRoutingAccountName.trim() || null,
        emi_interest_method: isEmi ? editEmiInterestMethod : null,
        emi_principal_method: isEmi ? editEmiPrincipalMethod : null,
        emi_interest_rate: isEmi ? editInterestRate : null,
        emi_tenure_months: isEmi ? editTenureMonths : null,
        emi_moratorium_months: isEmi ? editMoratoriumMonths : 0,
        oncall_annual_rate: isEmi ? null : editInterestRate,
      })
      .eq("id", id);
    if (error) {
      setEditBasicsError(error.message);
      setEditBasicsSubmitting(false);
      return;
    }

    if (scheduleAffectingChange) {
      const { error: deleteError } = await supabase.from("emi_installments").delete().eq("loan_id", id);
      if (deleteError) {
        setEditBasicsError(deleteError.message);
        setEditBasicsSubmitting(false);
        return;
      }
      const schedule = generateEmiSchedule({
        disbursementDate: editParsedDisbursementDate,
        loanAmount: editLoanAmount,
        interestRate: editInterestRate,
        tenureMonths: editTenureMonths,
        moratoriumMonths: editMoratoriumMonths,
        interestMethod: editEmiInterestMethod,
        principalMethod: editEmiPrincipalMethod,
      });
      const { error: scheduleError } = await supabase
        .from("emi_installments")
        .insert(schedule.map((row) => ({ ...row, loan_id: id })));
      if (scheduleError) {
        setEditBasicsError(scheduleError.message);
        setEditBasicsSubmitting(false);
        return;
      }
    }

    setEditingBasics(false);
    setEditBasicsSubmitting(false);
    await loadAll();
  }

  const [regeneratingSchedule, setRegeneratingSchedule] = useState(false);

  async function handleRegenerateSchedule() {
    if (!loan || loan.loan_type !== "EMI") return;
    const parsedDisbursementDate = parseFlexibleDate(formatDate(loan.disbursement_date));
    if (
      !parsedDisbursementDate ||
      !loan.emi_interest_method ||
      !loan.emi_principal_method ||
      loan.emi_interest_rate == null ||
      loan.emi_tenure_months == null
    ) {
      alert("This loan is missing EMI terms needed to regenerate a schedule.");
      return;
    }
    const proceed = confirm(
      receipts.length > 0
        ? `Regenerate this loan's schedule from its current terms? This permanently deletes the ${receipts.length} receipt${receipts.length === 1 ? "" : "s"} already recorded against it. This cannot be undone.`
        : "Regenerate this loan's schedule from its current terms?"
    );
    if (!proceed) return;

    setRegeneratingSchedule(true);
    const { error: deleteError } = await supabase.from("emi_installments").delete().eq("loan_id", id);
    if (deleteError) {
      alert(deleteError.message);
      setRegeneratingSchedule(false);
      return;
    }
    const schedule = generateEmiSchedule({
      disbursementDate: parsedDisbursementDate,
      loanAmount: loan.loan_amount,
      interestRate: loan.emi_interest_rate,
      tenureMonths: loan.emi_tenure_months,
      moratoriumMonths: loan.emi_moratorium_months ?? 0,
      interestMethod: loan.emi_interest_method,
      principalMethod: loan.emi_principal_method,
    });
    const { error: scheduleError } = await supabase
      .from("emi_installments")
      .insert(schedule.map((row) => ({ ...row, loan_id: id })));
    if (scheduleError) {
      alert(scheduleError.message);
      setRegeneratingSchedule(false);
      return;
    }
    setRegeneratingSchedule(false);
    await loadAll();
  }

  const [deleting, setDeleting] = useState(false);

  async function handleDeleteLoan() {
    if (!loan) return;
    if (!confirm(`Delete this loan for ${loan.borrowers?.name ?? "this borrower"}? This cannot be undone.`)) return;
    setDeleting(true);
    const { error } = await supabase.from("loans").delete().eq("id", loan.id);
    if (error) {
      alert(error.message);
      setDeleting(false);
      return;
    }
    notifyLoansChanged();
    router.push("/active-loans");
  }

  // ---------- Force close ----------
  const [closing, setClosing] = useState(false);
  const [closureDateText, setClosureDateText] = useState("");
  const [closureAmountText, setClosureAmountText] = useState("");
  const [closureTdsText, setClosureTdsText] = useState("");
  const [closureNotes, setClosureNotes] = useState("");
  const [closeSubmitting, setCloseSubmitting] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  function startForceClose() {
    setClosureDateText("");
    setClosureAmountText("");
    setClosureTdsText("");
    setClosureNotes("");
    setCloseError(null);
    setClosing(true);
  }

  const closureFinalSettlement = (parseAmountInput(closureAmountText) || 0) + (parseAmountInput(closureTdsText) || 0);

  async function handleForceClose() {
    const parsedDate = parseFlexibleDate(closureDateText);
    if (!parsedDate) {
      setCloseError("Couldn't read that closure date.");
      return;
    }
    setCloseSubmitting(true);
    setCloseError(null);
    const { error } = await supabase
      .from("loans")
      .update({
        status: "CLOSED",
        closure_date: toISODateString(parsedDate),
        closure_settlement_amount: closureFinalSettlement,
        closure_notes: closureNotes.trim() || null,
      })
      .eq("id", id);
    if (error) {
      setCloseError(error.message);
      setCloseSubmitting(false);
      return;
    }
    setClosing(false);
    setCloseSubmitting(false);
    await loadAll();
  }

  const [reopening, setReopening] = useState(false);

  async function handleReopenLoan() {
    if (!confirm("Reopen this loan? It will move back to Active loans.")) return;
    setReopening(true);
    const { error } = await supabase
      .from("loans")
      .update({
        status: "ACTIVE",
        closure_date: null,
        closure_settlement_amount: null,
        closure_notes: null,
      })
      .eq("id", id);
    if (error) {
      alert(error.message);
      setReopening(false);
      return;
    }
    setReopening(false);
    await loadAll();
  }

  // ---------- EMI receipts ----------
  const [recordingFor, setRecordingFor] = useState<{ installmentId: string; type: ReceiptType } | null>(null);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
  const [receiptDateText, setReceiptDateText] = useState("");
  const [receiptAmountText, setReceiptAmountText] = useState("");
  const [receiptTdsText, setReceiptTdsText] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptSubmitting, setReceiptSubmitting] = useState(false);
  const [receiptError, setReceiptError] = useState<string | null>(null);

  function startRecordReceipt(installmentId: string, type: ReceiptType) {
    setRecordingFor({ installmentId, type });
    setRecordingRepaymentFor(null);
    setEditingReceiptId(null);
    setReceiptDateText("");
    setReceiptAmountText("");
    setReceiptTdsText("");
    setReceiptNotes("");
    setReceiptError(null);
  }

  function startEditReceipt(receipt: EmiReceiptRow) {
    setRecordingFor({ installmentId: receipt.installment_id, type: receipt.receipt_type });
    setRecordingRepaymentFor(null);
    setEditingReceiptId(receipt.id);
    setReceiptDateText(formatDate(receipt.receipt_date));
    setReceiptAmountText(formatAmountInput(String(receipt.received_amount)));
    setReceiptTdsText(formatAmountInput(String(receipt.tds_amount)));
    setReceiptNotes(receipt.notes ?? "");
    setReceiptError(null);
  }

  async function handleRecordReceipt() {
    if (!recordingFor) return;
    const parsedDate = parseFlexibleDate(receiptDateText);
    if (!parsedDate) {
      setReceiptError("Couldn't read that date.");
      return;
    }
    const amt = parseAmountInput(receiptAmountText);
    if (!(amt > 0)) {
      setReceiptError("Enter an amount greater than zero.");
      return;
    }
    const tds = parseAmountInput(receiptTdsText || "0") || 0;
    setReceiptSubmitting(true);
    setReceiptError(null);
    const payload = {
      installment_id: recordingFor.installmentId,
      receipt_type: recordingFor.type,
      receipt_date: toISODateString(parsedDate),
      received_amount: amt,
      tds_amount: tds,
      notes: receiptNotes.trim() || null,
    };
    const { error } = editingReceiptId
      ? await supabase.from("emi_receipts").update(payload).eq("id", editingReceiptId)
      : await supabase.from("emi_receipts").insert(payload);
    if (error) {
      setReceiptError(error.message);
      setReceiptSubmitting(false);
      return;
    }
    setRecordingFor(null);
    setEditingReceiptId(null);
    setReceiptSubmitting(false);
    await loadAll();
  }

  async function handleDeleteReceipt(receiptId: string) {
    if (!confirm("Delete this receipt? This cannot be undone.")) return;
    const { error } = await supabase.from("emi_receipts").delete().eq("id", receiptId);
    if (error) {
      alert(error.message);
      return;
    }
    await loadAll();
  }

  // ---------- EMI combined repayment (Flat monthly on outstanding) ----------
  const [recordingRepaymentFor, setRecordingRepaymentFor] = useState<string | null>(null);
  const [repaymentDateText, setRepaymentDateText] = useState("");
  const [repaymentPrincipalText, setRepaymentPrincipalText] = useState("");
  const [repaymentInterestText, setRepaymentInterestText] = useState("");
  const [repaymentTdsText, setRepaymentTdsText] = useState("");
  // Tracks whether the principal/interest fields still show the tentative
  // (due-amount) prefill, so it can be rendered in grey until edited.
  const [repaymentPrincipalIsDefault, setRepaymentPrincipalIsDefault] = useState(false);
  const [repaymentInterestIsDefault, setRepaymentInterestIsDefault] = useState(false);
  const [repaymentSubmitting, setRepaymentSubmitting] = useState(false);
  const [repaymentError, setRepaymentError] = useState<string | null>(null);

  function startRecordRepayment(inst: EmiInstallmentRow) {
    setRecordingRepaymentFor(inst.id);
    setRecordingFor(null);
    setEditingReceiptId(null);
    setRepaymentDateText("");
    setRepaymentPrincipalText(inst.principal_due > 0 ? formatAmountInput(String(inst.principal_due)) : "");
    setRepaymentInterestText(inst.interest_due > 0 ? formatAmountInput(String(inst.interest_due)) : "");
    setRepaymentPrincipalIsDefault(inst.principal_due > 0);
    setRepaymentInterestIsDefault(inst.interest_due > 0);
    setRepaymentTdsText("");
    setRepaymentError(null);
  }

  async function handleSaveRepayment() {
    if (!recordingRepaymentFor) return;
    const parsedDate = parseFlexibleDate(repaymentDateText);
    if (!parsedDate) {
      setRepaymentError("Couldn't read that date.");
      return;
    }
    const principalAmt = parseAmountInput(repaymentPrincipalText || "0") || 0;
    const interestAmt = parseAmountInput(repaymentInterestText || "0") || 0;
    const tdsAmt = parseAmountInput(repaymentTdsText || "0") || 0;
    if (!(principalAmt > 0) && !(interestAmt > 0)) {
      setRepaymentError("Enter at least a principal or interest amount.");
      return;
    }
    setRepaymentSubmitting(true);
    setRepaymentError(null);

    const receiptDate = toISODateString(parsedDate);
    const payloads: {
      installment_id: string;
      receipt_type: ReceiptType;
      receipt_date: string;
      received_amount: number;
      tds_amount: number;
      notes: string | null;
    }[] = [];
    if (interestAmt > 0) {
      payloads.push({
        installment_id: recordingRepaymentFor,
        receipt_type: "INTEREST",
        receipt_date: receiptDate,
        received_amount: interestAmt,
        tds_amount: tdsAmt,
        notes: null,
      });
    }
    if (principalAmt > 0) {
      payloads.push({
        installment_id: recordingRepaymentFor,
        receipt_type: "PRINCIPAL",
        receipt_date: receiptDate,
        received_amount: principalAmt,
        tds_amount: 0,
        notes: null,
      });
    }

    const { error } = await supabase.from("emi_receipts").insert(payloads);
    if (error) {
      setRepaymentError(error.message);
      setRepaymentSubmitting(false);
      return;
    }
    setRecordingRepaymentFor(null);
    setRepaymentSubmitting(false);
    await loadAll();
  }

  // ---------- On-Call ledger ----------
  const [addingTxn, setAddingTxn] = useState(false);
  const [editingTxnId, setEditingTxnId] = useState<string | null>(null);
  const [txnType, setTxnType] = useState<TxnType>("DRAW");
  const [txnDateText, setTxnDateText] = useState("");
  const [txnAmountText, setTxnAmountText] = useState("");
  const [txnPrincipalText, setTxnPrincipalText] = useState("");
  const [txnInterestText, setTxnInterestText] = useState("");
  const [txnTdsText, setTxnTdsText] = useState("");
  const [txnNotes, setTxnNotes] = useState("");
  const [txnSubmitting, setTxnSubmitting] = useState(false);
  const [txnError, setTxnError] = useState<string | null>(null);

  function resetTxnForm() {
    setAddingTxn(false);
    setEditingTxnId(null);
    setTxnType("DRAW");
    setTxnDateText("");
    setTxnAmountText("");
    setTxnPrincipalText("");
    setTxnInterestText("");
    setTxnTdsText("");
    setTxnNotes("");
    setTxnError(null);
  }

  function startEditTxn(t: OncallTxnRow) {
    setEditingTxnId(t.id);
    setAddingTxn(true);
    setTxnType(t.transaction_type);
    setTxnDateText(formatDate(t.transaction_date));
    setTxnAmountText(formatAmountInput(String(t.amount)));
    setTxnPrincipalText(formatAmountInput(String(t.principal_portion)));
    setTxnInterestText(formatAmountInput(String(t.interest_portion)));
    setTxnTdsText(formatAmountInput(String(t.tds_on_interest)));
    setTxnNotes(t.notes ?? "");
    setTxnError(null);
  }

  async function handleSaveTxn() {
    const parsedDate = parseFlexibleDate(txnDateText);
    if (!parsedDate) {
      setTxnError("Couldn't read that date.");
      return;
    }

    let amt: number;
    let principalPortion = 0;
    let interestPortion = 0;
    let tds = 0;

    if (txnType === "REPAYMENT") {
      principalPortion = parseAmountInput(txnPrincipalText || "0") || 0;
      interestPortion = parseAmountInput(txnInterestText || "0") || 0;
      tds = parseAmountInput(txnTdsText || "0") || 0;
      amt = round2(principalPortion + interestPortion + tds);
      if (!(amt > 0)) {
        setTxnError("Enter at least one of principal, interest, or TDS.");
        return;
      }
    } else {
      amt = parseAmountInput(txnAmountText);
      if (!(amt > 0)) {
        setTxnError("Enter an amount greater than zero.");
        return;
      }
      principalPortion = amt;
    }

    setTxnSubmitting(true);
    setTxnError(null);

    const payload = {
      loan_id: id,
      transaction_type: txnType,
      transaction_date: toISODateString(parsedDate),
      amount: amt,
      principal_portion: principalPortion,
      interest_portion: interestPortion,
      tds_on_interest: tds,
      notes: txnNotes.trim() || null,
    };

    const { error } = editingTxnId
      ? await supabase.from("oncall_transactions").update(payload).eq("id", editingTxnId)
      : await supabase.from("oncall_transactions").insert(payload);

    if (error) {
      setTxnError(error.message);
      setTxnSubmitting(false);
      return;
    }
    resetTxnForm();
    setTxnSubmitting(false);
    await loadAll();
  }

  async function handleDeleteTxn(txnId: string) {
    if (!confirm("Delete this ledger entry? This cannot be undone.")) return;
    const { error } = await supabase.from("oncall_transactions").delete().eq("id", txnId);
    if (error) {
      alert(error.message);
      return;
    }
    await loadAll();
  }

  const xirrInstallments: XirrInstallment[] = useMemo(
    () =>
      installments.map((inst) => ({
        due_date: inst.due_date,
        interest_due: inst.interest_due,
        principal_due: inst.principal_due,
        receipts: receipts
          .filter((r) => r.installment_id === inst.id)
          .map((r) => ({ receipt_date: r.receipt_date, received_amount: r.received_amount, tds_amount: r.tds_amount })),
      })),
    [installments, receipts]
  );

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  if (notFound || !loan) {
    return (
      <div>
        <p className="text-sm text-slate-500">Loan not found.</p>
        <Link href="/dashboard" className="text-sm text-teal-700 hover:underline">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  const referralColor = loan.referrals ? getReferralColor(loan.referrals.color_seq) : null;
  const today = toISODateString(new Date());

  const oncallAccrual =
    loan.loan_type === "ON_CALL"
      ? getOncallAccrual(loan, transactions, loan.status === "CLOSED" && loan.closure_date ? loan.closure_date : today)
      : null;
  const oncallTotalDraws = transactions
    .filter((t) => t.transaction_type === "DRAW")
    .reduce((s, t) => s + Number(t.amount), 0);
  const totalLoanAmount = Number(loan.loan_amount) + (loan.loan_type === "ON_CALL" ? oncallTotalDraws : 0);

  const isAdvanceRow = (inst: EmiInstallmentRow) =>
    isAdvanceInterestMethod(loan.emi_interest_method) && inst.installment_number === 1;
  const monthLabel = (inst: EmiInstallmentRow) =>
    isAdvanceRow(inst)
      ? "Adv."
      : String(isAdvanceInterestMethod(loan.emi_interest_method) ? inst.installment_number - 1 : inst.installment_number);

  const enrichedInstallments = installments.map((inst) => {
    const instReceipts = receipts.filter((r) => r.installment_id === inst.id);
    const interestReceipts = instReceipts.filter((r) => r.receipt_type === "INTEREST");
    const principalReceipts = instReceipts.filter((r) => r.receipt_type === "PRINCIPAL");
    const interestReceived = interestReceipts.reduce((s, r) => s + Number(r.received_amount) + Number(r.tds_amount), 0);
    const principalReceived = principalReceipts.reduce((s, r) => s + Number(r.received_amount) + Number(r.tds_amount), 0);
    const totalDue = Number(inst.interest_due) + Number(inst.principal_due);
    const totalReceived = interestReceived + principalReceived;
    const cashReceived = instReceipts.reduce((s, r) => s + Number(r.received_amount), 0);
    const tdsReceived = instReceipts.reduce((s, r) => s + Number(r.tds_amount), 0);
    const lastInterestReceiptDate =
      interestReceipts.length > 0 ? interestReceipts.map((r) => r.receipt_date).sort().slice(-1)[0] : null;
    const lastPrincipalReceiptDate =
      principalReceipts.length > 0 ? principalReceipts.map((r) => r.receipt_date).sort().slice(-1)[0] : null;
    const lastReceiptDate =
      instReceipts.length > 0 ? instReceipts.map((r) => r.receipt_date).sort().slice(-1)[0] : null;
    const { status, label, toneClass } = getInstallmentStatus(totalDue, totalReceived, lastReceiptDate, inst.due_date, today);
    return {
      inst,
      label: monthLabel(inst),
      instReceipts,
      interestReceived,
      principalReceived,
      totalDue,
      totalReceived,
      cashReceived,
      tdsReceived,
      lastInterestReceiptDate,
      lastPrincipalReceiptDate,
      lastReceiptDate,
      status,
      statusLabel: label,
      toneClass,
    };
  });

  const totalReceivedToDate = enrichedInstallments.reduce((s, e) => s + e.totalReceived, 0);
  const principalReceivedToDate = enrichedInstallments.reduce((s, e) => s + e.principalReceived, 0);
  const outstandingPrincipal = Math.max(0, loan.loan_amount - principalReceivedToDate);
  const emiInstallmentCount = installments.filter(
    (i) => !isAdvanceRow(i) && Number(i.interest_due) + Number(i.principal_due) > 0.5
  ).length;
  const installmentsPaidCount = enrichedInstallments.filter(
    (e) => !isAdvanceRow(e.inst) && (e.status === "PAID" || e.status === "PAID_LATE")
  ).length;
  const paidLateCount = enrichedInstallments.filter((e) => e.status === "PAID_LATE").length;
  const overdueUnpaidCount = enrichedInstallments.filter((e) => e.status === "OVERDUE").length;
  const shortReceiptsCount = enrichedInstallments.filter((e) => e.status === "SHORT" || e.status === "PARTIAL").length;

  const cashFlowChartData = enrichedInstallments.map((e) => ({
    name: e.label,
    Planned: e.totalDue,
    Received: e.totalReceived,
  }));

  const glidePathChartData = (() => {
    let outstanding = loan.loan_amount;
    const points = [{ name: "Start", Outstanding: outstanding }];
    for (const e of enrichedInstallments) {
      outstanding = round2(outstanding - Number(e.inst.principal_due));
      points.push({ name: e.label, Outstanding: outstanding });
    }
    return points;
  })();

  const advanceRow = installments.find(isAdvanceRow);

  const plannedXirr = getPlannedXirr(loan, xirrInstallments);
  const actualXirr = getActualXirr(loan, xirrInstallments, transactions, new Date());
  const xirrComparison = compareXirr(actualXirr, plannedXirr);
  const actualXirrTone =
    xirrComparison === "BEHIND"
      ? "text-rose-700"
      : xirrComparison === "AHEAD"
      ? "text-emerald-700"
      : "text-slate-800";

  const tabList =
    loan.loan_type === "EMI" ? (["overview", "schedule", "reports"] as const) : (["overview", "ledger"] as const);
  const tabMeta: Record<string, { label: string; icon: ComponentType<{ className?: string }> }> = {
    overview: { label: "Overview", icon: IconGrid },
    schedule: { label: "Schedule & payments", icon: IconCalendar },
    reports: { label: "Reports & XIRR", icon: IconBarChart },
    ledger: { label: "Ledger", icon: IconCalendar },
  };

  return (
    <div>
      {loan.status === "CLOSED" && (
        <Link href="/closed-loans" className="print-hide text-sm text-teal-700 hover:underline">
          ← Back to Closed Loans
        </Link>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 mt-1">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-slate-900">{loan.borrowers?.name ?? "Unknown borrower"}</h1>
            {loan.loan_type === "ON_CALL" && (
              <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-indigo-100 text-indigo-700">
                On-Call loan
              </span>
            )}
            <span
              className={
                "text-xs font-semibold rounded-full px-2.5 py-1 " +
                (loan.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-slate-200 text-slate-700")
              }
            >
              {loan.status === "ACTIVE" ? "Active" : "Closed"}
            </span>
            {loan.routing_account_name && <span className="text-sm text-slate-400">— {loan.routing_account_name}</span>}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Lender: {loan.lender_name}
            {" · "}Referral:{" "}
            {referralColor && loan.referrals ? (
              <span className={`text-xs font-semibold rounded-full px-2 py-0.5 ${referralColor.badgeBg} ${referralColor.badgeText}`}>
                {loan.referrals.name}
              </span>
            ) : (
              "—"
            )}
            {" · "}
            {loan.loan_type === "ON_CALL" ? "Initial " : ""}
            {formatINR(loan.loan_amount)}
            {" · "}
            {loan.loan_type === "EMI"
              ? `${loan.emi_interest_rate}%${loan.emi_interest_method === "LUMPSUM_ADVANCE" ? "/mo" : "/yr"}`
              : `${loan.oncall_annual_rate}% p.a. (day-count)`}
            {loan.loan_type === "EMI" && ` · ${loan.emi_tenure_months} mo`}
            {" · "}Planned XIRR: {formatPercent(plannedXirr)}
            {(loan.co_lender_1 || loan.co_lender_2) && (
              <>
                {" · "}Co-lenders: {[loan.co_lender_1, loan.co_lender_2].filter(Boolean).join(", ")}
              </>
            )}
          </p>
        </div>
        <div className="print-hide flex items-center gap-3 shrink-0">
          {loan.status === "ACTIVE" && (
            <button
              onClick={() => {
                setTab("overview");
                startEditBasics();
              }}
              className="text-sm font-semibold text-slate-500 hover:text-teal-700 hover:underline"
            >
              Edit details
            </button>
          )}
          {loan.status === "ACTIVE" && isAdmin && (
            <button
              onClick={handleDeleteLoan}
              disabled={deleting}
              aria-label="Delete loan"
              className="text-slate-400 hover:text-rose-600 disabled:opacity-60"
            >
              <IconTrash className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="print-hide flex gap-2 mt-5 border-b border-slate-200">
        {tabList.map((t) => {
          const { label, icon: Icon } = tabMeta[t];
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "flex items-center gap-1.5 px-4 py-2 text-sm font-semibold border-b-2 -mb-px " +
                (tab === t ? "border-teal-600 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700")
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          );
        })}
      </div>

      {tab === "overview" && (
        <div className="mt-4 space-y-6">
          {editingBasics && (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="border border-teal-200 bg-teal-50/40 rounded-lg p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">Edit loan details</h3>
                <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-slate-200 text-slate-700">
                  {loan.loan_type === "EMI" ? "EMI" : "On-Call"} (type can&apos;t be changed)
                </span>
              </div>

              <div>
                <label className={labelClass}>Borrower</label>
                {!editAddingBorrower ? (
                  <div className="flex gap-2">
                    <select
                      value={editBorrowerId}
                      onChange={(e) => setEditBorrowerId(e.target.value)}
                      className={inputClass}
                    >
                      {borrowers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setEditAddingBorrower(true)}
                      className="shrink-0 text-sm text-teal-700 hover:underline whitespace-nowrap"
                    >
                      + Add new
                    </button>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white">
                    <input
                      value={editNewBorrowerName}
                      onChange={(e) => setEditNewBorrowerName(e.target.value)}
                      placeholder="Borrower name"
                      className={inputClass}
                    />
                    <input
                      value={editNewBorrowerWhatsapp}
                      onChange={(e) => setEditNewBorrowerWhatsapp(e.target.value)}
                      placeholder="WhatsApp number (optional, e.g. 919xxxxxxxxx)"
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleEditAddBorrower}
                        className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-1.5 px-3"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditAddingBorrower(false)}
                        className="text-sm text-slate-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Lender</label>
                  <input value={editLenderName} onChange={(e) => setEditLenderName(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Co-lender 1 (optional)</label>
                  <input value={editCoLender1} onChange={(e) => setEditCoLender1(e.target.value)} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Co-lender 2 (optional)</label>
                  <input value={editCoLender2} onChange={(e) => setEditCoLender2(e.target.value)} className={inputClass} />
                </div>
              </div>

              <div>
                <label className={labelClass}>Referral</label>
                {!editAddingReferral ? (
                  <div className="flex gap-2">
                    <select
                      value={editReferralId}
                      onChange={(e) => setEditReferralId(e.target.value)}
                      className={inputClass}
                    >
                      {referrals.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setEditAddingReferral(true)}
                      className="shrink-0 text-sm text-teal-700 hover:underline whitespace-nowrap"
                    >
                      + Add new
                    </button>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg p-3 space-y-2 bg-white">
                    <input
                      value={editNewReferralName}
                      onChange={(e) => setEditNewReferralName(e.target.value)}
                      placeholder="Referral name"
                      className={inputClass}
                    />
                    <input
                      value={editNewReferralWhatsapp}
                      onChange={(e) => setEditNewReferralWhatsapp(e.target.value)}
                      placeholder="WhatsApp number, e.g. 919xxxxxxxxx"
                      className={inputClass}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={handleEditAddReferral}
                        className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-1.5 px-3"
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditAddingReferral(false)}
                        className="text-sm text-slate-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Disbursement date</label>
                  <input
                    value={editDisbursementDateText}
                    onChange={(e) => setEditDisbursementDateText(e.target.value)}
                    onBlur={() => {
                      const parsed = parseFlexibleDate(editDisbursementDateText);
                      if (parsed) setEditDisbursementDateText(formatDate(parsed));
                    }}
                    placeholder="e.g. 9 Aug 26 or 9/8/26"
                    className={inputClass}
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {editDisbursementDateText
                      ? editParsedDisbursementDate
                        ? formatDate(toISODateString(editParsedDisbursementDate))
                        : "Couldn't read that date"
                      : " "}
                  </p>
                </div>
                <div>
                  <label className={labelClass}>Loan amount (₹)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={editLoanAmountText}
                    onChange={(e) => setEditLoanAmountText(formatAmountInput(e.target.value))}
                    className={inputClass}
                  />
                </div>
              </div>

              {loan.loan_type === "EMI" ? (
                <div className="border-t border-slate-200 pt-3 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">EMI details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Interest collection method</label>
                      <select
                        value={editEmiInterestMethod}
                        onChange={(e) => setEditEmiInterestMethod(e.target.value as EmiInterestMethod)}
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
                        value={editEmiPrincipalMethod}
                        onChange={(e) => setEditEmiPrincipalMethod(e.target.value as EmiPrincipalMethod)}
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>
                        Interest rate ({editEmiInterestMethod === "LUMPSUM_ADVANCE" ? "% p.m." : "% p.a."})
                      </label>
                      <input
                        type="number"
                        value={editEmiInterestRate}
                        onChange={(e) => setEditEmiInterestRate(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Tenure (months)</label>
                      <input
                        type="number"
                        value={editEmiTenureMonths}
                        onChange={(e) => setEditEmiTenureMonths(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Moratorium (months)</label>
                      <input
                        type="number"
                        value={editEmiMoratoriumMonths}
                        onChange={(e) => setEditEmiMoratoriumMonths(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border-t border-slate-200 pt-3 space-y-3">
                  <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">On-Call details</h4>
                  <div>
                    <label className={labelClass}>Annual interest rate (%)</label>
                    <input
                      type="number"
                      value={editOncallAnnualRate}
                      onChange={(e) => setEditOncallAnnualRate(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className={labelClass}>Routing A/c Name (optional)</label>
                <input
                  value={editRoutingAccountName}
                  onChange={(e) => setEditRoutingAccountName(e.target.value)}
                  className={inputClass}
                />
              </div>

              {loan.loan_type === "EMI" && (
                <p className="text-xs text-slate-500">
                  Changing the loan amount, disbursement date, or EMI terms regenerates the whole repayment
                  schedule. If receipts are already recorded against this loan, you&apos;ll be asked to confirm
                  before they&apos;re deleted.
                </p>
              )}
              {editBasicsError && <p className="text-sm text-rose-600">{editBasicsError}</p>}
              <div className="flex gap-2">
                <button
                  disabled={editBasicsSubmitting}
                  onClick={handleSaveBasics}
                  className="rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-semibold py-1.5 px-3"
                >
                  {editBasicsSubmitting ? "Saving…" : "Save"}
                </button>
                <button onClick={() => setEditingBasics(false)} className="text-sm text-slate-500 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          </div>
          )}

          {loan.loan_type === "EMI" && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                  label="Total received to date"
                  value={formatINR(totalReceivedToDate)}
                  sub="cash + TDS credit"
                  icon={<IconTrendingUp className="w-4 h-4" />}
                />
                <StatTile
                  label="Outstanding principal (est.)"
                  value={formatINR(outstandingPrincipal)}
                  sub={`of ${formatINR(loan.loan_amount)} total`}
                  icon={<IconRupee className="w-4 h-4" />}
                />
                <StatTile
                  label="Planned XIRR"
                  value={formatPercent(plannedXirr)}
                  sub="At contracted terms"
                  icon={<IconTrendingUp className="w-4 h-4" />}
                />
                <StatTile
                  label={loan.status === "CLOSED" ? "Actual XIRR (at closure)" : "Actual XIRR (projected)"}
                  value={formatPercent(actualXirr)}
                  sub={xirrComparison === "BEHIND" ? "Behind plan" : xirrComparison === "AHEAD" ? "Ahead of plan" : "On track"}
                  valueClass={actualXirrTone}
                  icon={<IconTrendingDown className="w-4 h-4" />}
                />
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile label="Installments paid" value={String(installmentsPaidCount)} sub={`of ${emiInstallmentCount}`} />
                <StatTile label="Paid late" value={String(paidLateCount)} />
                <StatTile label="Overdue, unpaid" value={String(overdueUnpaidCount)} icon={<IconWarning className="w-4 h-4" />} />
                <StatTile label="Short receipts (TDS or otherwise)" value={String(shortReceiptsCount)} />
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Cash flow — planned vs received</h3>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={cashFlowChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => formatINR(Number(v))} />
                    <Legend />
                    <Bar dataKey="Planned" fill="#cbd5e1" />
                    <Bar dataKey="Received" fill="#0d9488" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-700 mb-3">Outstanding principal glide path</h3>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={glidePathChartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => formatINR(Number(v))} />
                    <Line type="stepAfter" dataKey="Outstanding" stroke="#0d9488" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}

          {loan.loan_type === "ON_CALL" && oncallAccrual && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                  label="Outstanding principal"
                  value={formatINR(oncallAccrual.outstandingPrincipal)}
                  icon={<IconRupee className="w-4 h-4" />}
                />
                <StatTile
                  label="Accrued interest to date"
                  value={formatINR(oncallAccrual.accruedInterest)}
                  icon={<IconTrendingUp className="w-4 h-4" />}
                />
                <StatTile
                  label="Interest received"
                  value={formatINR(oncallAccrual.interestReceived)}
                  icon={<IconTrendingUp className="w-4 h-4" />}
                />
                <StatTile
                  label="Unpaid accrued interest"
                  value={formatINR(oncallAccrual.unpaidAccruedInterest)}
                  icon={<IconWarning className="w-4 h-4" />}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatTile
                  label="Total owed today"
                  value={formatINR(oncallAccrual.totalOwedToday)}
                  sub="principal + unpaid interest"
                  icon={<IconWarning className="w-4 h-4" />}
                />
                <StatTile
                  label="Planned XIRR"
                  value={formatPercent(plannedXirr)}
                  sub="contracted rate"
                  icon={<IconTrendingUp className="w-4 h-4" />}
                />
                <StatTile
                  label="Current XIRR"
                  value={formatPercent(actualXirr)}
                  sub="assumes balance collected today"
                  valueClass={actualXirrTone}
                  icon={<IconTrendingDown className="w-4 h-4" />}
                />
              </div>
            </>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <InfoRow label="Borrower" value={loan.borrowers?.name ?? "—"} />
            <InfoRow label="Lender" value={loan.lender_name} />
            {loan.co_lender_1 && <InfoRow label="Co-lender 1" value={loan.co_lender_1} />}
            {loan.co_lender_2 && <InfoRow label="Co-lender 2" value={loan.co_lender_2} />}
            <InfoRow label="Referral" value={loan.referrals?.name ?? "—"} />
            <InfoRow label="Disbursement date" value={formatDate(loan.disbursement_date)} />
            <InfoRow
              label={loan.loan_type === "ON_CALL" ? "Loan amount (incl. top-ups)" : "Loan amount"}
              value={formatINR(totalLoanAmount)}
            />
            <InfoRow label="Routing A/c Name" value={loan.routing_account_name ?? "—"} />
            {loan.loan_type === "EMI" ? (
              <>
                <InfoRow
                  label="Interest method"
                  value={loan.emi_interest_method ? INTEREST_METHOD_LABELS[loan.emi_interest_method] : "—"}
                />
                <InfoRow
                  label="Principal method"
                  value={loan.emi_principal_method ? PRINCIPAL_METHOD_LABELS[loan.emi_principal_method] : "—"}
                />
                <InfoRow
                  label="Interest rate"
                  value={`${loan.emi_interest_rate}% ${loan.emi_interest_method === "LUMPSUM_ADVANCE" ? "p.m." : "p.a."}`}
                />
                <InfoRow label="Tenure" value={`${loan.emi_tenure_months} months`} />
                <InfoRow label="Moratorium" value={`${loan.emi_moratorium_months} months`} />
              </>
            ) : (
              <InfoRow label="Annual interest rate" value={`${loan.oncall_annual_rate}%`} />
            )}
          </div>

          {loan.status === "CLOSED" ? (
            <div className="border-t border-slate-200 pt-4 text-sm">
              <h3 className="font-semibold text-slate-700 mb-2">Closure details</h3>
              <InfoRow label="Closure date" value={formatDate(loan.closure_date)} />
              <InfoRow label="Settlement amount" value={formatINR(loan.closure_settlement_amount)} />
              {loan.closure_notes && <InfoRow label="Notes" value={loan.closure_notes} />}
              <button
                onClick={handleReopenLoan}
                disabled={reopening}
                className="mt-3 text-sm font-semibold text-teal-700 hover:underline disabled:opacity-60"
              >
                {reopening ? "Reopening…" : "Reopen this loan"}
              </button>
            </div>
          ) : (
            <div className="border-t border-slate-200 pt-4">
              {!closing ? (
                <button
                  onClick={startForceClose}
                  className="text-sm font-semibold text-rose-600 hover:underline"
                >
                  Force close this loan
                </button>
              ) : (
                <div className="border border-rose-200 bg-rose-50 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-rose-700">Force close</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Closure date</label>
                      <input
                        value={closureDateText}
                        onChange={(e) => setClosureDateText(e.target.value)}
                        onBlur={() => {
                          const parsed = parseFlexibleDate(closureDateText);
                          if (parsed) setClosureDateText(formatDate(parsed));
                        }}
                        placeholder="e.g. 9 Aug 26"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Amount recd (₹)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={closureAmountText}
                        onChange={(e) => setClosureAmountText(formatAmountInput(e.target.value))}
                        placeholder="Amount (₹)"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>TDS (₹, if any)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={closureTdsText}
                        onChange={(e) => setClosureTdsText(formatAmountInput(e.target.value))}
                        placeholder="TDS (₹, optional)"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Final settlement amount (₹)</label>
                      <input
                        type="text"
                        disabled
                        value={formatINR(closureFinalSettlement)}
                        className={`${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed`}
                      />
                      <p className="text-xs text-slate-400 mt-1">Amount received + TDS, computed automatically.</p>
                    </div>
                    <div>
                      <label className={labelClass}>Notes (optional)</label>
                      <input
                        value={closureNotes}
                        onChange={(e) => setClosureNotes(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  {closeError && <p className="text-sm text-rose-600">{closeError}</p>}
                  <div className="flex gap-2">
                    <button
                      disabled={closeSubmitting}
                      onClick={handleForceClose}
                      className="rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white text-sm font-semibold py-1.5 px-3"
                    >
                      {closeSubmitting ? "Closing…" : "Confirm force close"}
                    </button>
                    <button
                      onClick={() => setClosing(false)}
                      className="text-sm text-slate-500 hover:underline"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          </div>
        </div>
      )}

      {tab === "schedule" && loan.loan_type === "EMI" && (
        <div className="mt-4 space-y-4">
          <div className="print-hide flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {loan.borrowers?.name ?? "Unknown borrower"} — full repayment schedule
            </p>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <button
                  onClick={handleRegenerateSchedule}
                  disabled={regeneratingSchedule}
                  className="rounded-lg border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-sm font-semibold py-1.5 px-3"
                >
                  {regeneratingSchedule ? "Regenerating…" : "Regenerate schedule"}
                </button>
              )}
              <button
                onClick={() => window.print()}
                className="flex items-center gap-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-1.5 px-3"
              >
                <IconPrint className="w-4 h-4" />
                Print schedule
              </button>
            </div>
          </div>

          {advanceRow && (
            <div className="bg-teal-50 border border-teal-200 rounded-lg px-4 py-2.5 text-sm text-teal-800">
              Row &quot;Adv.&quot; is the full interest collected in advance, due the day after disbursement (
              {formatDate(advanceRow.due_date)}). It&apos;s tracked like any other installment below.
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-3">Mo.</th>
                  <th className="px-4 py-3">Due date</th>
                  <th className="px-4 py-3">Interest due</th>
                  <th className="px-4 py-3">Principal due</th>
                  <th className="px-4 py-3">Total due</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 w-28">Receipt date</th>
                  <th className="px-4 py-3">Received</th>
                  <th className="px-4 py-3">Delay</th>
                  <th className="print-hide px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {enrichedInstallments.map((e) => {
                  const { inst } = e;
                  const isRecordingHere = recordingFor?.installmentId === inst.id;
                  const isRecordingRepaymentHere = recordingRepaymentFor === inst.id;
                  const delayDays =
                    e.lastReceiptDate &&
                    (e.status === "PAID_LATE" || (e.status === "PAID" && e.lastReceiptDate < inst.due_date))
                      ? Math.round((Date.parse(e.lastReceiptDate) - Date.parse(inst.due_date)) / 86400000)
                      : null;

                  const recordingRow = isRecordingHere && (
                    <tr key={`${inst.id}-record`} className="print-hide border-b border-slate-100 bg-slate-50">
                      <td colSpan={10} className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-semibold text-teal-700 whitespace-nowrap">
                            {e.label} · {editingReceiptId ? "Edit" : "New"} {recordingFor.type === "INTEREST" ? "interest" : "principal"} receipt
                          </span>
                          <div className="flex flex-nowrap items-end gap-2">
                            <input
                              value={receiptDateText}
                              onChange={(ev) => setReceiptDateText(ev.target.value)}
                              onBlur={() => {
                                const parsed = parseFlexibleDate(receiptDateText);
                                if (parsed) setReceiptDateText(formatDate(parsed));
                              }}
                              placeholder="Date, e.g. 9 Aug 26"
                              className={`${inputClass} w-36`}
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              value={receiptAmountText}
                              onChange={(ev) => setReceiptAmountText(formatAmountInput(ev.target.value))}
                              placeholder="Amount (₹)"
                              className={`${inputClass} w-32`}
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              value={receiptTdsText}
                              onChange={(ev) => setReceiptTdsText(formatAmountInput(ev.target.value))}
                              placeholder="TDS (₹, optional)"
                              className={`${inputClass} w-32`}
                            />
                            <button
                              disabled={receiptSubmitting}
                              onClick={handleRecordReceipt}
                              className="shrink-0 rounded bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold py-1.5 px-2"
                            >
                              {receiptSubmitting ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={() => {
                                setRecordingFor(null);
                                setEditingReceiptId(null);
                              }}
                              className="shrink-0 text-xs text-slate-500 hover:underline"
                            >
                              Cancel
                            </button>
                            {receiptError && <p className="text-xs text-rose-600 whitespace-nowrap">{receiptError}</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );

                  const repaymentRow = isRecordingRepaymentHere && (
                    <tr key={`${inst.id}-repayment`} className="print-hide border-b border-slate-100 bg-slate-50">
                      <td colSpan={10} className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          <span className="text-xs font-semibold text-teal-700 whitespace-nowrap">
                            {e.label} · New repayment
                          </span>
                          <div className="flex flex-nowrap items-end gap-2">
                            <input
                              value={repaymentDateText}
                              onChange={(ev) => setRepaymentDateText(ev.target.value)}
                              onBlur={() => {
                                const parsed = parseFlexibleDate(repaymentDateText);
                                if (parsed) setRepaymentDateText(formatDate(parsed));
                              }}
                              placeholder="Date, e.g. 9 Aug 26"
                              className={`${inputClass} w-36`}
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              value={repaymentPrincipalText}
                              onChange={(ev) => {
                                setRepaymentPrincipalText(formatAmountInput(ev.target.value));
                                setRepaymentPrincipalIsDefault(false);
                              }}
                              placeholder="Principal (₹)"
                              className={`${inputClass} w-32 ${repaymentPrincipalIsDefault ? "text-slate-400" : ""}`}
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              value={repaymentInterestText}
                              onChange={(ev) => {
                                setRepaymentInterestText(formatAmountInput(ev.target.value));
                                setRepaymentInterestIsDefault(false);
                              }}
                              placeholder="Interest (₹)"
                              className={`${inputClass} w-32 ${repaymentInterestIsDefault ? "text-slate-400" : ""}`}
                            />
                            <input
                              type="text"
                              inputMode="numeric"
                              value={repaymentTdsText}
                              onChange={(ev) => setRepaymentTdsText(formatAmountInput(ev.target.value))}
                              placeholder="TDS (₹, optional)"
                              className={`${inputClass} w-32`}
                            />
                            <button
                              disabled={repaymentSubmitting}
                              onClick={handleSaveRepayment}
                              className="shrink-0 rounded bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold py-1.5 px-2"
                            >
                              {repaymentSubmitting ? "Saving…" : "Save"}
                            </button>
                            <button
                              onClick={() => setRecordingRepaymentFor(null)}
                              className="shrink-0 text-xs text-slate-500 hover:underline"
                            >
                              Cancel
                            </button>
                            {repaymentError && <p className="text-xs text-rose-600 whitespace-nowrap">{repaymentError}</p>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );

                  return (
                    <Fragment key={inst.id}>
                    <tr className="border-b border-slate-100 align-top">
                      <td className="px-4 py-3 text-teal-700 font-medium">{e.label}</td>
                      <td className="px-4 py-3">{formatDate(inst.due_date)}</td>
                      <td className="px-4 py-3">{formatINR(inst.interest_due)}</td>
                      <td className="px-4 py-3">{formatINR(inst.principal_due)}</td>
                      <td className="px-4 py-3 font-medium">{formatINR(e.totalDue)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold rounded-full px-2 py-1 ${e.toneClass}`}>{e.statusLabel}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                        {e.instReceipts.length === 0 && "—"}
                        {e.instReceipts.map((r) => (
                          <div key={r.id} className="flex items-center gap-1.5">
                            <span>
                              {r.receipt_type === "INTEREST" ? "Int" : "Prin"}: {formatDate(r.receipt_date)}
                            </span>
                            <button onClick={() => startEditReceipt(r)} className="print-hide text-teal-700 hover:underline">
                              edit
                            </button>
                            {isAdmin && (
                              <button
                                onClick={() => handleDeleteReceipt(r.id)}
                                className="print-hide text-rose-500 hover:underline"
                              >
                                delete
                              </button>
                            )}
                          </div>
                        ))}
                      </td>
                      <td className="px-4 py-3">
                        {e.totalReceived > 0 ? (
                          <div>
                            <div>{formatINR(e.totalReceived)}</div>
                            {e.tdsReceived > 0 && (
                              <div className="text-xs font-normal text-slate-400">
                                {formatINR(e.cashReceived)} + {formatINR(e.tdsReceived)} TDS
                              </div>
                            )}
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {delayDays === null ? (
                          "—"
                        ) : delayDays < 0 ? (
                          <span className="text-emerald-600">{Math.abs(delayDays)}d early</span>
                        ) : (
                          <span className="text-rose-600">{delayDays}d late</span>
                        )}
                      </td>
                      <td className="print-hide px-4 py-3 text-xs whitespace-nowrap">
                        {loan.emi_interest_method === "FLAT_MONTHLY" ? (
                          (inst.interest_due > 0 || inst.principal_due > 0) && (
                            <button
                              onClick={() => startRecordRepayment(inst)}
                              className="text-teal-700 hover:underline"
                            >
                              + Record repayment
                            </button>
                          )
                        ) : (
                          <>
                            {inst.interest_due > 0 && (
                              <button
                                onClick={() => startRecordReceipt(inst.id, "INTEREST")}
                                className="text-teal-700 hover:underline"
                              >
                                + Int
                              </button>
                            )}
                            {inst.interest_due > 0 && inst.principal_due > 0 && " "}
                            {inst.principal_due > 0 && (
                              <button
                                onClick={() => startRecordReceipt(inst.id, "PRINCIPAL")}
                                className="text-teal-700 hover:underline"
                              >
                                + Prin
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                    {recordingRow}
                    {repaymentRow}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {loan.status === "ACTIVE" && (
            <button
              onClick={() => {
                setTab("overview");
                startForceClose();
              }}
              className="print-hide text-sm font-semibold text-rose-600 hover:underline"
            >
              Force close this loan
            </button>
          )}
        </div>
      )}

      {tab === "reports" && loan.loan_type === "EMI" && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <StatTile
              label="Planned XIRR"
              value={formatPercent(plannedXirr)}
              sub="At contracted terms"
              icon={<IconTrendingUp className="w-4 h-4" />}
            />
            <StatTile
              label={loan.status === "CLOSED" ? "Actual XIRR (at closure)" : "Actual XIRR (projected)"}
              value={formatPercent(actualXirr)}
              sub={xirrComparison === "BEHIND" ? "Behind plan" : xirrComparison === "AHEAD" ? "Ahead of plan" : "On track"}
              valueClass={actualXirrTone}
              icon={<IconTrendingDown className="w-4 h-4" />}
            />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-3">Mo.</th>
                  <th className="px-4 py-3">Due date</th>
                  <th className="px-4 py-3">Planned cash flow</th>
                  <th className="px-4 py-3">Actual received</th>
                  <th className="px-4 py-3">Variance</th>
                </tr>
              </thead>
              <tbody>
                {enrichedInstallments.map((e) => (
                  <tr key={e.inst.id} className="border-b border-slate-100">
                    <td className="px-4 py-3 text-teal-700 font-medium">{e.label}</td>
                    <td className="px-4 py-3">{formatDate(e.inst.due_date)}</td>
                    <td className="px-4 py-3">{formatINR(e.totalDue)}</td>
                    <td className="px-4 py-3">{formatINR(e.totalReceived)}</td>
                    <td className={`px-4 py-3 ${e.totalReceived < e.totalDue - 1 ? "text-rose-600" : "text-emerald-600"}`}>
                      {formatINR(e.totalReceived - e.totalDue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "ledger" && loan.loan_type === "ON_CALL" && (
        <div className="mt-4 space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Principal</th>
                  <th className="px-4 py-3">Interest</th>
                  <th className="px-4 py-3">TDS</th>
                  <th className="px-4 py-3">Outstanding after</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  let running = 0;
                  const rows = [];
                  running += Number(loan.loan_amount);
                  rows.push(
                    <tr key="disbursement" className="border-b border-slate-100 bg-slate-50">
                      <td className="px-4 py-3">{formatDate(loan.disbursement_date)}</td>
                      <td className="px-4 py-3">Disbursement</td>
                      <td className="px-4 py-3">{formatINR(loan.loan_amount)}</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">{formatINR(running)}</td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  );
                  for (const t of transactions) {
                    running += t.transaction_type === "DRAW" ? Number(t.amount) : -Number(t.principal_portion);
                    rows.push(
                      <tr key={t.id} className="border-b border-slate-100">
                        <td className="px-4 py-3">{formatDate(t.transaction_date)}</td>
                        <td className="px-4 py-3">{t.transaction_type === "DRAW" ? "Top-up" : "Repayment"}</td>
                        <td className="px-4 py-3">{formatINR(t.amount)}</td>
                        <td className="px-4 py-3">{t.transaction_type === "REPAYMENT" ? formatINR(t.principal_portion) : "—"}</td>
                        <td className="px-4 py-3">{t.transaction_type === "REPAYMENT" ? formatINR(t.interest_portion) : "—"}</td>
                        <td className="px-4 py-3">{Number(t.tds_on_interest) > 0 ? formatINR(t.tds_on_interest) : "—"}</td>
                        <td className="px-4 py-3">{formatINR(running)}</td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <button onClick={() => startEditTxn(t)} className="text-teal-700 hover:underline text-xs mr-2">
                            edit
                          </button>
                          {isAdmin && (
                            <button onClick={() => handleDeleteTxn(t.id)} className="text-rose-600 hover:underline text-xs">
                              delete
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                })()}
              </tbody>
            </table>
          </div>

          {!addingTxn ? (
            <button
              onClick={() => setAddingTxn(true)}
              className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 px-4"
            >
              + Add top-up / repayment
            </button>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-700">
                {editingTxnId ? "Edit ledger entry" : "New ledger entry"}
              </h3>
              <div className="grid grid-cols-2 gap-2 max-w-xs">
                {(["DRAW", "REPAYMENT"] as TxnType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTxnType(t)}
                    className={
                      "rounded-lg py-2 text-sm font-semibold border " +
                      (txnType === t
                        ? "bg-teal-600 text-white border-teal-600"
                        : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50")
                    }
                  >
                    {t === "DRAW" ? "Top-up" : "Repayment"}
                  </button>
                ))}
              </div>
              {txnType === "DRAW" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={labelClass}>Date</label>
                    <input
                      value={txnDateText}
                      onChange={(e) => setTxnDateText(e.target.value)}
                      onBlur={() => {
                        const parsed = parseFlexibleDate(txnDateText);
                        if (parsed) setTxnDateText(formatDate(parsed));
                      }}
                      placeholder="e.g. 9 Aug 26"
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Amount (₹)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={txnAmountText}
                      onChange={(e) => setTxnAmountText(formatAmountInput(e.target.value))}
                      className={inputClass}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className={labelClass}>Principal portion (₹)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={txnPrincipalText}
                        onChange={(e) => setTxnPrincipalText(formatAmountInput(e.target.value))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Interest portion (₹)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={txnInterestText}
                        onChange={(e) => setTxnInterestText(formatAmountInput(e.target.value))}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>TDS (₹)</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={txnTdsText}
                        onChange={(e) => setTxnTdsText(formatAmountInput(e.target.value))}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Date</label>
                      <input
                        value={txnDateText}
                        onChange={(e) => setTxnDateText(e.target.value)}
                        onBlur={() => {
                          const parsed = parseFlexibleDate(txnDateText);
                          if (parsed) setTxnDateText(formatDate(parsed));
                        }}
                        placeholder="e.g. 9 Aug 26"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Amount (₹) — auto</label>
                      <input
                        type="text"
                        disabled
                        value={formatINR(
                          round2(
                            (parseAmountInput(txnPrincipalText || "0") || 0) +
                              (parseAmountInput(txnInterestText || "0") || 0) +
                              (parseAmountInput(txnTdsText || "0") || 0)
                          )
                        )}
                        className={`${inputClass} bg-slate-100 text-slate-500 cursor-not-allowed`}
                      />
                    </div>
                  </div>
                </>
              )}
              <div>
                <label className={labelClass}>Notes (optional)</label>
                <input value={txnNotes} onChange={(e) => setTxnNotes(e.target.value)} className={inputClass} />
              </div>
              {txnError && <p className="text-sm text-rose-600">{txnError}</p>}
              <div className="flex gap-2">
                <button
                  disabled={txnSubmitting}
                  onClick={handleSaveTxn}
                  className="rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-semibold py-1.5 px-3"
                >
                  {txnSubmitting ? "Saving…" : "Save"}
                </button>
                <button onClick={resetTxnForm} className="text-sm text-slate-500 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6">
        <button onClick={() => router.push("/dashboard")} className="text-sm text-slate-500 hover:underline">
          ← Back to Dashboard
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-800 font-medium">{value}</div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  valueClass,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between text-xs font-medium text-slate-500">
        {label}
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <div className={`text-xl font-bold mt-1 ${valueClass ?? "text-slate-800"}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// Fills the Loan Agreement Word templates (public/templates) with a loan's and
// borrower's data, entirely in the browser. Individual borrowers get
// "Loan_Agreement_Individual"; every other entity type gets
// "Loan_Agreement_Corporate", whose authorised signatory is also the guarantor.
//
// The templates' fill-in spots are table rows (label cell + value cell) and
// paragraphs with bracketed placeholders like "[PAN]" or "[●]". Spots we have
// data for are overwritten; every placeholder still left afterwards is
// highlighted yellow in the document and reported back as missing so it can
// be filled by hand.

import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate } from "@/lib/format";
import { entityTypeLabel, type BorrowerDetails } from "@/lib/borrowers";
import type { EmiInterestMethod, EmiPrincipalMethod } from "@/lib/emiSchedule";

export type AgreementKind = "INDIVIDUAL" | "CORPORATE";

export function agreementKind(entityType: string): AgreementKind {
  return entityType === "INDIVIDUAL" ? "INDIVIDUAL" : "CORPORATE";
}

const TEMPLATE_URLS: Record<AgreementKind, string> = {
  INDIVIDUAL: "/templates/Loan_Agreement_Individual.docx",
  CORPORATE: "/templates/Loan_Agreement_Corporate.docx",
};
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const PLACE_OF_EXECUTION = "Chennai";

const PLACEHOLDER = /\[[^\]]*\]|●/;
// Clause 3.20's bracketed note is wording, not a fill-in.
const NOT_A_PLACEHOLDER = "Applicable only if the Borrower is a partnership firm";

interface AgreementLoan {
  id: string;
  disbursement_date: string;
  loan_amount: number;
  loan_type: "EMI" | "ON_CALL";
  emi_interest_method: EmiInterestMethod | null;
  emi_principal_method: EmiPrincipalMethod | null;
  emi_interest_rate: number | null;
  emi_tenure_months: number | null;
  oncall_annual_rate: number | null;
  borrowers: BorrowerDetails | null;
}

interface AgreementInstallment {
  installment_number: number;
  due_date: string;
  interest_due: number;
  principal_due: number;
}

export interface MissingItem {
  section: string;
  field: string;
}

export type AgreementResult =
  | { ok: true; blob: Blob; fileName: string; missing: MissingItem[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Formatting helpers

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function belowThousand(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

// Indian numbering: 2500000 -> "Twenty Five Lakh"
export function amountInWords(amount: number): string {
  let n = Math.round(amount);
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  if (crore) parts.push(`${amountInWords(crore)} Crore`);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  if (n) parts.push(belowThousand(n));
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// XML helpers (WordprocessingML via DOMParser)

function children(el: Element, localName: string): Element[] {
  return Array.from(el.childNodes).filter(
    (n): n is Element => n.nodeType === 1 && (n as Element).namespaceURI === W && (n as Element).localName === localName
  );
}

function descendants(el: Element | Document, localName: string): Element[] {
  return Array.from(el.getElementsByTagNameNS(W, localName));
}

function textOf(el: Element): string {
  return descendants(el, "t")
    .map((t) => t.textContent ?? "")
    .join("");
}

// Order of <w:rPr> children the schema allows after <w:highlight>; the
// highlight must be inserted before the first of these that is present.
const AFTER_HIGHLIGHT = new Set([
  "u", "effect", "bdr", "shd", "fitText", "vertAlign", "rtl", "cs", "em", "lang", "eastAsianLayout", "specVanish", "oMath",
]);

function highlightRun(run: Element) {
  const doc = run.ownerDocument;
  let rPr = children(run, "rPr")[0];
  if (!rPr) {
    rPr = doc.createElementNS(W, "w:rPr");
    run.insertBefore(rPr, run.firstChild);
  }
  if (children(rPr, "highlight").length) return;
  const hl = doc.createElementNS(W, "w:highlight");
  hl.setAttributeNS(W, "w:val", "yellow");
  const before = Array.from(rPr.childNodes).find(
    (n) => n.nodeType === 1 && AFTER_HIGHLIGHT.has((n as Element).localName)
  );
  rPr.insertBefore(hl, before ?? null);
}

// Replaces a paragraph's runs with the given lines (joined by line breaks),
// keeping the paragraph properties and the first run's formatting.
function setParagraphText(p: Element, lines: string[]) {
  const doc = p.ownerDocument;
  const firstRun = descendants(p, "r")[0];
  const rPr = firstRun ? children(firstRun, "rPr")[0] : children(children(p, "pPr")[0] ?? p, "rPr")[0];

  for (const node of Array.from(p.childNodes)) {
    if (!(node.nodeType === 1 && (node as Element).localName === "pPr")) p.removeChild(node);
  }

  const run = doc.createElementNS(W, "w:r");
  if (rPr) {
    const clone = rPr.cloneNode(true) as Element;
    // A paragraph-mark rPr may carry revision markers that aren't valid on a run.
    for (const c of Array.from(clone.childNodes)) {
      if (c.nodeType === 1 && ["ins", "del", "moveFrom", "moveTo", "rPrChange"].includes((c as Element).localName)) {
        clone.removeChild(c);
      }
    }
    run.appendChild(clone);
  }
  lines.forEach((line, i) => {
    if (i > 0) run.appendChild(doc.createElementNS(W, "w:br"));
    const t = doc.createElementNS(W, "w:t");
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    t.textContent = line;
    run.appendChild(t);
  });
  p.appendChild(run);
}

function setCellText(tc: Element, value: string | string[]) {
  const lines = Array.isArray(value) ? value : [value];
  const paragraphs = children(tc, "p");
  paragraphs.slice(1).forEach((p) => tc.removeChild(p));
  setParagraphText(paragraphs[0], lines);
}

function cellsOf(tr: Element): Element[] {
  return children(tr, "tc");
}

// For 2-column schedule tables the label is column 0 and the value column 1;
// for the KFS tables (Sl. No. | Parameter | Details [| Payable at]) the label
// is column 1 and the value column 2.
function labelAndValueCells(tr: Element): { label: string; value: Element } | null {
  const cells = cellsOf(tr);
  if (cells.length === 2) return { label: textOf(cells[0]).trim(), value: cells[1] };
  if (cells.length >= 3) return { label: textOf(cells[1]).trim(), value: cells[2] };
  return null;
}

function normaliseLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Loan-derived values

interface LoanFacts {
  rateText: string | null;
  tenure: string;
  maturity: string | null;
  interestFrequency: string | null;
  instalmentAmount: string | null;
  instalmentStart: string | null;
  repaymentFrequency: string;
  instalmentType: string;
  instalmentCount: string | null;
  totalInterest: number | null;
  totalRepayable: number | null;
}

function loanFacts(loan: AgreementLoan, installments: AgreementInstallment[]): LoanFacts {
  if (loan.loan_type === "ON_CALL") {
    const rate = loan.oncall_annual_rate;
    return {
      rateText:
        rate != null
          ? `${rate}% per annum, computed on a daily-reducing basis on the outstanding principal`
          : null,
      tenure: "Repayable on demand (On-Call loan)",
      maturity: "On demand",
      interestFrequency: null,
      instalmentAmount: "N/A – repayable on demand",
      instalmentStart: "N/A",
      repaymentFrequency: "On demand",
      instalmentType: "On demand (no fixed instalments)",
      instalmentCount: "N/A",
      totalInterest: null,
      totalRepayable: null,
    };
  }

  const rate = loan.emi_interest_rate;
  const method = loan.emi_interest_method;
  let rateText: string | null = null;
  let interestFrequency: string | null = null;
  if (rate != null && method) {
    switch (method) {
      case "PA_DIVIDED_365":
        rateText = `${rate}% per annum, computed on a daily-reducing basis on the outstanding principal`;
        interestFrequency = "Monthly in arrears";
        break;
      case "FLAT_MONTHLY":
        rateText = `${rate}% per annum, charged monthly (1/12th of the annual rate) on the outstanding principal`;
        interestFrequency = "Monthly in arrears";
        break;
      case "FLAT_MONTHLY_ADVANCE":
        rateText = `${rate}% per annum, charged monthly (1/12th of the annual rate) on the outstanding principal, collected upfront in advance`;
        interestFrequency = "Upfront, in advance (due the day after disbursement)";
        break;
      case "LUMPSUM_ADVANCE":
        rateText = `${rate}% per month on the loan amount for the full tenure, collected upfront in advance`;
        interestFrequency = "Upfront, in advance (due the day after disbursement)";
        break;
    }
  }

  const months = loan.emi_tenure_months;
  const bullet = loan.emi_principal_method === "LUMPSUM";
  const last = installments[installments.length - 1];
  const totalInterest = installments.length ? round2(installments.reduce((s, r) => s + Number(r.interest_due), 0)) : null;
  const totalPrincipal = installments.reduce((s, r) => s + Number(r.principal_due), 0);

  // Upfront-interest rows aren't regular instalments.
  const regular = installments.filter((r) => Number(r.principal_due) > 0 || !isUpfrontInterestRow(r, method));
  const amounts = regular.map((r) => Math.round(Number(r.principal_due) + Number(r.interest_due)));
  const allEqual = amounts.length > 0 && amounts.every((a) => a === amounts[0]);
  // The final instalment absorbs rounding, so it can differ slightly.
  const allButLastEqual = amounts.length > 1 && amounts.slice(0, -1).every((a) => a === amounts[0]);
  const upfrontInterest = method === "LUMPSUM_ADVANCE" || method === "FLAT_MONTHLY_ADVANCE";

  let instalmentAmount: string | null = null;
  if (allEqual) instalmentAmount = `INR ${inr0.format(amounts[0])}`;
  else if (allButLastEqual)
    instalmentAmount = `INR ${inr0.format(amounts[0])} (final instalment INR ${inr0.format(amounts[amounts.length - 1])})`;
  else if (amounts.length) instalmentAmount = "Varies – as per the repayment schedule at Annexure A to the KFS";

  return {
    rateText,
    tenure: months ? `${months} month${months === 1 ? "" : "s"}` : "",
    maturity: last ? formatDate(last.due_date) : null,
    interestFrequency,
    instalmentAmount,
    instalmentStart: regular[0] ? formatDate(regular[0].due_date) : null,
    repaymentFrequency: bullet ? "Lump sum at maturity (principal); interest as above" : "Monthly",
    instalmentType: bullet
      ? "Bullet (principal repaid at maturity)"
      : upfrontInterest
        ? "Monthly principal instalments (interest collected upfront)"
        : "EMI (monthly principal + interest)",
    instalmentCount: regular.length ? String(regular.length) : null,
    totalInterest,
    totalRepayable: totalInterest != null ? round2(totalPrincipal + totalInterest) : null,
  };
}

function isUpfrontInterestRow(r: AgreementInstallment, method: EmiInterestMethod | null): boolean {
  return (
    (method === "LUMPSUM_ADVANCE" || method === "FLAT_MONTHLY_ADVANCE") &&
    r.installment_number === 1 &&
    Number(r.principal_due) === 0
  );
}

// ---------------------------------------------------------------------------
// Filling

// Entered on the Loan Agreement tab just before download. `guarantor` is for
// Individual agreements; the three corporate fields aren't stored on the
// borrower, so they're entered per agreement.
export interface AgreementInputs {
  loanCode: string;
  guarantor: string;
  penalRate: string;
  cin: string;
  signatoryDesignation: string;
  boardResolution: string;
}

// Loan ID convention: financial year + DD + MM + a letter for the loan's order
// among loans disbursed that day, e.g. 27-09-2026 -> "2026272709a", then "…b".
export function defaultLoanCode(disbursementDate: string, sameDayIndex: number): string {
  const [y, m, d] = disbursementDate.split("-").map(Number);
  const fyStart = m >= 4 ? y : y - 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fyStart}${pad((fyStart + 1) % 100)}${pad(d)}${pad(m)}${suffixLetters(sameDayIndex)}`;
}

// 0 -> "a", 25 -> "z", 26 -> "aa", …
function suffixLetters(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

// Position of this loan among all loans disbursed on the same date, by creation order.
async function sameDayLoanIndex(supabase: SupabaseClient, loanId: string, disbursementDate: string): Promise<number> {
  const { data, error } = await supabase
    .from("loans")
    .select("id")
    .eq("disbursement_date", disbursementDate)
    .order("created_at")
    .order("id");
  if (error) throw error;
  const index = (data ?? []).findIndex((row) => row.id === loanId);
  return Math.max(index, 0);
}

// Returns the loan's Loan ID, assigning and saving it on first use so it never
// changes afterwards (loans.agreement_loan_id). The letter follows the loan's
// creation order among same-day loans; if that letter is already taken (a
// same-day loan was deleted after IDs were assigned), the first free letter is used.
export async function freezeAgreementLoanId(
  supabase: SupabaseClient,
  loan: { id: string; disbursement_date: string; agreement_loan_id: string | null }
): Promise<string> {
  if (loan.agreement_loan_id) return loan.agreement_loan_id;

  for (let attempt = 0; attempt < 3; attempt++) {
    const prefix = defaultLoanCode(loan.disbursement_date, 0).slice(0, -1);
    const { data: takenRows, error: takenError } = await supabase
      .from("loans")
      .select("agreement_loan_id")
      .like("agreement_loan_id", `${prefix}%`);
    if (takenError) throw takenError;
    const taken = new Set((takenRows ?? []).map((r) => r.agreement_loan_id as string));

    let code = defaultLoanCode(loan.disbursement_date, await sameDayLoanIndex(supabase, loan.id, loan.disbursement_date));
    for (let i = 0; taken.has(code); i++) code = defaultLoanCode(loan.disbursement_date, i);

    // Only fills an empty ID, so whoever saves first wins.
    const { data: saved, error } = await supabase
      .from("loans")
      .update({ agreement_loan_id: code })
      .eq("id", loan.id)
      .is("agreement_loan_id", null)
      .select("agreement_loan_id");
    // 23505: another loan took this ID in the meantime; pick again.
    if (error?.code === "23505") continue;
    if (error) throw error;
    if (saved?.length) return code;

    // Someone else assigned this loan's ID first.
    const { data: current, error: readError } = await supabase
      .from("loans")
      .select("agreement_loan_id")
      .eq("id", loan.id)
      .single();
    if (readError) throw readError;
    if (current?.agreement_loan_id) return current.agreement_loan_id;
  }
  throw new Error("Could not assign a Loan ID. Please try again.");
}

// Corporate details entered on the Loan Agreement tab, stored so they're only
// typed once: registration no. and signatory designation on the borrower (reused
// for its later loans), the resolution reference on the loan.
export interface SavedCorporateDetails {
  registrationNo: string;
  signatoryDesignation: string;
  resolutionRef: string;
}

export async function loadCorporateDetails(
  supabase: SupabaseClient,
  borrowerId: string,
  loanId: string
): Promise<SavedCorporateDetails> {
  const [{ data: b, error: bError }, { data: l, error: lError }] = await Promise.all([
    supabase.from("borrowers").select("registration_no, auth_person_designation").eq("id", borrowerId).single(),
    supabase.from("loans").select("agreement_resolution_ref").eq("id", loanId).single(),
  ]);
  if (bError) throw bError;
  if (lError) throw lError;
  return {
    registrationNo: b?.registration_no ?? "",
    signatoryDesignation: b?.auth_person_designation ?? "",
    resolutionRef: l?.agreement_resolution_ref ?? "",
  };
}

// Saves whichever of the three differ from what's stored.
export async function saveCorporateDetails(
  supabase: SupabaseClient,
  borrowerId: string,
  loanId: string,
  saved: SavedCorporateDetails,
  inputs: AgreementInputs
): Promise<SavedCorporateDetails> {
  const next: SavedCorporateDetails = {
    registrationNo: inputs.cin.trim(),
    signatoryDesignation: inputs.signatoryDesignation.trim(),
    resolutionRef: inputs.boardResolution.trim(),
  };
  if (next.registrationNo !== saved.registrationNo || next.signatoryDesignation !== saved.signatoryDesignation) {
    const { error } = await supabase
      .from("borrowers")
      .update({
        registration_no: next.registrationNo || null,
        auth_person_designation: next.signatoryDesignation || null,
      })
      .eq("id", borrowerId);
    if (error) throw error;
  }
  if (next.resolutionRef !== saved.resolutionRef) {
    const { error } = await supabase
      .from("loans")
      .update({ agreement_resolution_ref: next.resolutionRef || null })
      .eq("id", loanId);
    if (error) throw error;
  }
  return next;
}

// "+" and country code for the agreement; a bare 10-digit number is Indian.
export function agreementMobile(stored: string): string {
  const digits = stored.replace(/\D/g, "");
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

// Rows that don't apply to SFPL's direct lending and are dropped from the document.
const REMOVED_ROWS = new Set([
  "date of birth",
  "occupation / employer or business",
  "disbursement account",
  "repayment / collection account",
  "any insurance premium bundled with the loan (if opted by the borrower)",
  "charges for switching from floating to fixed rate, or vice versa",
  "any other contingent charges",
  // Corporate only
  "financial covenant threshold(s)",
  "change-of-control threshold",
  "cross-default threshold",
  "charges on breach of financial/information covenants (clause 10b)",
]);
const REMOVED_ROW_PREFIXES = [
  "total amount-to-income ratio",
  "total cost of credit to ebitda",
  "in case of lending under a fintech",
];
// Rows deliberately left empty.
const BLANK_ROWS = new Set(["pre-payment charges", "pre-payment / foreclosure charges"]);
// Borrower name, guarantor name and Loan ID stand out wherever they appear
// (the footer signature block bolds the name through its template formatting).
const BOLD_ROWS = new Set([
  "applicant name",
  "date of execution",
  "sanction amount",
  "tenure",
  "loan term",
  "co-applicant / guarantor name (if any)",
  "co-borrower / guarantor (if any)",
  "loan id",
  "loan proposal / account no.",
  "name of borrower company",
  "authorised signatory – name",
  "guarantor(s) name(s) & address",
]);

function sanctionText(loan: AgreementLoan): string {
  return `INR ${inr0.format(loan.loan_amount)} (Rupees ${amountInWords(loan.loan_amount)} only)`;
}

// Schedule 1 of the Individual agreement, plus the guarantor rows it carries.
function individualValues(borrower: BorrowerDetails, inputs: AgreementInputs): RowValues {
  const guarantor = inputs.guarantor.trim() || "N/A";
  const aadhaarLast4 = borrower.aadhaar ? borrower.aadhaar.slice(-4) : null;
  return {
    "applicant name": borrower.legal_name,
    "co-applicant / guarantor name (if any)": guarantor,
    "aadhaar number (last 4 digits only)": aadhaarLast4 ? `XXXX-XXXX-${aadhaarLast4}` : null,
    "pan number": borrower.pan,
    "residential address": borrower.address,
    // Only the agreement shows the "+"; the stored number (used for wa.me links) is unchanged.
    "registered mobile number": borrower.whatsapp_number ? agreementMobile(borrower.whatsapp_number) : null,
    "registered email address": borrower.email,
    "co-borrower / guarantor (if any)": guarantor,
    "purpose of loan": "Personal Loan",
    "type of loan": "Personal Loan",
  };
}

// Schedule 1 of the Corporate agreement. The draft ships with a sample
// company's details, so every row is always written: missing data becomes a
// placeholder that gets highlighted rather than leaving the sample in place.
function corporateValues(borrower: BorrowerDetails, inputs: AgreementInputs): RowValues {
  const signatory = borrower.auth_person_name?.trim() || null;
  const contact = [borrower.email, borrower.whatsapp_number ? agreementMobile(borrower.whatsapp_number) : null]
    .filter(Boolean)
    .join(" / ");
  const board = inputs.boardResolution.trim();
  return {
    "name of borrower company": borrower.legal_name || borrower.name,
    "entity type": entityTypeLabel(borrower.entity_type),
    "cin / llpin": inputs.cin.trim() || "[CIN / LLPIN]",
    "pan number": borrower.pan || "[PAN]",
    "registered office address": borrower.address || "[Registered office address]",
    "authorised signatory – name": signatory ?? "[Authorised signatory name]",
    // Left empty when not given, to be written in by hand.
    "authorised signatory – designation / din": inputs.signatoryDesignation.trim() || BLANK,
    "authorised signatory – email & mobile": contact || "[Email / Mobile]",
    // Left empty when not given, to be written in by hand.
    "board resolution reference & date": board ? `${board} (certified copy at Annexure A)` : BLANK,
    "guarantor(s) name(s) & address": signatory
      ? `${[signatory, borrower.auth_person_address].filter(Boolean).join(", ")} (Deed of Guarantee at Annexure C)`
      : "[Guarantor name and address]",
    "registered email for notices": borrower.email || "[Email]",
    "purpose of loan": "Business Loan",
    "type of loan": "Business Loan",
    "key fact statement": "Annexed as Annexure B and provided to the Borrower before execution",
    "security / guarantee": signatory
      ? `Personal guarantee of ${signatory}, the Borrower's authorised signatory (Deed of Guarantee at Annexure C)`
      : "[Guarantor]",
    "guarantee / security documentation and cersai/registrar filing charges": "At Actuals",
  };
}

// A row value that empties the cell (no placeholder, not reported as missing).
const BLANK = Symbol("blank");

type RowValues = Record<string, string | string[] | typeof BLANK | null | undefined>;

function fillRows(
  doc: Document,
  kind: AgreementKind,
  loan: AgreementLoan,
  borrower: BorrowerDetails,
  facts: LoanFacts,
  inputs: AgreementInputs
) {
  // label (normalised) -> value; null/undefined leaves the placeholder for manual entry.
  const values: RowValues = {
    ...(kind === "INDIVIDUAL" ? individualValues(borrower, inputs) : corporateValues(borrower, inputs)),
    // Schedule 2
    "loan id": inputs.loanCode.trim() || null,
    "date of execution": formatDate(loan.disbursement_date),
    "sanction amount": sanctionText(loan),
    "processing fee": "NIL",
    tenure: facts.tenure || null,
    "disbursement date": formatDate(loan.disbursement_date),
    "maturity / final due date": facts.maturity,
    "rate of interest": facts.rateText,
    "interest payment frequency": facts.interestFrequency,
    "instalment amount": facts.instalmentAmount,
    "instalment start date": facts.instalmentStart,
    "repayment frequency": facts.repaymentFrequency,
    // KFS
    "loan proposal / account no.": inputs.loanCode.trim() || null,
    "documentation / legal charges": "NIL",
    "cheque/mandate bounce charges": "At Actuals",
    "net disbursed amount (sanctioned amount less charges deducted at source, per items 3 and 9(i))": `INR ${inr0.format(loan.loan_amount)}`,
    "sanctioned loan amount (in rupees)": `INR ${inr0.format(loan.loan_amount)}`,
    "disbursal schedule": "100% upfront disbursal to the Borrower's account",
    "loan term": facts.tenure || null,
    "instalment details": facts.instalmentCount
      ? [
          `Type of instalment: ${facts.instalmentType}`,
          `No. of instalments: ${facts.instalmentCount}`,
          `Instalment amount (₹): ${facts.instalmentAmount ?? "—"}`,
          `Commencement of repayment, post sanction: ${facts.instalmentStart ?? "—"}`,
        ]
      : null,
    "interest rate type": "Fixed",
    "rate of interest (%)": facts.rateText,
    "additional information in case of floating rate of interest": [
      "Reference Benchmark: N/A — fixed rate",
      "Spread: N/A",
      "Reset periodicity: N/A",
      "Impact on tenor/instalment of a benchmark change: N/A",
    ],
    "total interest charge during the entire tenor of the loan":
      facts.totalInterest != null ? `INR ${inr0.format(facts.totalInterest)}` : null,
  };

  for (const tr of descendants(doc, "tr")) {
    const lv = labelAndValueCells(tr);
    if (!lv) continue;
    const key = normaliseLabel(lv.label);
    if (REMOVED_ROWS.has(key) || REMOVED_ROW_PREFIXES.some((p) => key.startsWith(p))) {
      tr.parentNode?.removeChild(tr);
      continue;
    }
    if (BLANK_ROWS.has(key)) {
      setCellText(lv.value, "");
      continue;
    }
    // Schedule 2, KFS Table A and contingent charges all word the penal rate as "[●]% per month ...".
    if (key.startsWith("penal charges")) {
      const rate = inputs.penalRate.trim();
      if (rate) setCellText(lv.value, textOf(lv.value).replace(/\[●\]/g, rate));
      continue;
    }
    // "Total amount to be paid by the Borrower over the loan term (...)" has a long label.
    if (key.startsWith("total amount to be paid by the borrower") && facts.totalRepayable != null) {
      setCellText(lv.value, `INR ${inr0.format(facts.totalRepayable)}`);
      continue;
    }
    if (!(key in values)) continue;
    const value = values[key];
    if (value == null || value === "") continue;
    if (value === BLANK) {
      setCellText(lv.value, "");
      continue;
    }
    setCellText(lv.value, value);
    if (BOLD_ROWS.has(key)) descendants(lv.value, "r").forEach(makeBold);
  }
}

// Drops the KFS sections that don't apply to direct Individual lending and
// renumbers what's left so the KFS items stay consecutive.
function trimKfs(doc: Document) {
  const body = descendants(doc, "body")[0];
  if (!body) return;
  const blocks = Array.from(body.childNodes).filter((n): n is Element => n.nodeType === 1);
  let removing = false;
  for (const el of blocks) {
    const text = el.localName === "p" ? textOf(el).trim() : "";
    // Item 10 (APR) is a heading followed by one paragraph.
    if (text === "10. Annual Percentage Rate (APR) (%)" || text.startsWith("[●]% per annum — the APR includes")) {
      body.removeChild(el);
      continue;
    }
    if (text === "11. Details of contingent charges") setParagraphText(el, ["10. Details of contingent charges"]);
    // Part 2 (and, in the Individual template, the APR annexure after it) runs
    // up to the repayment schedule annexure or the page break before it.
    if (text.startsWith("Part 2 — Other Qualitative Information")) removing = true;
    if (
      removing &&
      (descendants(el, "br").some((br) => br.getAttributeNS(W, "type") === "page") ||
        text.includes("Illustrative Repayment / Amortisation Schedule"))
    ) {
      removing = false;
    }
    if (removing) body.removeChild(el);
  }

  // Items 12–17 lost 15 and 17, and 10 is gone above: 12,13,14,16 -> 11,12,13,14.
  const renumber: Record<string, string> = { "12": "11", "13": "12", "14": "13", "16": "14" };
  const summary = descendants(doc, "tbl").find((tbl) =>
    children(tbl, "tr").some((tr) => normaliseLabel(labelAndValueCells(tr)?.label ?? "").startsWith("net disbursed amount"))
  );
  if (!summary) return;
  for (const tr of children(summary, "tr")) {
    const cells = cellsOf(tr);
    const next = renumber[textOf(cells[0]).trim()];
    if (!next) continue;
    setCellText(cells[0], next);
    const label = textOf(cells[1]);
    if (label.includes("per items 3 and 14")) setCellText(cells[1], label.replace("per items 3 and 14", "per items 3 and 13"));
  }
}

// <w:pageBreakBefore> must follow <w:pStyle>/<w:keepNext>/<w:keepLines> in <w:pPr>.
function startOnNewPage(p: Element) {
  const doc = p.ownerDocument;
  let pPr = children(p, "pPr")[0];
  if (!pPr) {
    pPr = doc.createElementNS(W, "w:pPr");
    p.insertBefore(pPr, p.firstChild);
  }
  if (children(pPr, "pageBreakBefore").length) return;
  const before = Array.from(pPr.childNodes).find(
    (n) => n.nodeType === 1 && !["pStyle", "keepNext", "keepLines"].includes((n as Element).localName)
  );
  pPr.insertBefore(doc.createElementNS(W, "w:pageBreakBefore"), before ?? null);
}

// The template's headings (clause titles, sub-headings, KFS items) are short
// paragraphs set entirely in bold.
function isHeading(p: Element): boolean {
  const text = textOf(p).trim();
  if (!text || text.length > 100) return false;
  const runs = descendants(p, "r").filter((r) => textOf(r).trim());
  return runs.every((r) => {
    const b = children(children(r, "rPr")[0] ?? r, "b")[0];
    return b != null && !["0", "false"].includes(b.getAttributeNS(W, "val") ?? "");
  });
}

// Keeps a heading on the same page as the paragraph after it, so a heading
// never sits alone at the bottom of a page. <w:keepNext> follows <w:pStyle>.
function keepWithNext(p: Element) {
  const doc = p.ownerDocument;
  let pPr = children(p, "pPr")[0];
  if (!pPr) {
    pPr = doc.createElementNS(W, "w:pPr");
    p.insertBefore(pPr, p.firstChild);
  }
  if (children(pPr, "keepNext").length) return;
  const before = Array.from(pPr.childNodes).find((n) => n.nodeType === 1 && (n as Element).localName !== "pStyle");
  pPr.insertBefore(doc.createElementNS(W, "w:keepNext"), before ?? null);
}

function isEmptyParagraph(el: Element): boolean {
  return (
    el.localName === "p" &&
    !textOf(el).trim() &&
    !["drawing", "pict", "object", "br", "sectPr"].some((tag) => descendants(el, tag).length)
  );
}

function blockElements(body: Element): Element[] {
  return Array.from(body.childNodes).filter((n): n is Element => n.nodeType === 1);
}

function nextElement(el: Element): Element | null {
  let n = el.nextSibling;
  while (n && n.nodeType !== 1) n = n.nextSibling;
  return n as Element | null;
}

function isPageBreakParagraph(el: Element | null): boolean {
  return (
    el?.localName === "p" &&
    !textOf(el).trim() &&
    descendants(el, "br").some((br) => br.getAttributeNS(W, "type") === "page")
  );
}

function previousElement(el: Element): Element | null {
  let n = el.previousSibling;
  while (n && n.nodeType !== 1) n = n.previousSibling;
  return n as Element | null;
}

// Headings that open on a fresh page, unless a page break already precedes them.
const NEW_PAGE_HEADINGS = [/^SCHEDULE 1 – /, /^ANNEXURE [A-C]$/, /^Annexure A to KFS — Illustrative/];

function adjustLayout(doc: Document, kind: AgreementKind) {
  const body = descendants(doc, "body")[0];
  if (!body) return;

  if (kind === "CORPORATE") {
    for (const el of blockElements(body)) {
      if (el.localName !== "p") continue;
      const text = textOf(el).trim();
      // The draft's body calls the board resolution Annexure A, the KFS
      // Annexure B and the Deed of Guarantee Annexure C; its headings were
      // lettered one behind. Relabel the headings to match the body.
      if (text === "ANNEXURE B") setParagraphText(el, ["ANNEXURE C"]);
      if (text === "ANNEXURE A") setParagraphText(el, ["ANNEXURE B"]);
      // The Deed's execution block (guarantor's signature/date lines, witnesses
      // and SFPL's acceptance) is covered by the footer signatures on every
      // page. Keep "SIGNED AND DELIVERED by the Guarantor" and its Name line;
      // drop the rest up to the page break before the Promissory Note.
      if (text === "SIGNED AND DELIVERED by the Guarantor") {
        let next = nextElement(el);
        while (next && next.localName === "p" && !/^Name:/.test(textOf(next).trim())) next = nextElement(next);
        let drop = next ? nextElement(next) : null;
        while (drop && drop.localName === "p" && !isPageBreakParagraph(drop) && !textOf(drop).trim().startsWith("II. ")) {
          const after = nextElement(drop);
          body.removeChild(drop);
          drop = after;
        }
      }
      if (text.startsWith("(Affix Revenue Stamp")) {
        body.removeChild(el);
        continue;
      }
      // The Deed's title page break would leave "ANNEXURE C" alone on a page.
      if (text.startsWith("DEED OF GUARANTEE, AND SECURITY DOCUMENT TEMPLATES")) {
        const next = nextElement(el);
        if (next && isPageBreakParagraph(next)) body.removeChild(next);
      }
    }
  }

  // Every page's footer carries the signature block, so the separate
  // SIGNATURES page (its page break, heading and table) goes.
  for (const el of blockElements(body)) {
    if (el.localName !== "p" || textOf(el).trim() !== "SIGNATURES") continue;
    const prev = el.previousSibling as Element | null;
    if (prev?.localName === "p" && !textOf(prev).trim() && descendants(prev, "br").length) body.removeChild(prev);
    const table = nextElement(el);
    if (table?.localName === "tbl") {
      // Corporate: the guarantor's signing line follows the table.
      let after = nextElement(table);
      while (after && isEmptyParagraph(after)) after = nextElement(after);
      if (after?.localName === "p" && textOf(after).trim().startsWith("For and on behalf of / by the Guarantor")) {
        body.removeChild(after);
      }
      body.removeChild(table);
    }
    body.removeChild(el);
  }

  // The template has stray blank paragraphs that show up as extra line gaps;
  // headings already carry their own spacing. A blank paragraph between two
  // tables stays, or Word would merge the tables.
  for (const el of blockElements(body)) {
    if (isEmptyParagraph(el) && nextElement(el)?.localName === "p") body.removeChild(el);
  }

  for (const el of blockElements(body)) {
    if (el.localName !== "p") continue;
    const text = textOf(el).trim();
    if (NEW_PAGE_HEADINGS.some((re) => re.test(text)) && !isPageBreakParagraph(previousElement(el))) {
      startOnNewPage(el);
    }
    // A short caption right above a table (e.g. "(i) Payable to SFPL — Table A")
    // stays with the table just like a heading.
    const captionsTable = text.length > 0 && text.length <= 120 && nextElement(el)?.localName === "tbl";
    if (isHeading(el) || captionsTable) keepWithNext(el);
    // Individual: with the APR annexure removed, the repayment schedule becomes Annexure A.
    if (kind === "INDIVIDUAL" && text.startsWith("Annexure B to KFS")) {
      for (const t of descendants(el, "t")) {
        if (t.textContent?.includes("Annexure B to KFS")) t.textContent = t.textContent.replace("Annexure B to KFS", "Annexure A to KFS");
      }
    }
  }
}

// Replaces the first match of `pattern` in a paragraph's text, even when the
// match spans several runs. The replacement takes the formatting of the run
// where the match starts; the other runs keep theirs. Returns false if no match.
function replaceInParagraph(p: Element, pattern: RegExp | string, replacement: string): boolean {
  const nodes = descendants(p, "t");
  const full = nodes.map((t) => t.textContent ?? "").join("");
  let start: number;
  let end: number;
  if (typeof pattern === "string") {
    start = full.indexOf(pattern);
    end = start + pattern.length;
  } else {
    const m = pattern.exec(full);
    start = m ? m.index : -1;
    end = m ? m.index + m[0].length : -1;
  }
  if (start < 0) return false;

  let offset = 0;
  let placed = false;
  for (const t of nodes) {
    const text = t.textContent ?? "";
    const from = offset;
    const to = offset + text.length;
    offset = to;
    if (to <= start || from >= end) continue;
    const keepBefore = text.slice(0, Math.max(0, start - from));
    const keepAfter = text.slice(Math.max(0, end - from));
    t.textContent = keepBefore + (placed ? "" : replacement) + keepAfter;
    t.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
    placed = true;
  }
  return true;
}

function replaceAllInParagraph(p: Element, pattern: string, replacement: string) {
  for (let i = 0; i < 20 && replaceInParagraph(p, pattern, replacement); i++);
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

// Short rate for the Promissory Note, e.g. "18% per annum" or "2% per month".
function shortRate(loan: AgreementLoan): string | null {
  if (loan.loan_type === "ON_CALL") return loan.oncall_annual_rate != null ? `${loan.oncall_annual_rate}% per annum` : null;
  if (loan.emi_interest_rate == null) return null;
  return `${loan.emi_interest_rate}% ${loan.emi_interest_method === "LUMPSUM_ADVANCE" ? "per month" : "per annum"}`;
}

// Elements that follow <w:spacing> in <w:pPr>.
const AFTER_SPACING = [
  "ind", "contextualSpacing", "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment",
  "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange",
];

// Sets the space above a paragraph, in twips (720 = half an inch, about two lines).
function setSpacingBefore(p: Element, twips: number) {
  const doc = p.ownerDocument;
  let pPr = children(p, "pPr")[0];
  if (!pPr) {
    pPr = doc.createElementNS(W, "w:pPr");
    p.insertBefore(pPr, p.firstChild);
  }
  let spacing = children(pPr, "spacing")[0];
  if (!spacing) {
    spacing = doc.createElementNS(W, "w:spacing");
    const before = Array.from(pPr.childNodes).find((n) => n.nodeType === 1 && AFTER_SPACING.includes((n as Element).localName));
    pPr.insertBefore(spacing, before ?? null);
  }
  spacing.setAttributeNS(W, "w:before", String(twips));
}

// Replaces a paragraph with "<label><value>", the value in bold.
function setLabelledBold(p: Element, label: string, value: string) {
  setParagraphText(p, [label]);
  const labelRun = descendants(p, "r")[0];
  const valueRun = labelRun.cloneNode(true) as Element;
  descendants(valueRun, "t")[0].textContent = value;
  makeBold(valueRun);
  p.appendChild(valueRun);
}

// How the Borrower is constituted, replacing the draft's Companies Act wording.
// "Others" keeps the draft's company wording.
const CONSTITUTION: Record<string, string> = {
  COMPANY: "a company incorporated under the Companies Act, 2013",
  LLP: "a limited liability partnership incorporated under the Limited Liability Partnership Act, 2008",
  PARTNERSHIP: "a partnership firm registered under the Indian Partnership Act, 1932",
};

// The Corporate draft is written for companies. For LLPs and partnership firms,
// company-only terms (board, shareholders, directors, CIN/DIN, registered
// office for firms) are reworded. Each pair is [draft wording, replacement];
// the draft uses both straight and curly apostrophes, so both are listed.
const ENTITY_WORDING: Record<string, [string, string][]> = {
  LLP: [
    ["The Company named and described in Schedule 1", "The limited liability partnership named and described in Schedule 1"],
    ['or the "Company")', 'or the "LLP")'],
    ["a promoter/director of the Company", "a designated partner of the LLP"],
    ["a promoter/director of the Borrower", "a designated partner of the Borrower"],
    [
      "passed a resolution of its Board of Directors (and, where required under the Companies Act, 2013, a resolution of its shareholders)",
      "passed a resolution of its designated partners (and, where required under its LLP agreement, of all its partners)",
    ],
    ["the Borrower’s board resolution", "a resolution of the Borrower’s partners"],
    ["the Borrower's board resolution", "a resolution of the Borrower's partners"],
    [
      "the board resolution (and shareholders' resolution, where applicable under Sections 179/180 of the Companies Act, 2013)",
      "the resolution of the Borrower's partners, as required under its LLP agreement,",
    ],
    [
      "certificate of incorporation, Memorandum and Articles of Association, and a list of directors with DIN",
      "certificate of incorporation, LLP agreement, and a list of designated partners with DPIN",
    ],
    [
      "it is a company duly incorporated under the Companies Act, 2013",
      "it is a limited liability partnership duly incorporated under the Limited Liability Partnership Act, 2008",
    ],
    ["shareholding, directorship and management-control pattern", "partnership interest, designated partners and management-control pattern"],
    ["control or shareholding pattern", "control or partnership interest"],
    ["promoter(s)/director(s) named in Schedule 1", "designated partner(s) named in Schedule 1"],
    // Schedule 1 labels
    ["Name of Borrower Company", "Name of Borrower LLP"],
    ["CIN / LLPIN", "LLPIN"],
    ["Designation / DIN", "Designation / DPIN"],
    ["Board Resolution Reference", "Partners' Resolution Reference"],
  ],
  PARTNERSHIP: [
    ["The Company named and described in Schedule 1", "The partnership firm named and described in Schedule 1"],
    ['or the "Company")', 'or the "Firm")'],
    ["a promoter/director of the Company", "a partner of the Firm"],
    ["a promoter/director of the Borrower", "a partner of the Borrower"],
    [
      "passed a resolution of its Board of Directors (and, where required under the Companies Act, 2013, a resolution of its shareholders)",
      "obtained the written consent of all its partners",
    ],
    ["the Borrower’s board resolution", "the written consent of the Borrower’s partners"],
    ["the Borrower's board resolution", "the written consent of the Borrower's partners"],
    [
      "the board resolution (and shareholders' resolution, where applicable under Sections 179/180 of the Companies Act, 2013)",
      "the written consent of all partners of the Borrower",
    ],
    [
      "certificate of incorporation, Memorandum and Articles of Association, and a list of directors with DIN",
      "certificate of registration of the firm, partnership deed, and a list of partners",
    ],
    [
      "it is a company duly incorporated under the Companies Act, 2013",
      "it is a partnership firm duly registered under the Indian Partnership Act, 1932",
    ],
    ["all corporate action required", "all action required"],
    ["No corporate action,", "No action,"],
    ["duly incorporated, validly existing", "duly constituted and registered, validly existing"],
    ["full corporate power and authority", "full power and authority"],
    ["shareholding, directorship and management-control pattern", "partnership interest, partners and management-control pattern"],
    ["control or shareholding pattern", "control or partnership interest"],
    ["promoter(s)/director(s) named in Schedule 1", "partner(s) named in Schedule 1"],
    // A firm has a principal place of business, not a registered office.
    ["its registered office or principal place of business", "its principal place of business"],
    ["its registered office, place of business", "its principal place of business"],
    ["place of business/registered office", "place of business"],
    ["at the registered office/email", "at the principal place of business/email"],
    // Schedule 1 labels
    ["Name of Borrower Company", "Name of Borrower Firm"],
    ["CIN / LLPIN", "Firm Registration No."],
    ["Registered Office Address", "Principal Place of Business"],
    ["Designation / DIN", "Designation"],
    ["Board Resolution Reference", "Partners' Consent Reference"],
  ],
};

function applyEntityWording(doc: Document, entityType: string) {
  const pairs = ENTITY_WORDING[entityType];
  if (!pairs) return;
  for (const p of descendants(doc, "p")) {
    for (const [from, to] of pairs) replaceAllInParagraph(p, from, to);
  }
}

// Corporate: the Guarantor party in the preamble, the Deed of Guarantee and
// the Demand Promissory Note are running text rather than table rows. The
// guarantor is the Borrower's authorised signatory.
function fillCorporateParagraphs(
  doc: Document,
  loan: AgreementLoan,
  borrower: BorrowerDetails,
  inputs: AgreementInputs
) {
  const body = descendants(doc, "body")[0];
  if (!body) return;
  const company = borrower.legal_name || borrower.name;
  const signatory = borrower.auth_person_name?.trim() || null;
  const signatoryAddress = borrower.auth_person_address?.trim() || null;
  const executed = formatDate(loan.disbursement_date);
  const [y, m, d] = loan.disbursement_date.split("-").map(Number);
  const month = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long" });
  const amount = inr0.format(loan.loan_amount);
  const rate = shortRate(loan);

  let inGuarantorSignature = false;
  for (const p of blockElements(body)) {
    if (p.localName !== "p") continue;
    const text = textOf(p).trim();

    // Preamble: the Guarantor as the third party.
    if (text.startsWith("M/s [Guarantor Name]")) {
      if (signatory) replaceInParagraph(p, "M/s [Guarantor Name]", signatory);
      replaceInParagraph(
        p,
        "[an individual promoter/director of the Company residing at ●] [/ a company having its registered office at ●]",
        `the authorised signatory and a promoter/director of the Company, residing at ${signatoryAddress ?? "●"}`
      );
    }

    // Deed of Guarantee.
    if (text.startsWith("THIS DEED OF GUARANTEE")) {
      replaceInParagraph(
        p,
        "at [Place] on this [●] day of [Month], [Year]",
        `at ${PLACE_OF_EXECUTION} on this ${ordinal(d)} day of ${month}, ${y}`
      );
    }
    if (text.startsWith("[Name of Guarantor]") && signatory) {
      replaceInParagraph(
        p,
        /^\[Name of Guarantor\][\s\S]*?having its registered office at \[●\]\]/,
        `${signatory}, residing at ${signatoryAddress ?? "●"}`
      );
    }
    if (text.startsWith("C. The Guarantor, being")) {
      replaceInParagraph(
        p,
        "[a promoter/director of the Borrower] [/ a Group Company of the Borrower]",
        "the authorised signatory and a promoter/director of the Borrower"
      );
    }
    // Limit of liability: the guarantee is unlimited.
    if (text === "[Select and complete the applicable option:]" || text.startsWith("(b) Limited:")) {
      body.removeChild(p);
      continue;
    }
    if (text.startsWith("(a) Unlimited:")) replaceInParagraph(p, "(a) Unlimited: ", "");
    if (text.startsWith("The Guarantor represents and warrants")) {
      replaceInParagraph(p, / \[and, if a corporate Guarantor:[^\]]*\]/, "");
    }
    if (text === "SIGNED AND DELIVERED by the Guarantor") inGuarantorSignature = true;
    if (inGuarantorSignature && /^Name:\s*_+$/.test(text)) {
      if (signatory) setLabelledBold(p, "Name: ", signatory);
      inGuarantorSignature = false;
    }

    // Demand Promissory Note.
    if (text.startsWith("INR [Sanction Amount]")) {
      replaceInParagraph(p, "[Sanction Amount]", amount);
      replaceInParagraph(p, "[Place]: [●]", `Place: ${PLACE_OF_EXECUTION}`);
    }
    if (text === "Date: [●]") replaceInParagraph(p, "[●]", executed);
    if (text.startsWith("ON DEMAND")) {
      replaceInParagraph(p, "registered office at [●]", `registered office at ${borrower.address || "●"}`);
      replaceInParagraph(p, "(Rupees [amount in words] only)", `(Rupees ${amountInWords(loan.loan_amount)} only)`);
      if (rate) replaceInParagraph(p, "[●]% per annum", rate);
    }
    // Room to sign above the Note's signature line (the blank lines the draft
    // had there are removed with the other stray blank paragraphs).
    if (/^_{5,}$/.test(text)) setSpacingBefore(p, 720);
    if (text === "Name: [Authorised Signatory]" && signatory) setLabelledBold(p, "Name: ", signatory);
    // Blank when not given, to be written in by hand.
    if (text === "Designation: [●]") replaceInParagraph(p, "[●]", inputs.signatoryDesignation.trim());

    // Tokens shared by the Deed and the Note.
    replaceAllInParagraph(p, "[Borrower's name]", company);
    replaceAllInParagraph(p, "INR [Sanction Amount]", `INR ${amount}`);
    replaceAllInParagraph(p, "Loan Agreement dated [●]", `Loan Agreement dated ${executed}`);

    // The Borrower's constitution, only in the two paragraphs describing the
    // Borrower (the preamble party and the Promissory Note); the Deed also
    // describes SFPL as a company, which must stay. Done last, as the fills
    // above look for the draft's wording. A partnership firm has a principal
    // place of business rather than a registered office.
    const constitution = CONSTITUTION[borrower.entity_type];
    const describesBorrower = text.startsWith("The Company named and described") || text.startsWith("ON DEMAND");
    if (constitution && describesBorrower) {
      const withOldAct = replaceInParagraph(
        p,
        "a company incorporated under the Companies Act, 2013 (or the Companies Act, 1956, as applicable)",
        constitution
      );
      if (!withOldAct) replaceInParagraph(p, "a company incorporated under the Companies Act, 2013", constitution);
      if (borrower.entity_type === "PARTNERSHIP") {
        replaceInParagraph(p, "having its registered office", "having its principal place of business");
      }
    }
  }
}

function isBoldRun(run: Element): boolean {
  const b = children(children(run, "rPr")[0] ?? run, "b")[0];
  return b != null && !["0", "false"].includes(b.getAttributeNS(W, "val") ?? "");
}

// Bolds every occurrence of `needle` in a paragraph by splitting the run that
// holds it into before / name / after runs with the same formatting. Only
// plain runs (formatting + one text node) are split.
function boldInParagraph(p: Element, needle: string) {
  if (!needle) return;
  for (let pass = 0; pass < 20; pass++) {
    const t = descendants(p, "t").find((node) => {
      const run = node.parentNode as Element | null;
      return run?.localName === "r" && !isBoldRun(run) && (node.textContent ?? "").includes(needle);
    });
    if (!t) return;
    const run = t.parentNode as Element;
    const content = Array.from(run.childNodes).filter((n): n is Element => n.nodeType === 1);
    if (content.some((n) => n.localName !== "rPr" && n !== t)) return;
    const text = t.textContent ?? "";
    const at = text.indexOf(needle);
    const piece = (s: string, bold: boolean) => {
      const r = run.cloneNode(true) as Element;
      const rt = descendants(r, "t")[0];
      rt.textContent = s;
      rt.setAttributeNS("http://www.w3.org/XML/1998/namespace", "xml:space", "preserve");
      if (bold) makeBold(r);
      return r;
    };
    const parent = run.parentNode as Element;
    if (at > 0) parent.insertBefore(piece(text.slice(0, at), false), run);
    parent.insertBefore(piece(needle, true), run);
    const rest = text.slice(at + needle.length);
    if (rest) parent.insertBefore(piece(rest, false), run);
    parent.removeChild(run);
  }
}

// Corporate: in the Deed of Guarantee and Promissory Note (Annexure C), the
// Lender, Borrower and Guarantor names stand out in bold.
function boldPartyNames(doc: Document, borrower: BorrowerDetails) {
  const body = descendants(doc, "body")[0];
  if (!body) return;
  const names = [
    "Singhvi Fintech Private Limited",
    borrower.legal_name || borrower.name,
    borrower.auth_person_name?.trim() ?? "",
  ].filter(Boolean);
  let inAnnexureC = false;
  for (const el of blockElements(body)) {
    if (el.localName === "p" && textOf(el).trim() === "ANNEXURE C") inAnnexureC = true;
    if (!inAnnexureC) continue;
    for (const p of el.localName === "p" ? [el] : descendants(el, "p")) {
      for (const name of names) boldInParagraph(p, name);
      // The Deed's opening line names the instrument in bold.
      if (textOf(p).trim().startsWith("THIS DEED OF GUARANTEE")) boldInParagraph(p, "DEED OF GUARANTEE");
    }
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The footer (word/footer1.xml) holds the per-page signature block with
// {{BORROWER_NAME}} (and, in the Corporate template, {{SIGNATORY_NAME}})
// placeholders under the Borrower's signing line.
async function fillFooterSignature(zip: JSZip, borrower: BorrowerDetails) {
  const footer = zip.file("word/footer1.xml");
  if (!footer) return;
  const xml = await footer.async("string");
  zip.file(
    "word/footer1.xml",
    xml
      .replace("{{BORROWER_NAME}}", escapeXml(borrower.legal_name || borrower.name))
      .replace("{{SIGNATORY_NAME}}", escapeXml(borrower.auth_person_name?.trim() || "Authorised Signatory"))
  );
}

// <w:b> must follow <w:rStyle>/<w:rFonts> and precede everything else in <w:rPr>.
function makeBold(run: Element) {
  const doc = run.ownerDocument;
  let rPr = children(run, "rPr")[0];
  if (!rPr) {
    rPr = doc.createElementNS(W, "w:rPr");
    run.insertBefore(rPr, run.firstChild);
  }
  for (const el of [...children(rPr, "b"), ...children(rPr, "bCs")]) rPr.removeChild(el);
  const before = Array.from(rPr.childNodes).find(
    (n) => n.nodeType === 1 && !["rStyle", "rFonts"].includes((n as Element).localName)
  );
  const b = doc.createElementNS(W, "w:b");
  const bCs = doc.createElementNS(W, "w:bCs");
  rPr.insertBefore(b, before ?? null);
  rPr.insertBefore(bCs, before ?? null);
}

function fillRepaymentSchedule(doc: Document, loan: AgreementLoan, installments: AgreementInstallment[]) {
  if (loan.loan_type !== "EMI" || !installments.length) return;
  const table = descendants(doc, "tbl").find((tbl) => {
    const first = children(tbl, "tr")[0];
    return first && textOf(cellsOf(first)[0] ?? first).trim() === "Instalment No.";
  });
  if (!table) return;
  const rows = children(table, "tr");
  const templateRow = rows[1];
  if (!templateRow || cellsOf(templateRow).length < 7) return;

  let opening = Number(loan.loan_amount);
  for (const inst of installments) {
    const principal = Number(inst.principal_due);
    const interest = Number(inst.interest_due);
    const closing = round2(opening - principal);
    const row = templateRow.cloneNode(true) as Element;
    const cells = cellsOf(row);
    const label = isUpfrontInterestRow(inst, loan.emi_interest_method) ? `${inst.installment_number} (Adv. interest)` : String(inst.installment_number);
    [
      label,
      formatDate(inst.due_date),
      inr0.format(opening),
      inr0.format(principal),
      inr0.format(interest),
      inr0.format(round2(principal + interest)),
      inr0.format(closing),
    ].forEach((v, i) => setCellText(cells[i], v));
    table.insertBefore(row, templateRow);
    opening = closing;
  }
  rows.slice(1).forEach((r) => table.removeChild(r));
  setColumnWidths(table, SCHEDULE_COLUMN_WIDTHS);
  // The narrowed first column would otherwise break "Instalment" mid-word.
  setCellText(cellsOf(rows[0])[0], "Inst. No.");
}

// Twips, summing to the A4 text width (11907 − 2 × 1418). Word's auto-fit
// otherwise squeezes Due Date onto two lines.
const SCHEDULE_COLUMN_WIDTHS = [760, 1300, 1500, 1380, 1190, 1380, 1561];

function setColumnWidths(table: Element, widths: number[]) {
  const doc = table.ownerDocument;
  const tblPr = children(table, "tblPr")[0];
  if (tblPr) {
    const tblW = children(tblPr, "tblW")[0];
    if (tblW) {
      tblW.setAttributeNS(W, "w:w", String(widths.reduce((a, b) => a + b, 0)));
      tblW.setAttributeNS(W, "w:type", "dxa");
    }
    if (!children(tblPr, "tblLayout").length) {
      const layout = doc.createElementNS(W, "w:tblLayout");
      layout.setAttributeNS(W, "w:type", "fixed");
      // <w:tblLayout> precedes <w:tblCellMar> and <w:tblLook> in <w:tblPr>.
      const before = children(tblPr, "tblCellMar")[0] ?? children(tblPr, "tblLook")[0] ?? null;
      tblPr.insertBefore(layout, before);
    }
  }
  children(children(table, "tblGrid")[0] ?? table, "gridCol").forEach((col, i) => {
    if (widths[i] != null) col.setAttributeNS(W, "w:w", String(widths[i]));
  });
  for (const tr of children(table, "tr")) {
    cellsOf(tr).forEach((tc, i) => {
      const tcW = children(children(tc, "tcPr")[0] ?? tc, "tcW")[0];
      if (!tcW || widths[i] == null) return;
      tcW.setAttributeNS(W, "w:w", String(widths[i]));
      tcW.setAttributeNS(W, "w:type", "dxa");
    });
  }
}

// Highlights every placeholder left in the document and returns where they are.
function highlightRemaining(doc: Document): MissingItem[] {
  const missing: MissingItem[] = [];
  const seen = new Set<string>();
  const add = (section: string, field: string) => {
    const key = `${section}|${field}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    missing.push({ section, field });
  };

  let section = "Agreement";
  const body = descendants(doc, "body")[0];
  const walk = (el: Element) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      if (child.localName === "p") {
        const text = textOf(child).trim();
        if (/^(SCHEDULE \d|ANNEXURE|Annexure [A-C]|Part \d|KEY FACT STATEMENT|I+\. [A-Z]|\d+\.\s|\(i+\) Payable)/.test(text)) {
          section = text.length > 70 ? `${text.slice(0, 67)}…` : text;
        }
        if (PLACEHOLDER.test(text) && !text.includes(NOT_A_PLACEHOLDER)) {
          markRuns(child);
          add(section, text.length > 80 ? `${text.slice(0, 77)}…` : text);
        }
      } else if (child.localName === "tbl") {
        for (const tr of children(child, "tr")) {
          const rowText = textOf(tr);
          if (!PLACEHOLDER.test(rowText)) continue;
          markRuns(tr);
          const cells = cellsOf(tr);
          const lv = labelAndValueCells(tr);
          const label = lv?.label ?? "";
          if (lv === null || cells.length > 4) {
            add(section, "Repayment schedule rows");
            continue;
          }
          // KFS rows carry a serial ("12", "ii") that the user can match to the document.
          const serial = cells.length >= 3 ? textOf(cells[0]).trim() : "";
          const field = label || rowText.trim().slice(0, 60);
          add(section, serial && serial.length <= 4 ? `${serial}. ${field}` : field);
        }
      } else if (child.localName === "sdt" || child.localName === "sdtContent") {
        walk(child);
      }
    }
  };
  if (body) walk(body);
  return missing;
}

function markRuns(el: Element) {
  for (const run of descendants(el, "r")) {
    if (/[[\]●]/.test(textOf(run))) highlightRun(run);
  }
}

// The template's header (word/header1.xml) holds only the full-page letterhead
// image. Emptying it drops the letterhead while the section keeps its margins,
// so both versions paginate identically.
const EMPTY_HEADER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="${W}"><w:p/></w:hdr>`;

function removeLetterhead(zip: JSZip) {
  zip.file("word/header1.xml", EMPTY_HEADER);
  zip.remove("word/_rels/header1.xml.rels");
  zip.remove("word/media/letterhead.png");
}

// ---------------------------------------------------------------------------

export async function generateLoanAgreement(
  supabase: SupabaseClient,
  loanId: string,
  inputs: AgreementInputs,
  { letterhead }: { letterhead: boolean }
): Promise<AgreementResult> {
  const { data: loanData, error } = await supabase
    .from("loans")
    .select(
      "id, disbursement_date, loan_amount, loan_type, emi_interest_method, emi_principal_method, emi_interest_rate, emi_tenure_months, oncall_annual_rate, borrowers(id, name, legal_name, whatsapp_number, email, address, pan, entity_type, aadhaar, auth_person_name, auth_person_pan, auth_person_aadhaar, auth_person_address)"
    )
    .eq("id", loanId)
    .single();
  if (error || !loanData) return { ok: false, error: error?.message ?? "Loan not found." };
  const loan = loanData as unknown as AgreementLoan;
  const borrower = loan.borrowers;
  if (!borrower) return { ok: false, error: "This loan has no borrower." };
  const kind = agreementKind(borrower.entity_type);

  let installments: AgreementInstallment[] = [];
  if (loan.loan_type === "EMI") {
    const { data: inst } = await supabase
      .from("emi_installments")
      .select("installment_number, due_date, interest_due, principal_due")
      .eq("loan_id", loanId)
      .order("installment_number");
    installments = (inst as AgreementInstallment[]) ?? [];
  }

  const res = await fetch(TEMPLATE_URLS[kind]);
  if (!res.ok) return { ok: false, error: "Could not load the Loan Agreement template." };
  const zip = await JSZip.loadAsync(await res.arrayBuffer());
  const docFile = zip.file("word/document.xml");
  if (!docFile) return { ok: false, error: "The Loan Agreement template is not a valid Word document." };

  const xml = await docFile.async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    return { ok: false, error: "Could not read the Loan Agreement template." };
  }

  const facts = loanFacts(loan, installments);
  fillRows(doc, kind, loan, borrower, facts, inputs);
  if (kind === "CORPORATE") {
    fillCorporateParagraphs(doc, loan, borrower, inputs);
    // After the fills, which match rows and text by the draft's company wording.
    applyEntityWording(doc, borrower.entity_type);
  }
  trimKfs(doc);
  adjustLayout(doc, kind);
  // After adjustLayout, which gives the Deed's annexure its "ANNEXURE C" heading.
  if (kind === "CORPORATE") boldPartyNames(doc, borrower);
  fillRepaymentSchedule(doc, loan, installments);
  const missing = highlightRemaining(doc);

  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith("<?xml")) out = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n${out}`;
  zip.file("word/document.xml", out);
  await fillFooterSignature(zip, borrower);
  if (!letterhead) removeLetterhead(zip);

  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
  // Characters Windows forbids in file names are dropped from a hand-edited Loan ID.
  const safeCode = inputs.loanCode.trim().replace(/[\\/:*?"<>|]+/g, "");
  const fileName = `Loan Agreement - ${safeCode || "Loan"}${letterhead ? "" : " - Without Letterhead"}.docx`;
  return { ok: true, blob, fileName, missing };
}

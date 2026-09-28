import type { SupabaseClient } from "@supabase/supabase-js";

export interface Borrower {
  id: string;
  name: string;
  whatsapp_number: string;
}

export const ENTITY_TYPES = [
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "COMPANY", label: "Company" },
  { value: "LLP", label: "LLP" },
  { value: "PARTNERSHIP", label: "Partnership" },
  { value: "OTHERS", label: "Others" },
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number]["value"];

export function entityTypeLabel(value: string): string {
  return ENTITY_TYPES.find((t) => t.value === value)?.label ?? value;
}

// Full KYC record, used by the Manage Borrowers page. `name` is the short name
// shown everywhere in the app; `legal_name` is kept for reference only.
export interface BorrowerDetails extends Borrower {
  legal_name: string | null;
  email: string | null;
  address: string | null;
  pan: string | null;
  entity_type: EntityType;
  aadhaar: string | null;
  auth_person_name: string | null;
  auth_person_pan: string | null;
  auth_person_aadhaar: string | null;
  auth_person_address: string | null;
}

export type BorrowerInput = Omit<BorrowerDetails, "id">;

const DETAIL_COLUMNS =
  "id, name, legal_name, whatsapp_number, email, address, pan, entity_type, aadhaar, auth_person_name, auth_person_pan, auth_person_aadhaar, auth_person_address";

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const AADHAAR_PATTERN = /^[0-9]{12}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Returns an error message, or null if the input is valid. Only the short name
// and WhatsApp number are mandatory; other fields are format-checked when
// filled in.
export function validateBorrowerInput(input: BorrowerInput): string | null {
  const row = toRow(input);
  if (!row.name) return "Short name is required.";
  if (!row.whatsapp_number) return "WhatsApp number is required.";
  if (row.email && !EMAIL_PATTERN.test(row.email)) return "Email address is not valid.";
  if (row.pan && !PAN_PATTERN.test(row.pan)) return "PAN must be 10 characters, e.g. ABCDE1234F.";
  if (row.aadhaar && !AADHAAR_PATTERN.test(row.aadhaar)) return "Aadhaar number must be 12 digits.";
  if (row.auth_person_pan && !PAN_PATTERN.test(row.auth_person_pan))
    return "Authorised person PAN must be 10 characters, e.g. ABCDE1234F.";
  if (row.auth_person_aadhaar && !AADHAAR_PATTERN.test(row.auth_person_aadhaar))
    return "Authorised person Aadhaar must be 12 digits.";
  return null;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Normalises the form input for storage: trims, uppercases PAN, strips spaces
// from Aadhaar, and clears the fields that don't apply to the entity type so a
// borrower switched from Individual to Company doesn't keep a stale Aadhaar.
function toRow(input: BorrowerInput) {
  const isIndividual = input.entity_type === "INDIVIDUAL";
  const pan = (v: string | null) => blankToNull(v?.toUpperCase());
  const aadhaar = (v: string | null) => blankToNull(v?.replace(/\s+/g, ""));
  return {
    name: input.name.trim(),
    legal_name: blankToNull(input.legal_name),
    whatsapp_number: input.whatsapp_number.trim(),
    email: blankToNull(input.email),
    address: blankToNull(input.address),
    pan: pan(input.pan),
    entity_type: input.entity_type,
    aadhaar: isIndividual ? aadhaar(input.aadhaar) : null,
    auth_person_name: isIndividual ? null : blankToNull(input.auth_person_name),
    auth_person_pan: isIndividual ? null : pan(input.auth_person_pan),
    auth_person_aadhaar: isIndividual ? null : aadhaar(input.auth_person_aadhaar),
    auth_person_address: isIndividual ? null : blankToNull(input.auth_person_address),
  };
}

export async function getBorrowers(supabase: SupabaseClient): Promise<Borrower[]> {
  const { data } = await supabase.from("borrowers").select("id, name, whatsapp_number").order("name");
  return (data as Borrower[]) ?? [];
}

export async function getBorrowerDetails(supabase: SupabaseClient): Promise<BorrowerDetails[]> {
  const { data, error } = await supabase.from("borrowers").select(DETAIL_COLUMNS).order("name");
  if (!error) return (data as BorrowerDetails[]) ?? [];
  // 42703 = undefined column: the KYC migration in schema.sql hasn't been run
  // yet. Still list existing borrowers rather than showing an empty page.
  if (error.code !== "42703") throw error;
  const basic = await getBorrowers(supabase);
  return basic.map((b) => ({
    ...b,
    legal_name: null,
    email: null,
    address: null,
    pan: null,
    entity_type: "INDIVIDUAL",
    aadhaar: null,
    auth_person_name: null,
    auth_person_pan: null,
    auth_person_aadhaar: null,
    auth_person_address: null,
  }));
}

// Quick-add used by the New Loan / Edit Loan pages: name + WhatsApp only.
// Full KYC details (including the legal name) are captured on the Manage
// Borrowers page.
export async function addBorrower(
  supabase: SupabaseClient,
  name: string,
  whatsappNumber?: string
): Promise<Borrower> {
  const insert: { name: string; whatsapp_number?: string } = { name: name.trim() };
  if (whatsappNumber?.trim()) insert.whatsapp_number = whatsappNumber.trim();

  const { data, error } = await supabase
    .from("borrowers")
    .insert(insert)
    .select("id, name, whatsapp_number")
    .single();
  if (error) throw error;
  return data as Borrower;
}

export async function addBorrowerWithDetails(supabase: SupabaseClient, input: BorrowerInput): Promise<void> {
  const row: Partial<ReturnType<typeof toRow>> = toRow(input);
  // Let the column default apply when no WhatsApp number is given.
  if (!row.whatsapp_number) delete row.whatsapp_number;
  const { error } = await supabase.from("borrowers").insert(row);
  if (error) throw error;
}

export async function updateBorrower(supabase: SupabaseClient, id: string, input: BorrowerInput): Promise<void> {
  const { error } = await supabase.from("borrowers").update(toRow(input)).eq("id", id);
  if (error) throw error;
}

// Deleting a borrower with any loan history (active or closed) would orphan
// or cascade-delete real loan records, so it's blocked entirely rather than
// risking silent data loss.
export async function deleteBorrower(supabase: SupabaseClient, id: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("loans")
    .select("id", { count: "exact", head: true })
    .eq("borrower_id", id);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw new Error("Can't delete a borrower with loans on record (active or closed). Delete or reassign those loans first.");
  }
  const { error } = await supabase.from("borrowers").delete().eq("id", id);
  if (error) throw error;
}

import type { SupabaseClient } from "@supabase/supabase-js";

export interface Borrower {
  id: string;
  name: string;
  whatsapp_number: string;
}

export async function getBorrowers(supabase: SupabaseClient): Promise<Borrower[]> {
  const { data } = await supabase.from("borrowers").select("id, name, whatsapp_number").order("name");
  return (data as Borrower[]) ?? [];
}

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

export async function updateBorrower(
  supabase: SupabaseClient,
  id: string,
  name: string,
  whatsappNumber: string
): Promise<void> {
  const { error } = await supabase
    .from("borrowers")
    .update({ name: name.trim(), whatsapp_number: whatsappNumber.trim() })
    .eq("id", id);
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

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

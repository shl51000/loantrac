import type { SupabaseClient } from "@supabase/supabase-js";

export interface Referral {
  id: string;
  name: string;
  whatsapp_number: string;
  color_seq: number;
}

export async function getReferrals(supabase: SupabaseClient): Promise<Referral[]> {
  const { data } = await supabase
    .from("referrals")
    .select("id, name, whatsapp_number, color_seq")
    .order("color_seq");
  return (data as Referral[]) ?? [];
}

export async function addReferral(
  supabase: SupabaseClient,
  name: string,
  whatsappNumber: string
): Promise<Referral> {
  const { data, error } = await supabase
    .from("referrals")
    .insert({ name: name.trim(), whatsapp_number: whatsappNumber.trim() })
    .select("id, name, whatsapp_number, color_seq")
    .single();
  if (error) throw error;
  return data as Referral;
}

export async function updateReferral(
  supabase: SupabaseClient,
  id: string,
  name: string,
  whatsappNumber: string
): Promise<void> {
  const { error } = await supabase
    .from("referrals")
    .update({ name: name.trim(), whatsapp_number: whatsappNumber.trim() })
    .eq("id", id);
  if (error) throw error;
}

// Deleting a referral with any loan history (active or closed) would orphan
// or cascade-delete real loan records, so it's blocked entirely rather than
// risking silent data loss.
export async function deleteReferral(supabase: SupabaseClient, id: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("loans")
    .select("id", { count: "exact", head: true })
    .eq("referral_id", id);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    throw new Error("Can't delete a referral with loans on record (active or closed). Delete or reassign those loans first.");
  }
  const { error } = await supabase.from("referrals").delete().eq("id", id);
  if (error) throw error;
}

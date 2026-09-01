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

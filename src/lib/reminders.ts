import type { SupabaseClient } from "@supabase/supabase-js";
import { toISODateString } from "@/lib/format";
import { getPendingInstallments } from "@/lib/pendingInstallments";

// Counts pending installments due today or earlier. Used for the red badge
// on "Reminders" in the sidebar.
export async function getReminderCount(supabase: SupabaseClient): Promise<number> {
  const today = toISODateString(new Date());
  const pending = await getPendingInstallments(supabase);
  return pending.filter((p) => p.dueDate <= today).length;
}

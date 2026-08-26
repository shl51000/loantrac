import type { SupabaseClient } from "@supabase/supabase-js";

// Downloads every table's contents as a single JSON file. Read-only —
// safe for both roles to run at any time.
export async function exportBackup(supabase: SupabaseClient) {
  const tables = [
    "borrowers",
    "referrals",
    "loans",
    "emi_installments",
    "emi_receipts",
    "oncall_transactions",
  ] as const;

  const backup: Record<string, unknown> = {
    exported_at: new Date().toISOString(),
  };

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*");
    if (error) throw new Error(`Failed exporting ${table}: ${error.message}`);
    backup[table] = data ?? [];
  }

  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `loantrac-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

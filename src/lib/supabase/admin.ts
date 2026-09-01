import { createClient } from "@supabase/supabase-js";

// SERVER-ONLY. Never import this from a Client Component or anything that
// ships to the browser. Uses the service_role key, which bypasses every
// Row Level Security policy and can create, edit, or delete any user
// account. Only ever call this from Route Handlers under src/app/api/,
// which run exclusively on the server.
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Add it to .env.local (server-only, never NEXT_PUBLIC_)."
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

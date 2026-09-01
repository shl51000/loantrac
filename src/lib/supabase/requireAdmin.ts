import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { User } from "@supabase/supabase-js";

// SERVER-ONLY. Verifies the caller of a Route Handler is a logged-in admin
// before any privileged (service-role) operation is allowed to run. Every
// admin API route must call this first — the service_role client itself
// has no concept of "who's asking", so this check is the only thing
// standing between an authenticated non-admin and full account control.
export async function requireAdmin(): Promise<{ user: User } | { error: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") {
    return { error: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }

  return { user };
}

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

// Creates a new login (Auth user + profile row) directly, with the
// passphrase set immediately and the email pre-confirmed — no
// confirmation email involved, so this can't hit Supabase's free-tier
// email rate limit the way the dashboard's "invite" flow can.
export async function POST(request: Request) {
  const check = await requireAdmin();
  if ("error" in check) return check.error;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const role = body?.role === "admin" ? "admin" : body?.role === "user" ? "user" : null;

  if (!email || !password || !role) {
    return NextResponse.json({ error: "Email, passphrase, and role are all required." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Passphrase must be at least 6 characters." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    return NextResponse.json({ error: createError?.message ?? "Could not create user." }, { status: 400 });
  }

  const { error: roleError } = await admin.from("profiles").update({ role }).eq("id", created.user.id);
  if (roleError) {
    return NextResponse.json({ error: roleError.message }, { status: 400 });
  }

  return NextResponse.json({ id: created.user.id });
}

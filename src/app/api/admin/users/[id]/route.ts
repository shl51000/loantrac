import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/supabase/requireAdmin";
import { createAdminClient } from "@/lib/supabase/admin";

// Changes an existing login's email and/or passphrase. Role changes don't
// go through here — they go straight from the browser against the
// `profiles` table, which is already protected by the
// profiles_update_admin_only RLS policy and doesn't need the service role.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAdmin();
  if ("error" in check) return check.error;

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : undefined;
  const password = typeof body?.password === "string" ? body.password : undefined;

  if (!email && !password) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  if (password && password.length < 6) {
    return NextResponse.json({ error: "Passphrase must be at least 6 characters." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(id, {
    ...(email ? { email } : {}),
    ...(password ? { password } : {}),
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (email) {
    await admin.from("profiles").update({ email }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}

// Deletes a login entirely (Auth user; the profiles row cascades). Blocks
// an admin from deleting their own account so nobody can lock themselves
// out.
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const check = await requireAdmin();
  if ("error" in check) return check.error;

  const { id } = await params;
  if (id === check.user.id) {
    return NextResponse.json({ error: "You can't delete your own account." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

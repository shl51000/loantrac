"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Role = "user" | "admin";

const ROLE_LABEL: Record<Role, string> = {
  user: "User",
  admin: "Admin",
};

export default function LoginPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [selectedRole, setSelectedRole] = useState<Role>("user");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const roleLabel = ROLE_LABEL[selectedRole];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const wrongPassphraseMessage = `That passphrase isn't right for ${roleLabel} — try again.`;

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError || !data.user) {
      // eslint-disable-next-line no-console
      console.error("[LoanTrac] sign-in failed:", signInError);
      setError(wrongPassphraseMessage);
      setSubmitting(false);
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();

    if (profileError || !profile || profile.role !== selectedRole) {
      // eslint-disable-next-line no-console
      console.error("[LoanTrac] profile/role check failed:", {
        profileError,
        profile,
        selectedRole,
      });
      // Credentials were valid but for a different role than the one picked.
      // Sign back out so no session is left behind for the wrong role.
      await supabase.auth.signOut();
      setError(wrongPassphraseMessage);
      setSubmitting(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 border-2 border-slate-300 flex items-center justify-center mb-4">
            <span className="text-2xl font-serif font-bold text-teal-400">SF</span>
          </div>
          <h1 className="text-xl font-bold text-white">LoanTrac</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["user", "admin"] as Role[]).map((role) => {
              const active = selectedRole === role;
              return (
                <button
                  key={role}
                  type="button"
                  onClick={() => {
                    setSelectedRole(role);
                    setError(null);
                  }}
                  className={
                    "rounded-lg py-2.5 text-sm font-semibold border transition-colors " +
                    (active
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-slate-800/60 text-slate-200 border-slate-600 hover:bg-slate-800")
                  }
                >
                  {ROLE_LABEL[role]}
                </button>
              );
            })}
          </div>

          <div>
            <label htmlFor="email" className="sr-only">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              placeholder="Email"
            />
          </div>

          <div>
            <label htmlFor="password" className="sr-only">
              Passphrase
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              placeholder={`${roleLabel} passphrase`}
            />
          </div>

          {error && (
            <p className="text-sm text-rose-300 bg-rose-950/40 border border-rose-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white font-semibold py-2.5 text-sm transition-colors"
          >
            {submitting ? "Checking…" : `Unlock as ${roleLabel}`}
          </button>
        </form>
      </div>
    </div>
  );
}

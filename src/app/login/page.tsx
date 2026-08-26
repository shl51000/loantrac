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
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-teal-700">LoanTrac</h1>
          <p className="text-slate-500 mt-1 text-sm">Sign in to your portfolio</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-5"
        >
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-2">
              I am
            </span>
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
                        : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50")
                    }
                  >
                    {ROLE_LABEL[role]}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
              Passphrase
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
              placeholder={`${roleLabel} passphrase`}
            />
          </div>

          {error && (
            <p className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
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

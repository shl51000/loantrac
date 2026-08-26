"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export type Role = "admin" | "user";

export interface Profile {
  id: string;
  email: string;
  role: Role;
}

interface AuthContextValue {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(
    async (userId: string) => {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, role")
        .eq("id", userId)
        .single();
      setProfile((data as Profile) ?? null);
    },
    [supabase]
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(async ({ data }) => {
      if (!mounted) return;
      setUser(data.user);
      if (data.user) await loadProfile(data.user.id);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        await loadProfile(session.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
  }, [supabase]);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, isAdmin: profile?.role === "admin", signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

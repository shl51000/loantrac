"use client";

import { useAuth } from "@/contexts/AuthProvider";

export default function RoleBadge() {
  const { profile } = useAuth();
  if (!profile) return null;

  const isAdmin = profile.role === "admin";

  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold " +
        (isAdmin ? "bg-teal-600 text-white" : "bg-slate-200 text-slate-700")
      }
    >
      {isAdmin ? "Admin" : "User"}
    </span>
  );
}

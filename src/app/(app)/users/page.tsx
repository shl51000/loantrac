"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/contexts/AuthProvider";
import { formatDate } from "@/lib/format";

type Role = "admin" | "user";

interface ProfileRow {
  id: string;
  email: string;
  role: Role;
  created_at: string;
}

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";
const labelClass = "block text-sm font-medium text-slate-700 mb-1";

export default function UsersPage() {
  const { isAdmin, user: currentUser } = useAuth();
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);

  const [addingUser, setAddingUser] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("user");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  async function loadProfiles() {
    const { data } = await supabase.from("profiles").select("id, email, role, created_at").order("email");
    setProfiles((data as ProfileRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      if (!isAdmin) {
        setLoading(false);
        return;
      }
      await loadProfiles();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function handleAddUser() {
    setAddError(null);
    if (!newEmail.trim() || !newPassword) {
      setAddError("Email and passphrase are required.");
      return;
    }
    setAddSubmitting(true);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail.trim(), password: newPassword, role: newRole }),
    });
    const json = await res.json();
    if (!res.ok) {
      setAddError(json.error ?? "Could not create user.");
      setAddSubmitting(false);
      return;
    }
    setAddingUser(false);
    setNewEmail("");
    setNewPassword("");
    setNewRole("user");
    setAddSubmitting(false);
    await loadProfiles();
  }

  async function handleRoleChange(id: string, role: Role) {
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) {
      alert(error.message);
      return;
    }
    await loadProfiles();
  }

  function startEdit(p: ProfileRow) {
    setEditingId(p.id);
    setEditEmail(p.email);
    setEditPassword("");
    setEditError(null);
  }

  async function handleSaveEdit(id: string) {
    setEditError(null);
    const payload: { email?: string; password?: string } = {};
    if (editEmail.trim()) payload.email = editEmail.trim();
    if (editPassword) payload.password = editPassword;
    if (!payload.email && !payload.password) {
      setEditError("Change the email or passphrase, or cancel.");
      return;
    }
    setEditSubmitting(true);
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      setEditError(json.error ?? "Could not update user.");
      setEditSubmitting(false);
      return;
    }
    setEditingId(null);
    setEditSubmitting(false);
    await loadProfiles();
  }

  async function handleDelete(id: string, email: string) {
    if (!confirm(`Delete the login for ${email}? This cannot be undone.`)) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error ?? "Could not delete user.");
      return;
    }
    await loadProfiles();
  }

  if (!isAdmin) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-teal-700">Manage users</h1>
        <p className="text-sm text-slate-500 mt-4">This screen is only available to Admins.</p>
      </div>
    );
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-teal-700">Manage users</h1>
        {!addingUser && (
          <button
            onClick={() => setAddingUser(true)}
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 px-4"
          >
            + Add user
          </button>
        )}
      </div>

      {addingUser && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">New login</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Email</label>
              <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Passphrase</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <span className={labelClass}>Role</span>
            <div className="grid grid-cols-2 gap-2 max-w-xs">
              {(["user", "admin"] as Role[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setNewRole(r)}
                  className={
                    "rounded-lg py-2 text-sm font-semibold border " +
                    (newRole === r
                      ? "bg-teal-600 text-white border-teal-600"
                      : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50")
                  }
                >
                  {r === "admin" ? "Admin" : "User"}
                </button>
              ))}
            </div>
          </div>
          {addError && <p className="text-sm text-rose-600">{addError}</p>}
          <div className="flex gap-2">
            <button
              disabled={addSubmitting}
              onClick={handleAddUser}
              className="rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-semibold py-1.5 px-3"
            >
              {addSubmitting ? "Creating…" : "Create login"}
            </button>
            <button
              onClick={() => {
                setAddingUser(false);
                setAddError(null);
              }}
              className="text-sm text-slate-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const isSelf = p.id === currentUser?.id;
              const isEditing = editingId === p.id;
              return (
                <tr key={p.id} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input
                        value={editEmail}
                        onChange={(e) => setEditEmail(e.target.value)}
                        className={inputClass}
                      />
                    ) : (
                      <>
                        {p.email}
                        {isSelf && <span className="text-xs text-slate-400"> (you)</span>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={p.role}
                      onChange={(e) => handleRoleChange(p.id, e.target.value as Role)}
                      disabled={isSelf}
                      className="bg-white text-sm rounded-lg px-2 py-1 border border-slate-300 disabled:opacity-50"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="space-y-2 min-w-[220px]">
                        <input
                          type="password"
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          placeholder="New passphrase (optional)"
                          className={inputClass}
                        />
                        {editError && <p className="text-xs text-rose-600">{editError}</p>}
                        <div className="flex gap-2">
                          <button
                            disabled={editSubmitting}
                            onClick={() => handleSaveEdit(p.id)}
                            className="rounded bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-xs font-semibold py-1 px-2"
                          >
                            {editSubmitting ? "Saving…" : "Save"}
                          </button>
                          <button onClick={() => setEditingId(null)} className="text-xs text-slate-500 hover:underline">
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3 whitespace-nowrap">
                        <button onClick={() => startEdit(p)} className="text-xs text-teal-700 hover:underline">
                          edit
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => handleDelete(p.id, p.email)}
                            className="text-xs text-rose-600 hover:underline"
                          >
                            delete
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

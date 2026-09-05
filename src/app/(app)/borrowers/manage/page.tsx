"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getBorrowers, addBorrower, updateBorrower, deleteBorrower, type Borrower } from "@/lib/borrowers";
import { getErrorMessage } from "@/lib/errors";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";
const labelClass = "block text-sm font-medium text-slate-700 mb-1";

export default function ManageBorrowersPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [borrowers, setBorrowers] = useState<Borrower[]>([]);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newWhatsapp, setNewWhatsapp] = useState("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWhatsapp, setEditWhatsapp] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadBorrowers() {
    const data = await getBorrowers(supabase);
    setBorrowers(data);
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await loadBorrowers();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleAdd() {
    setAddError(null);
    if (!newName.trim()) {
      setAddError("Name is required.");
      return;
    }
    setAddSubmitting(true);
    try {
      await addBorrower(supabase, newName, newWhatsapp);
      setAdding(false);
      setNewName("");
      setNewWhatsapp("");
      await loadBorrowers();
    } catch (err) {
      setAddError(getErrorMessage(err, "Could not add borrower."));
    } finally {
      setAddSubmitting(false);
    }
  }

  function startEdit(b: Borrower) {
    setEditingId(b.id);
    setEditName(b.name);
    setEditWhatsapp(b.whatsapp_number);
    setEditError(null);
    setDeleteError(null);
  }

  async function handleSaveEdit(id: string) {
    setEditError(null);
    if (!editName.trim()) {
      setEditError("Name is required.");
      return;
    }
    setEditSubmitting(true);
    try {
      await updateBorrower(supabase, id, editName, editWhatsapp);
      setEditingId(null);
      await loadBorrowers();
    } catch (err) {
      setEditError(getErrorMessage(err, "Could not update borrower."));
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    setDeleteError(null);
    if (!confirm(`Delete borrower "${name}"? This cannot be undone.`)) return;
    try {
      await deleteBorrower(supabase, id);
      await loadBorrowers();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Could not delete borrower."));
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">Manage borrowers</h1>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 px-4"
          >
            + Add borrower
          </button>
        )}
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">New borrower</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Name</label>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>WhatsApp number</label>
              <input value={newWhatsapp} onChange={(e) => setNewWhatsapp(e.target.value)} className={inputClass} />
            </div>
          </div>
          {addError && <p className="text-sm text-rose-600">{addError}</p>}
          <div className="flex gap-2">
            <button
              disabled={addSubmitting}
              onClick={handleAdd}
              className="rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-semibold py-1.5 px-3"
            >
              {addSubmitting ? "Adding…" : "Add borrower"}
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setAddError(null);
              }}
              className="text-sm text-slate-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {deleteError && (
        <p className="text-sm text-rose-600 mt-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{deleteError}</p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {borrowers.map((b) => {
              const isEditing = editingId === b.id;
              return (
                <tr key={b.id} className="border-b border-slate-100 align-top">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} className={inputClass} />
                    ) : (
                      <span className="font-medium text-slate-800">{b.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {isEditing ? (
                      <input value={editWhatsapp} onChange={(e) => setEditWhatsapp(e.target.value)} className={inputClass} />
                    ) : (
                      b.whatsapp_number || "—"
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="space-y-2 min-w-[160px]">
                        {editError && <p className="text-xs text-rose-600">{editError}</p>}
                        <div className="flex gap-2">
                          <button
                            disabled={editSubmitting}
                            onClick={() => handleSaveEdit(b.id)}
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
                        <button onClick={() => startEdit(b)} className="text-xs text-teal-700 hover:underline">
                          edit
                        </button>
                        <button onClick={() => handleDelete(b.id, b.name)} className="text-xs text-rose-600 hover:underline">
                          delete
                        </button>
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

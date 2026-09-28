"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  getBorrowerDetails,
  addBorrowerWithDetails,
  updateBorrower,
  deleteBorrower,
  validateBorrowerInput,
  entityTypeLabel,
  ENTITY_TYPES,
  type BorrowerDetails,
  type BorrowerInput,
  type EntityType,
} from "@/lib/borrowers";
import { getErrorMessage } from "@/lib/errors";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500";
const labelClass = "block text-sm font-medium text-slate-700 mb-1";

const EMPTY_FORM: BorrowerInput = {
  name: "",
  legal_name: "",
  whatsapp_number: "",
  email: "",
  address: "",
  pan: "",
  entity_type: "INDIVIDUAL",
  aadhaar: "",
  auth_person_name: "",
  auth_person_pan: "",
  auth_person_aadhaar: "",
  auth_person_address: "",
};

function toForm(b: BorrowerDetails): BorrowerInput {
  return {
    name: b.name,
    legal_name: b.legal_name ?? "",
    whatsapp_number: b.whatsapp_number ?? "",
    email: b.email ?? "",
    address: b.address ?? "",
    pan: b.pan ?? "",
    entity_type: b.entity_type ?? "INDIVIDUAL",
    aadhaar: b.aadhaar ?? "",
    auth_person_name: b.auth_person_name ?? "",
    auth_person_pan: b.auth_person_pan ?? "",
    auth_person_aadhaar: b.auth_person_aadhaar ?? "",
    auth_person_address: b.auth_person_address ?? "",
  };
}

type FormMode = { kind: "add" } | { kind: "edit"; id: string } | null;

export default function ManageBorrowersPage() {
  const [supabase] = useState(() => createClient());
  const [loading, setLoading] = useState(true);
  const [borrowers, setBorrowers] = useState<BorrowerDetails[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<FormMode>(null);
  const [form, setForm] = useState<BorrowerInput>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function loadBorrowers() {
    try {
      setBorrowers(await getBorrowerDetails(supabase));
      setLoadError(null);
    } catch (err) {
      setLoadError(getErrorMessage(err, "Could not load borrowers."));
    }
    setLoading(false);
  }

  useEffect(() => {
    (async () => {
      await loadBorrowers();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function set<K extends keyof BorrowerInput>(key: K, value: BorrowerInput[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function openAdd() {
    setMode({ kind: "add" });
    setForm(EMPTY_FORM);
    setFormError(null);
    setDeleteError(null);
  }

  function openEdit(b: BorrowerDetails) {
    setMode({ kind: "edit", id: b.id });
    setForm(toForm(b));
    setFormError(null);
    setDeleteError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeForm() {
    setMode(null);
    setFormError(null);
  }

  async function handleSubmit() {
    if (!mode) return;
    setFormError(null);
    const validationError = validateBorrowerInput(form);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      if (mode.kind === "add") await addBorrowerWithDetails(supabase, form);
      else await updateBorrower(supabase, mode.id, form);
      setMode(null);
      await loadBorrowers();
    } catch (err) {
      setFormError(getErrorMessage(err, mode.kind === "add" ? "Could not add borrower." : "Could not update borrower."));
    } finally {
      setSubmitting(false);
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

  const isIndividual = form.entity_type === "INDIVIDUAL";

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-teal-700 uppercase tracking-wide">Manage borrowers</h1>
        {!mode && (
          <button
            onClick={openAdd}
            className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold py-2 px-4"
          >
            + Add borrower
          </button>
        )}
      </div>

      {mode && (
        <div className="bg-white rounded-xl border border-slate-200 p-4 mt-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
            {mode.kind === "add" ? "New borrower" : "Edit borrower"}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>
                Short name <span className="text-rose-600">*</span>
              </label>
              <input value={form.name} onChange={(e) => set("name", e.target.value)} className={inputClass} />
              <p className="text-xs text-slate-500 mt-1">Shown across the app.</p>
            </div>
            <div>
              <label className={labelClass}>Legal name</label>
              <input
                value={form.legal_name ?? ""}
                onChange={(e) => set("legal_name", e.target.value)}
                className={inputClass}
              />
              <p className="text-xs text-slate-500 mt-1">For reference only.</p>
            </div>
            <div>
              <label className={labelClass}>Entity type</label>
              <select
                value={form.entity_type}
                onChange={(e) => set("entity_type", e.target.value as EntityType)}
                className={inputClass}
              >
                {ENTITY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Email address</label>
              <input
                type="email"
                value={form.email ?? ""}
                onChange={(e) => set("email", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>
                WhatsApp number <span className="text-rose-600">*</span>
              </label>
              <input
                value={form.whatsapp_number}
                onChange={(e) => set("whatsapp_number", e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>PAN</label>
              <input
                value={form.pan ?? ""}
                onChange={(e) => set("pan", e.target.value.toUpperCase())}
                maxLength={10}
                placeholder="ABCDE1234F"
                className={`${inputClass} uppercase`}
              />
            </div>
            {isIndividual && (
              <div>
                <label className={labelClass}>Aadhaar number</label>
                <input
                  value={form.aadhaar ?? ""}
                  onChange={(e) => set("aadhaar", e.target.value)}
                  inputMode="numeric"
                  maxLength={14}
                  placeholder="12 digits"
                  className={inputClass}
                />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className={labelClass}>Address</label>
              <textarea
                value={form.address ?? ""}
                onChange={(e) => set("address", e.target.value)}
                rows={2}
                className={inputClass}
              />
            </div>
          </div>

          {!isIndividual && (
            <div className="border-t border-slate-200 pt-4 space-y-3">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Authorised person</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>Authorised person name</label>
                  <input
                    value={form.auth_person_name ?? ""}
                    onChange={(e) => set("auth_person_name", e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Authorised person PAN</label>
                  <input
                    value={form.auth_person_pan ?? ""}
                    onChange={(e) => set("auth_person_pan", e.target.value.toUpperCase())}
                    maxLength={10}
                    placeholder="ABCDE1234F"
                    className={`${inputClass} uppercase`}
                  />
                </div>
                <div>
                  <label className={labelClass}>Authorised person Aadhaar</label>
                  <input
                    value={form.auth_person_aadhaar ?? ""}
                    onChange={(e) => set("auth_person_aadhaar", e.target.value)}
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="12 digits"
                    className={inputClass}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Authorised person address</label>
                  <textarea
                    value={form.auth_person_address ?? ""}
                    onChange={(e) => set("auth_person_address", e.target.value)}
                    rows={2}
                    className={inputClass}
                  />
                </div>
              </div>
            </div>
          )}

          {formError && <p className="text-sm text-rose-600">{formError}</p>}
          <div className="flex gap-2">
            <button
              disabled={submitting}
              onClick={handleSubmit}
              className="rounded-lg bg-teal-600 hover:bg-teal-700 disabled:opacity-60 text-white text-sm font-semibold py-1.5 px-3"
            >
              {mode.kind === "add"
                ? submitting
                  ? "Adding…"
                  : "Add borrower"
                : submitting
                  ? "Saving…"
                  : "Save changes"}
            </button>
            <button onClick={closeForm} className="text-sm text-slate-500 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <p className="text-sm text-rose-600 mt-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{loadError}</p>
      )}
      {deleteError && (
        <p className="text-sm text-rose-600 mt-3 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{deleteError}</p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="px-4 py-3">Short name</th>
              <th className="px-4 py-3">Entity type</th>
              <th className="px-4 py-3">PAN</th>
              <th className="px-4 py-3">WhatsApp</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {borrowers.map((b) => (
              <tr
                key={b.id}
                className={`border-b border-slate-100 align-top ${mode?.kind === "edit" && mode.id === b.id ? "bg-teal-50" : ""}`}
              >
                <td className="px-4 py-3">
                  <span className="font-medium text-slate-800">{b.name}</span>
                  {b.legal_name && (
                    <div className="text-xs text-slate-500">Legal: {b.legal_name}</div>
                  )}
                  {b.entity_type !== "INDIVIDUAL" && b.auth_person_name && (
                    <div className="text-xs text-slate-500">Auth. person: {b.auth_person_name}</div>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{entityTypeLabel(b.entity_type)}</td>
                <td className="px-4 py-3 text-slate-500 font-mono">{b.pan || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{b.whatsapp_number || "—"}</td>
                <td className="px-4 py-3 text-slate-500">{b.email || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-3 whitespace-nowrap">
                    <button onClick={() => openEdit(b)} className="text-xs text-teal-700 hover:underline">
                      edit
                    </button>
                    <button onClick={() => handleDelete(b.id, b.name)} className="text-xs text-rose-600 hover:underline">
                      delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

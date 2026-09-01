// Sidebar and TopBar live in the shared (app) layout and stay mounted across
// client-side navigations, so their own data (active loan list, reminder
// counts) goes stale after a mutation on another page. Pages that create,
// edit, close, reopen, or delete a loan (or record/delete a receipt or
// on-call transaction) call notifyLoansChanged() so those persistent
// components know to refetch.
const EVENT_NAME = "loantrac:loans-changed";

export function notifyLoansChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EVENT_NAME));
  }
}

export function onLoansChanged(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT_NAME, callback);
  return () => window.removeEventListener(EVENT_NAME, callback);
}

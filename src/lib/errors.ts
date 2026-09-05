// Extracts a human-readable message from a caught value. Checked against a
// plain `message` property rather than relying solely on `instanceof Error`
// — Supabase's PostgrestError (and similar library errors) can fail that
// check in practice, which was silently swallowing real database error
// messages (e.g. check-constraint violations) behind generic fallback text.
export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const message = (err as { message: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return fallback;
}

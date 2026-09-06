// Pure: which send failures are worth retrying. No I/O so it is unit-testable.

// SQLSTATEs raised on purpose by submit_report: refuse for good, do not retry
const PERMANENT_CODES = new Set(['42501', '22023', '23514', '23503', 'PGRST202']);

export function classifyError(
  e: { code?: string | null; message?: string | null; status?: number } | null | undefined,
): { permanent: boolean; error: string } {
  const code = e?.code ?? '';
  const message = e?.message ?? 'unknown error';
  if (PERMANENT_CODES.has(code)) return { permanent: true, error: `${code}: ${message}` };
  // anything else — network, timeouts, 5xx, expired JWT (refreshes), unknown — is worth retrying
  return { permanent: false, error: code ? `${code}: ${message}` : message };
}

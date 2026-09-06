/** A readable message from anything a query or RPC can throw — never "[object Object]". */
export function errorMessage(e: unknown): string {
  if (!e) return '';
  if (typeof e === 'string') return e;
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'object') {
    const o = e as { message?: unknown; code?: unknown; hint?: unknown; details?: unknown };
    const parts = [o.code, o.message].filter(
      (x): x is string => typeof x === 'string' && x.length > 0,
    );
    if (parts.length) return parts.join(': ');
    try {
      return JSON.stringify(e);
    } catch {
      /* fall through */
    }
  }
  return String(e);
}

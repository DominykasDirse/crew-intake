import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';

import { supabase } from './supabase';

export type FnResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

/** Calls an Edge Function and turns its `{ code, message }` error bodies into a plain result. */
export async function invokeFn<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<FnResult<T>> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) return { ok: true, data: data as T };
  if (error instanceof FunctionsHttpError) {
    try {
      const j = (await error.context.json()) as { code?: string; message?: string };
      return { ok: false, code: j.code ?? 'unknown', message: j.message ?? '' };
    } catch {
      return { ok: false, code: 'unknown', message: error.message };
    }
  }
  if (error instanceof FunctionsFetchError)
    return { ok: false, code: 'network', message: error.message };
  return { ok: false, code: 'unknown', message: error.message };
}

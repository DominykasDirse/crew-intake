// The one call that files a report: submit_report with the outbox's clientRef. Errors are
// classified for the outbox — transient (retry with backoff) or permanent (needs a person).
import { classifyError } from '@/offline/classify';

import type { Json } from '@/types/database.types';

import { supabase } from './supabase';

export type SubmitResult = {
  id: string;
  status: 'submitted' | 'excused';
  is_late: boolean;
  edited: boolean;
  duplicate: boolean;
  deadline_at: string;
  submitted_at: string;
  late_minutes: number | null;
};

export type SendOutcome =
  { ok: true; result: SubmitResult } | { ok: false; permanent: boolean; error: string };

export async function sendReport(
  formId: string,
  reportDate: string,
  answers: Record<string, unknown>,
  clientRef: string,
): Promise<SendOutcome> {
  try {
    const { data, error } = await supabase.rpc('submit_report', {
      p_form_id: formId,
      p_report_date: reportDate,
      p_answers: answers as unknown as Json,
      p_client_ref: clientRef,
    });
    if (error) return { ok: false, ...classifyError(error) };
    return { ok: true, result: data as unknown as SubmitResult };
  } catch (e) {
    return { ok: false, ...classifyError({ message: e instanceof Error ? e.message : String(e) }) };
  }
}

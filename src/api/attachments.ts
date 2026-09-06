// Drive state per photo comes from the attachments rows the person can read (RLS: own).
// Polled while anything is still on its way to Drive.
import { useQuery } from '@tanstack/react-query';

import { supabase } from './supabase';

export type AttachmentState = {
  id: string;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  sync_error: string | null;
  drive_url: string | null;
};

export function useAttachmentStates(submissionId: string | null | undefined) {
  return useQuery({
    queryKey: ['attachments', submissionId],
    enabled: !!submissionId,
    queryFn: async (): Promise<Record<string, AttachmentState>> => {
      const { data, error } = await supabase
        .from('attachments')
        .select('id,sync_status,sync_error,drive_url')
        .eq('submission_id', submissionId!);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((a) => [a.id, a as AttachmentState]));
    },
    refetchInterval: (q) => {
      const rows = Object.values(q.state.data ?? {});
      return rows.some((r) => r.sync_status !== 'synced' && r.sync_status !== 'failed')
        ? 5_000
        : false;
    },
  });
}

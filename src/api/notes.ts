// A person's note on a specific day. Timestamped by the server, never editable, visible to
// admins and the group lead. It records a disagreement; it changes no count.
import { useMutation, useQuery } from '@tanstack/react-query';

import { queryClient } from './queryClient';
import { supabase, type Tables } from './supabase';

export type DayNote = Tables<'day_notes'>;
export const NOTE_MAX = 500;

export function useDayNotes(userId: string | undefined, date: string) {
  return useQuery({
    queryKey: ['dayNotes', userId, date],
    enabled: !!userId && !!date,
    queryFn: async (): Promise<DayNote[]> => {
      const { data, error } = await supabase
        .from('day_notes')
        .select('*')
        .eq('user_id', userId!)
        .eq('report_date', date)
        .order('created_at');
      if (error) throw error;
      return data;
    },
  });
}

export function useAddDayNote(userId: string | undefined, date: string) {
  return useMutation({
    mutationFn: async (note: string) => {
      const text = note.trim();
      if (!text || text.length > NOTE_MAX) throw new Error('note length');
      const { error } = await supabase
        .from('day_notes')
        .insert({ user_id: userId!, report_date: date, note: text });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dayNotes', userId, date] });
      void queryClient.invalidateQueries({ queryKey: ['calendar'] });
      void queryClient.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}

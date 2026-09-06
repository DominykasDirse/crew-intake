// Data for the home screen and the runner. Server first, local cache as the fallback so a
// report can be started with no signal at all.
import { useQuery } from '@tanstack/react-query';

import type { Form, Question } from '@/forms/types';
import type { CalendarRow } from '@/lib/calendarRow';
import { useUploads } from '@/offline/uploadsStore';
import { useLocal } from '@/store/local';

import { supabase, type Tables } from './supabase';

export type { CalendarRow };

/** The published daily form for the person's group (+ questions), cached locally. */
export function usePublishedForm(groupId: string | null | undefined) {
  const cached = useLocal((s) => (groupId ? s.formCache[groupId] : undefined));
  const cacheForm = useLocal((s) => s.cacheForm);
  const q = useQuery({
    queryKey: ['form', 'daily', groupId],
    enabled: !!groupId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ form: Form; questions: Question[] }> => {
      const f = await supabase
        .from('forms')
        .select('*')
        .eq('group_id', groupId!)
        .eq('kind', 'daily')
        .eq('is_published', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (f.error) throw f.error;
      if (!f.data) throw new Error('no published form');
      const qs = await supabase
        .from('questions')
        .select('*')
        .eq('form_id', f.data.id)
        .order('order_index');
      if (qs.error) throw qs.error;
      cacheForm(groupId!, f.data, qs.data);
      return { form: f.data, questions: qs.data };
    },
  });
  const data = q.data ?? (cached ? { form: cached.form, questions: cached.questions } : undefined);
  return { ...q, data, fromCache: !q.data && !!cached };
}

/** Tour + show for a date, from the person's own assignments (RLS: own rows). */
export function useDayContext(userId: string | undefined, date: string) {
  return useQuery({
    queryKey: ['dayContext', userId, date],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const a = await supabase
        .from('assignments')
        .select('tour:tours(id,code,name,timezone)')
        .eq('user_id', userId!)
        .lte('starts_on', date)
        .gte('ends_on', date);
      if (a.error) throw a.error;
      const tours = (a.data ?? []).map((r) => r.tour).filter(Boolean) as {
        id: string;
        code: string;
        name: string;
        timezone: string;
      }[];
      tours.sort((x, y) => x.code.localeCompare(y.code));
      const tour = tours[0] ?? null;
      let show: Pick<Tables<'shows'>, 'city' | 'venue' | 'show_at'> | null = null;
      if (tour) {
        const s = await supabase
          .from('shows')
          .select('city,venue,show_at')
          .eq('tour_id', tour.id)
          .eq('date', date)
          .order('sequence')
          .limit(1)
          .maybeSingle();
        show = s.data ?? null;
      }
      return { tour, show };
    },
  });
}

/** report_calendar for the person over [from, to]; the strip, history and the day view come from it. */
export function useCalendar(userId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ['calendar', userId, from, to],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: async (): Promise<CalendarRow[]> => {
      const { data, error } = await supabase.rpc('report_calendar', {
        p_user_id: userId!,
        p_from: from,
        p_to: to,
      });
      if (error) throw error;
      return (data ?? []) as CalendarRow[];
    },
  });
}

/** The person's own submission for a date, with answers, if any. */
export function useSubmission(
  userId: string | undefined,
  formId: string | undefined,
  date: string,
) {
  return useQuery({
    queryKey: ['submission', userId, formId, date],
    enabled: !!userId && !!formId,
    queryFn: async () => {
      const s = await supabase
        .from('submissions')
        .select(
          'id,status,submitted_at,edited_at,is_late,deadline_at,answers(question_id,value_number,value_bool,value_text,value_json)',
        )
        .eq('user_id', userId!)
        .eq('form_id', formId!)
        .eq('report_date', date)
        .maybeSingle();
      if (s.error) throw s.error;
      if (s.data) useUploads.getState().rememberSubmission(formId!, date, s.data.id);
      return s.data;
    },
  });
}

/** The person's group: name for the header, notify_at for the deadline (profile.notify_at overrides). */
export function useGroup(groupId: string | null | undefined) {
  return useQuery({
    queryKey: ['group', groupId],
    enabled: !!groupId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('groups')
        .select('id,key,name_en,name_lt,notify_at')
        .eq('id', groupId!)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

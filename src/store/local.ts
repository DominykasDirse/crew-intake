// Everything that must survive the app being killed in a van with no signal:
//   drafts     answers + current screen per (form, date); written on every change
//   formCache  the published form and its questions, so a report can START offline
// Persisted with AsyncStorage (C6 — Expo Go). The submission outbox joins this in part 2.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import type { Answers, AnswerValue, Form, Question } from '@/forms/types';

export type Draft = {
  formId: string;
  reportDate: string;
  answers: Answers;
  screenIndex: number;
  startedAt: string;
  updatedAt: string;
  /** set when the draft was seeded from an already-submitted report (editing) */
  editingSubmissionId?: string | null;
};

export const draftKey = (formId: string, reportDate: string) => `${formId}|${reportDate}`;

type LocalState = {
  drafts: Record<string, Draft>;
  formCache: Record<string, { form: Form; questions: Question[]; cachedAt: string }>; // by group_id
  hydrated: boolean;

  getDraft: (formId: string, reportDate: string) => Draft | undefined;
  startDraft: (formId: string, reportDate: string, seed?: Partial<Draft>) => Draft;
  setAnswer: (
    formId: string,
    reportDate: string,
    key: string,
    value: AnswerValue | undefined,
  ) => void;
  setScreenIndex: (formId: string, reportDate: string, index: number) => void;
  clearDraft: (formId: string, reportDate: string) => void;
  cacheForm: (groupId: string, form: Form, questions: Question[]) => void;
};

export const useLocal = create<LocalState>()(
  persist(
    (set, get) => ({
      drafts: {},
      formCache: {},
      hydrated: false,

      getDraft: (formId, reportDate) => get().drafts[draftKey(formId, reportDate)],

      startDraft: (formId, reportDate, seed) => {
        const k = draftKey(formId, reportDate);
        const existing = get().drafts[k];
        if (existing) return existing;
        const now = new Date().toISOString();
        const draft: Draft = {
          formId,
          reportDate,
          answers: {},
          screenIndex: 0,
          startedAt: now,
          updatedAt: now,
          ...seed,
        };
        set((s) => ({ drafts: { ...s.drafts, [k]: draft } }));
        return draft;
      },

      setAnswer: (formId, reportDate, key, value) =>
        set((s) => {
          const k = draftKey(formId, reportDate);
          const d = s.drafts[k] ?? get().startDraft(formId, reportDate);
          const answers = { ...d.answers };
          if (value === undefined) delete answers[key];
          else answers[key] = value;
          return {
            drafts: { ...s.drafts, [k]: { ...d, answers, updatedAt: new Date().toISOString() } },
          };
        }),

      setScreenIndex: (formId, reportDate, index) =>
        set((s) => {
          const k = draftKey(formId, reportDate);
          const d = s.drafts[k];
          if (!d || d.screenIndex === index) return {};
          return { drafts: { ...s.drafts, [k]: { ...d, screenIndex: index } } };
        }),

      clearDraft: (formId, reportDate) =>
        set((s) => {
          const drafts = { ...s.drafts };
          delete drafts[draftKey(formId, reportDate)];
          return { drafts };
        }),

      cacheForm: (groupId, form, questions) =>
        set((s) => ({
          formCache: {
            ...s.formCache,
            [groupId]: { form, questions, cachedAt: new Date().toISOString() },
          },
        })),
    }),
    {
      name: 'crew-intake.local.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ drafts: s.drafts, formCache: s.formCache }),
      onRehydrateStorage: () => () => {
        useLocal.setState({ hydrated: true });
      },
    },
  ),
);

// Persisted outbox + the drainer. State transitions live in outbox.ts (pure, tested);
// this file only persists them and does the I/O.
//
// Drains: right after an enqueue, whenever the app comes to the foreground, on a timer
// for the next due item, and once after rehydration (which also un-sticks anything that
// was mid-send when the app died).
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { queryClient } from '@/api/queryClient';
import { sendReport } from '@/api/submit';

import { useUploads } from './uploadsStore';

import {
  dueItems,
  emptyOutbox,
  nextDueIn,
  type OutboxEvent,
  type OutboxItem,
  outboxKey,
  outboxReducer,
  type OutboxState,
} from './outbox';

type Store = {
  outbox: OutboxState;
  hydrated: boolean;
  draining: boolean;
  dispatch: (ev: OutboxEvent) => void;
  /** Queue a report; returns the item. Never throws, never loses the answers. */
  enqueue: (formId: string, reportDate: string, answers: Record<string, unknown>) => OutboxItem;
  retryNow: (key: string) => void;
  drain: () => Promise<void>;
};

let timer: ReturnType<typeof setTimeout> | null = null;

export const useOutbox = create<Store>()(
  persist(
    (set, get) => ({
      outbox: emptyOutbox(),
      hydrated: false,
      draining: false,

      dispatch: (ev) => set((s) => ({ outbox: outboxReducer(s.outbox, ev) })),

      enqueue: (formId, reportDate, answers) => {
        get().dispatch({
          type: 'enqueue',
          formId,
          reportDate,
          answers,
          clientRef: uuid(),
          now: Date.now(),
        });
        const item = get().outbox.items[outboxKey(formId, reportDate)]!;
        void get().drain();
        return item;
      },

      retryNow: (key) => {
        get().dispatch({ type: 'retryNow', key, now: Date.now() });
        void get().drain();
      },

      drain: async () => {
        if (get().draining) return;
        set({ draining: true });
        try {
          for (;;) {
            const now = Date.now();
            const due = dueItems(get().outbox, now);
            if (!due.length) break;
            for (const it of due) {
              get().dispatch({ type: 'sendStart', key: it.key, now: Date.now() });
              const version = it.version;
              const r = await sendReport(it.formId, it.reportDate, it.answers, it.clientRef);
              if (r.ok) {
                get().dispatch({
                  type: 'sendSuccess',
                  key: it.key,
                  version,
                  serverId: r.result.id,
                  serverStatus: r.result.status,
                  isLate: r.result.is_late,
                  deadlineAt: r.result.deadline_at,
                  submittedAt: r.result.submitted_at,
                  lateMinutes: r.result.late_minutes,
                  now: Date.now(),
                });
                useUploads.getState().rememberSubmission(it.formId, it.reportDate, r.result.id);
                void queryClient.invalidateQueries({ queryKey: ['submission'] });
                void queryClient.invalidateQueries({ queryKey: ['calendar'] });
              } else {
                get().dispatch({
                  type: 'sendFailure',
                  key: it.key,
                  version,
                  error: r.error,
                  permanent: r.permanent,
                  now: Date.now(),
                });
              }
            }
          }
        } finally {
          set({ draining: false });
          schedule(get);
        }
      },
    }),
    {
      name: 'crew-intake.outbox.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ outbox: s.outbox }),
      onRehydrateStorage: () => () => {
        const st = useOutbox.getState();
        st.dispatch({ type: 'rehydrate', now: Date.now() });
        useOutbox.setState({ hydrated: true });
        void st.drain();
      },
    },
  ),
);

function schedule(get: () => Store) {
  if (timer) clearTimeout(timer);
  const wait = nextDueIn(get().outbox, Date.now());
  if (wait === null) return;
  timer = setTimeout(() => void get().drain(), Math.max(wait, 250));
}

AppState.addEventListener('change', (s) => {
  if (s === 'active') void useOutbox.getState().drain();
});

// Signal comes and goes dozens of times a night in a van: the moment it is back, send.
NetInfo.addEventListener((state) => {
  if (state.isConnected && state.isInternetReachable !== false) void useOutbox.getState().drain();
});

function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // RN without Web Crypto: RFC 4122 v4 from Math.random — good enough for an idempotency key
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** The outbox item for a report, if any. */
export const useOutboxItem = (formId: string | undefined, reportDate: string) =>
  useOutbox((s) => (formId ? s.outbox.items[outboxKey(formId, reportDate)] : undefined));

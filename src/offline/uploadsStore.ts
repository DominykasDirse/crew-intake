// Persisted photo queue + the uploader. Transitions live in uploads.ts (pure, tested).
//
// An upload needs the report to exist on the server first (attachments.submission_id).
// knownSubmissions maps (form|date) → submission id and is filled by the outbox on a
// successful send and by any screen that loads a submission. Drains after add, after a
// report is sent, on reconnect, on foreground, on a timer, and once after rehydration.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { queryClient } from '@/api/queryClient';
import { supabase } from '@/api/supabase';
import { type CapturedPhoto, deleteLocal, readBytes } from '@/photos/capture';

import { outboxKey } from './outbox';
import {
  dueUploads,
  emptyUploads,
  nextUploadDueIn,
  type UploadEvent,
  type UploadItem,
  type UploadsState,
  uploadsReducer,
} from './uploads';

export const BUCKET = 'attachments';
const KEEP_LOCAL_DAYS = 7;

type Store = {
  uploads: UploadsState;
  knownSubmissions: Record<string, string>;
  hydrated: boolean;
  draining: boolean;
  dispatch: (ev: UploadEvent) => void;
  addPhoto: (
    formId: string,
    reportDate: string,
    questionKey: string,
    questionId: string,
    photo: CapturedPhoto,
  ) => void;
  removePhoto: (id: string) => void;
  retry: (id: string) => void;
  rememberSubmission: (formId: string, reportDate: string, submissionId: string) => void;
  pruneHidden: (formId: string, reportDate: string, visibleKeys: string[]) => void;
  drain: () => Promise<void>;
};

let timer: ReturnType<typeof setTimeout> | null = null;

export const useUploads = create<Store>()(
  persist(
    (set, get) => ({
      uploads: emptyUploads(),
      knownSubmissions: {},
      hydrated: false,
      draining: false,

      dispatch: (ev) => set((s) => ({ uploads: uploadsReducer(s.uploads, ev) })),

      addPhoto: (formId, reportDate, questionKey, questionId, photo) => {
        get().dispatch({
          type: 'add',
          now: Date.now(),
          item: {
            id: photo.id,
            formId,
            reportDate,
            questionKey,
            questionId,
            localUri: photo.localUri,
            filename: photo.filename,
            mime: photo.mime,
            bytes: photo.bytes,
            width: photo.width,
            height: photo.height,
          },
        });
        void get().drain();
      },

      removePhoto: (id) => {
        const it = get().uploads.items[id];
        if (it) deleteLocal(it.localUri);
        get().dispatch({ type: 'remove', id });
      },

      retry: (id) => {
        get().dispatch({ type: 'retryNow', id, now: Date.now() });
        void get().drain();
      },

      rememberSubmission: (formId, reportDate, submissionId) => {
        const key = outboxKey(formId, reportDate);
        if (get().knownSubmissions[key] === submissionId) return;
        set((s) => ({ knownSubmissions: { ...s.knownSubmissions, [key]: submissionId } }));
        void get().drain();
      },

      pruneHidden: (formId, reportDate, visibleKeys) => {
        const before = get().uploads.items;
        get().dispatch({ type: 'pruneHidden', formId, reportDate, visibleKeys });
        const after = get().uploads.items;
        for (const [id, it] of Object.entries(before)) if (!after[id]) deleteLocal(it.localUri);
      },

      drain: async () => {
        if (get().draining) return;
        set({ draining: true });
        try {
          const { data: auth } = await supabase.auth.getUser();
          const userId = auth.user?.id;
          if (!userId) return;
          for (;;) {
            const known = get().knownSubmissions;
            const due = dueUploads(get().uploads, Date.now(), (f, d) => !!known[outboxKey(f, d)]);
            if (!due.length) break;
            for (const it of due)
              await uploadOne(it, known[outboxKey(it.formId, it.reportDate)]!, userId, get);
          }
        } finally {
          set({ draining: false });
          schedule(get);
        }
      },
    }),
    {
      name: 'crew-intake.uploads.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ uploads: s.uploads, knownSubmissions: s.knownSubmissions }),
      onRehydrateStorage: () => () => {
        const st = useUploads.getState();
        st.dispatch({ type: 'rehydrate', now: Date.now() });
        gc(st);
        useUploads.setState({ hydrated: true });
        void st.drain();
      },
    },
  ),
);

async function uploadOne(it: UploadItem, submissionId: string, userId: string, get: () => Store) {
  get().dispatch({ type: 'uploadStart', id: it.id, now: Date.now() });
  try {
    const bytes = await readBytes(it.localUri);
    const path = `${userId}/${submissionId}/${it.questionKey}/${it.id}.jpg`;
    const up = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: it.mime, upsert: true });
    if (up.error)
      throw Object.assign(new Error(up.error.message), {
        status: (up.error as { statusCode?: string | number }).statusCode,
      });
    const row = await supabase
      .from('attachments')
      .upsert(
        {
          submission_id: submissionId,
          question_id: it.questionId,
          storage_path: path,
          filename: it.filename,
          mime: it.mime,
          bytes: it.bytes,
        },
        { onConflict: 'storage_path' },
      )
      .select('id')
      .single();
    if (row.error) throw Object.assign(new Error(row.error.message), { code: row.error.code });
    get().dispatch({
      type: 'uploadSuccess',
      id: it.id,
      storagePath: path,
      attachmentId: row.data.id,
      now: Date.now(),
    });
    void queryClient.invalidateQueries({ queryKey: ['attachments', submissionId] });
  } catch (e) {
    const err = e as { message?: string; status?: string | number; code?: string };
    const status = Number(err.status);
    // a refused upload (RLS, size, mime) or a refused row is permanent; the rest is worth retrying
    const permanent =
      (status >= 400 && status < 500 && status !== 408 && status !== 429) ||
      err.code === '42501' ||
      err.code === '23503' ||
      /file not found|no such file/i.test(err.message ?? '');
    get().dispatch({
      type: 'uploadFailure',
      id: it.id,
      error: err.message ?? 'upload failed',
      permanent,
      now: Date.now(),
    });
  }
}

/** Stored photos older than a week: the local copy is no longer needed. */
function gc(st: Store) {
  const cutoff = Date.now() - KEEP_LOCAL_DAYS * 86_400_000;
  for (const it of Object.values(st.uploads.items)) {
    if (it.status === 'stored' && it.updatedAt < cutoff) {
      deleteLocal(it.localUri);
      st.dispatch({ type: 'remove', id: it.id });
    }
  }
}

function schedule(get: () => Store) {
  if (timer) clearTimeout(timer);
  const wait = nextUploadDueIn(get().uploads, Date.now());
  if (wait === null) return;
  timer = setTimeout(() => void get().drain(), Math.max(wait, 250));
}

AppState.addEventListener('change', (s) => {
  if (s === 'active') void useUploads.getState().drain();
});
NetInfo.addEventListener((state) => {
  if (state.isConnected && state.isInternetReachable !== false) void useUploads.getState().drain();
});

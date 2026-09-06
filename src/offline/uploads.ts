// The photo upload queue. Pure reducer + selectors; the store in uploadsStore.ts persists it
// and does the I/O. A photo is taken (and compressed) on the device, queued locally, and
// uploaded when three things are true: there is a connection, the report it belongs to
// exists on the server (the outbox has sent it), and its backoff has elapsed. The report
// itself is never blocked by an unfinished upload.
//
//   queued     on the phone only
//   uploading  bytes going to Storage, then an attachments row
//   stored     in Storage with an attachments row; Drive sync is the server's job from here
//              (the row's sync_status says pending / synced / failed)
//   failed     last attempt refused; retried with backoff unless permanent (then by hand)

import { backoffMs } from './outbox';

export type UploadStatus = 'queued' | 'uploading' | 'stored' | 'failed';

export type UploadItem = {
  id: string; // photo id, also the storage object name
  formId: string;
  reportDate: string;
  questionKey: string;
  questionId: string;
  localUri: string; // compressed copy in the app's document directory
  filename: string; // original file name, for Drive
  mime: string;
  bytes: number;
  width: number;
  height: number;
  status: UploadStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  permanent: boolean;
  createdAt: number;
  updatedAt: number;
  storagePath: string | null;
  attachmentId: string | null;
};

export type UploadsState = { items: Record<string, UploadItem> };
export const emptyUploads = (): UploadsState => ({ items: {} });

export type UploadEvent =
  | {
      type: 'add';
      item: Omit<
        UploadItem,
        | 'status'
        | 'attempts'
        | 'nextAttemptAt'
        | 'lastError'
        | 'permanent'
        | 'createdAt'
        | 'updatedAt'
        | 'storagePath'
        | 'attachmentId'
      >;
      now: number;
    }
  | { type: 'remove'; id: string }
  | { type: 'uploadStart'; id: string; now: number }
  | { type: 'uploadSuccess'; id: string; storagePath: string; attachmentId: string; now: number }
  | { type: 'uploadFailure'; id: string; error: string; permanent: boolean; now: number }
  | { type: 'retryNow'; id: string; now: number }
  | { type: 'rehydrate'; now: number }
  /** the report was edited: photos whose question is no longer visible are dropped if not yet uploaded */
  | { type: 'pruneHidden'; formId: string; reportDate: string; visibleKeys: string[] };

export function uploadsReducer(state: UploadsState, ev: UploadEvent): UploadsState {
  switch (ev.type) {
    case 'add': {
      if (state.items[ev.item.id]) return state;
      const item: UploadItem = {
        ...ev.item,
        status: 'queued',
        attempts: 0,
        nextAttemptAt: ev.now,
        lastError: null,
        permanent: false,
        createdAt: ev.now,
        updatedAt: ev.now,
        storagePath: null,
        attachmentId: null,
      };
      return { items: { ...state.items, [item.id]: item } };
    }
    case 'remove': {
      const items = { ...state.items };
      delete items[ev.id];
      return { items };
    }
    case 'uploadStart': {
      const it = state.items[ev.id];
      if (!it || it.status !== 'queued') return state;
      return {
        items: { ...state.items, [ev.id]: { ...it, status: 'uploading', updatedAt: ev.now } },
      };
    }
    case 'uploadSuccess': {
      const it = state.items[ev.id];
      if (!it) return state;
      return {
        items: {
          ...state.items,
          [ev.id]: {
            ...it,
            status: 'stored',
            storagePath: ev.storagePath,
            attachmentId: ev.attachmentId,
            lastError: null,
            permanent: false,
            updatedAt: ev.now,
          },
        },
      };
    }
    case 'uploadFailure': {
      const it = state.items[ev.id];
      if (!it) return state;
      const attempts = it.attempts + 1;
      return {
        items: {
          ...state.items,
          [ev.id]: {
            ...it,
            status: ev.permanent ? 'failed' : 'queued',
            attempts,
            nextAttemptAt: ev.permanent ? Number.POSITIVE_INFINITY : ev.now + backoffMs(attempts),
            lastError: ev.error,
            permanent: ev.permanent,
            updatedAt: ev.now,
          },
        },
      };
    }
    case 'retryNow': {
      const it = state.items[ev.id];
      if (!it || it.status === 'stored' || it.status === 'uploading') return state;
      return {
        items: {
          ...state.items,
          [ev.id]: {
            ...it,
            status: 'queued',
            permanent: false,
            nextAttemptAt: ev.now,
            updatedAt: ev.now,
          },
        },
      };
    }
    case 'rehydrate': {
      let changed = false;
      const items = { ...state.items };
      for (const [k, it] of Object.entries(items)) {
        if (it.status === 'uploading') {
          items[k] = { ...it, status: 'queued', nextAttemptAt: ev.now, updatedAt: ev.now };
          changed = true;
        }
      }
      return changed ? { items } : state;
    }
    case 'pruneHidden': {
      const keep = new Set(ev.visibleKeys);
      const items: Record<string, UploadItem> = {};
      let changed = false;
      for (const [k, it] of Object.entries(state.items)) {
        const mine = it.formId === ev.formId && it.reportDate === ev.reportDate;
        // already in Storage: keep — the server has it and it stays attached to the report
        if (mine && !keep.has(it.questionKey) && it.status !== 'stored') {
          changed = true;
          continue;
        }
        items[k] = it;
      }
      return changed ? { items } : state;
    }
  }
}

export const photosFor = (
  state: UploadsState,
  formId: string,
  reportDate: string,
  questionKey?: string,
): UploadItem[] =>
  Object.values(state.items)
    .filter(
      (it) =>
        it.formId === formId &&
        it.reportDate === reportDate &&
        (!questionKey || it.questionKey === questionKey),
    )
    .sort((a, b) => a.createdAt - b.createdAt);

/** Uploads that may go now: queued, due, and whose report the server already has. */
export function dueUploads(
  state: UploadsState,
  now: number,
  hasSubmission: (formId: string, reportDate: string) => boolean,
): UploadItem[] {
  return Object.values(state.items).filter(
    (it) =>
      it.status === 'queued' && it.nextAttemptAt <= now && hasSubmission(it.formId, it.reportDate),
  );
}

export function nextUploadDueIn(state: UploadsState, now: number): number | null {
  const q = Object.values(state.items).filter(
    (it) => it.status === 'queued' && Number.isFinite(it.nextAttemptAt),
  );
  if (!q.length) return null;
  return Math.max(0, Math.min(...q.map((it) => it.nextAttemptAt)) - now);
}

export const unfinishedCount = (state: UploadsState, formId: string, reportDate: string) =>
  photosFor(state, formId, reportDate).filter((it) => it.status !== 'stored').length;

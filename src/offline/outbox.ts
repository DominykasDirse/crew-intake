// The submission outbox. Pure reducer + selectors, no I/O — the store in outboxStore.ts
// persists this state and drives the sends. Every guarantee in tests/outbox.test.ts is a
// property of this file.
//
// One item per (form, report date). Enqueueing over an existing item replaces its payload
// with a new VERSION and a new clientRef; the server treats a retry carrying a ref it has
// already seen as a no-op (submit_report p_client_ref), so double sends are harmless and
// the newest answers always win.

export type OutboxStatus = 'queued' | 'sending' | 'sent' | 'failed';

export type OutboxItem = {
  key: string; // `${formId}|${reportDate}`
  formId: string;
  reportDate: string;
  answers: Record<string, unknown>;
  status: OutboxStatus;
  /** bumps whenever the payload changes; a send only "counts" if the version it carried is still current */
  version: number;
  clientRef: string;
  attempts: number;
  nextAttemptAt: number; // epoch ms
  lastError: string | null;
  /** set while a send is in flight: the version it carries */
  sendingVersion: number | null;
  createdAt: number;
  updatedAt: number;
  sentAt: number | null;
  serverId: string | null;
  serverStatus: 'submitted' | 'excused' | null;
  isLate: boolean | null;
  deadlineAt: string | null;
  submittedAt: string | null;
  lateMinutes: number | null;
};

export type OutboxState = { items: Record<string, OutboxItem> };

export const emptyOutbox = (): OutboxState => ({ items: {} });
export const outboxKey = (formId: string, reportDate: string) => `${formId}|${reportDate}`;

export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 10 * 60_000;

/** 2s, 4s, 8s, … capped at 10 minutes. Deterministic so it can be tested. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS);
}

export type OutboxEvent =
  | {
      type: 'enqueue';
      formId: string;
      reportDate: string;
      answers: Record<string, unknown>;
      clientRef: string;
      now: number;
    }
  | { type: 'sendStart'; key: string; now: number }
  | {
      type: 'sendSuccess';
      key: string;
      version: number;
      serverId: string;
      serverStatus: 'submitted' | 'excused';
      isLate: boolean;
      deadlineAt?: string | null;
      submittedAt?: string | null;
      lateMinutes?: number | null;
      now: number;
    }
  | {
      type: 'sendFailure';
      key: string;
      version: number;
      error: string;
      permanent: boolean;
      now: number;
    }
  | { type: 'retryNow'; key: string; now: number }
  | { type: 'forget'; key: string }
  | { type: 'rehydrate'; now: number };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function outboxReducer(state: OutboxState, ev: OutboxEvent): OutboxState {
  switch (ev.type) {
    case 'enqueue': {
      const key = outboxKey(ev.formId, ev.reportDate);
      const cur = state.items[key];
      if (cur) {
        // identical answers already queued/sending/sent: nothing new to send
        if (same(cur.answers, ev.answers) && cur.status !== 'failed') return state;
        const item: OutboxItem = {
          ...cur,
          answers: ev.answers,
          version: cur.version + 1,
          clientRef: ev.clientRef,
          // an in-flight send keeps its status; its result is judged against `version`
          status: cur.status === 'sending' ? 'sending' : 'queued',
          attempts: 0,
          nextAttemptAt: ev.now,
          lastError: null,
          updatedAt: ev.now,
        };
        return { items: { ...state.items, [key]: item } };
      }
      const item: OutboxItem = {
        key,
        formId: ev.formId,
        reportDate: ev.reportDate,
        answers: ev.answers,
        status: 'queued',
        version: 1,
        clientRef: ev.clientRef,
        attempts: 0,
        nextAttemptAt: ev.now,
        lastError: null,
        sendingVersion: null,
        createdAt: ev.now,
        updatedAt: ev.now,
        sentAt: null,
        serverId: null,
        serverStatus: null,
        isLate: null,
        deadlineAt: null,
        submittedAt: null,
        lateMinutes: null,
      };
      return { items: { ...state.items, [key]: item } };
    }

    case 'sendStart': {
      const cur = state.items[ev.key];
      if (!cur || cur.status !== 'queued') return state;
      return {
        items: {
          ...state.items,
          [ev.key]: { ...cur, status: 'sending', sendingVersion: cur.version, updatedAt: ev.now },
        },
      };
    }

    case 'sendSuccess': {
      const cur = state.items[ev.key];
      if (!cur) return state;
      if (ev.version !== cur.version) {
        // the payload changed while this send was in flight: what the server has is stale,
        // so the current version goes out next — nothing is lost, the old result is discarded
        return {
          items: {
            ...state.items,
            [ev.key]: {
              ...cur,
              status: 'queued',
              sendingVersion: null,
              attempts: 0,
              nextAttemptAt: ev.now,
              serverId: ev.serverId,
              updatedAt: ev.now,
            },
          },
        };
      }
      return {
        items: {
          ...state.items,
          [ev.key]: {
            ...cur,
            status: 'sent',
            sendingVersion: null,
            sentAt: ev.now,
            serverId: ev.serverId,
            serverStatus: ev.serverStatus,
            isLate: ev.isLate,
            deadlineAt: ev.deadlineAt ?? null,
            submittedAt: ev.submittedAt ?? null,
            lateMinutes: ev.lateMinutes ?? null,
            lastError: null,
            updatedAt: ev.now,
          },
        },
      };
    }

    case 'sendFailure': {
      const cur = state.items[ev.key];
      if (!cur) return state;
      if (ev.version !== cur.version) {
        // stale attempt failed; the newer version is queued already
        return {
          items: {
            ...state.items,
            [ev.key]: {
              ...cur,
              status: cur.status === 'sending' ? 'queued' : cur.status,
              sendingVersion: null,
              updatedAt: ev.now,
            },
          },
        };
      }
      const attempts = cur.attempts + 1;
      return {
        items: {
          ...state.items,
          [ev.key]: {
            ...cur,
            status: ev.permanent ? 'failed' : 'queued',
            sendingVersion: null,
            attempts,
            nextAttemptAt: ev.permanent ? Number.POSITIVE_INFINITY : ev.now + backoffMs(attempts),
            lastError: ev.error,
            updatedAt: ev.now,
          },
        },
      };
    }

    case 'retryNow': {
      const cur = state.items[ev.key];
      if (!cur || cur.status === 'sent' || cur.status === 'sending') return state;
      return {
        items: {
          ...state.items,
          [ev.key]: { ...cur, status: 'queued', nextAttemptAt: ev.now, updatedAt: ev.now },
        },
      };
    }

    case 'forget': {
      const items = { ...state.items };
      delete items[ev.key];
      return { items };
    }

    case 'rehydrate': {
      // the app died mid-send: nothing can still be in flight. Back to queued, due now.
      let changed = false;
      const items = { ...state.items };
      for (const [k, it] of Object.entries(items)) {
        if (it.status === 'sending') {
          items[k] = {
            ...it,
            status: 'queued',
            sendingVersion: null,
            nextAttemptAt: ev.now,
            updatedAt: ev.now,
          };
          changed = true;
        }
      }
      return changed ? { items } : state;
    }
  }
}

/** Items that should be sent now. */
export function dueItems(state: OutboxState, now: number): OutboxItem[] {
  return Object.values(state.items).filter(
    (it) => it.status === 'queued' && it.nextAttemptAt <= now,
  );
}

/** When the next queued item becomes due (ms from now), or null. */
export function nextDueIn(state: OutboxState, now: number): number | null {
  const queued = Object.values(state.items).filter(
    (it) => it.status === 'queued' && Number.isFinite(it.nextAttemptAt),
  );
  if (!queued.length) return null;
  return Math.max(0, Math.min(...queued.map((it) => it.nextAttemptAt)) - now);
}

export const pendingCount = (state: OutboxState) =>
  Object.values(state.items).filter((it) => it.status === 'queued' || it.status === 'sending')
    .length;

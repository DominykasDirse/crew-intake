// Every case is one of the ways a report could be lost. None of them lose it.
import {
  backoffMs,
  BACKOFF_CAP_MS,
  dueItems,
  emptyOutbox,
  nextDueIn,
  outboxKey,
  type OutboxState,
  outboxReducer,
} from '@/offline/outbox';

const T0 = 1_757_000_000_000;
const answers = { worked_today: true, overall: 4, catering_ok: true };
const enqueue = (s: OutboxState, a = answers, ref = 'ref-1', now = T0) =>
  outboxReducer(s, {
    type: 'enqueue',
    formId: 'f',
    reportDate: '2026-09-06',
    answers: a,
    clientRef: ref,
    now,
  });
const KEY = outboxKey('f', '2026-09-06');

describe('outbox: an answer that reached review is never lost', () => {
  it('no signal: the send fails with a network error, the item stays queued with its answers and retries', () => {
    let s = enqueue(emptyOutbox());
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    s = outboxReducer(s, {
      type: 'sendFailure',
      key: KEY,
      version: 1,
      error: 'Network request failed',
      permanent: false,
      now: T0 + 100,
    });
    const it = s.items[KEY]!;
    expect(it.status).toBe('queued');
    expect(it.answers).toEqual(answers);
    expect(it.attempts).toBe(1);
    expect(it.nextAttemptAt).toBe(T0 + 100 + backoffMs(1));
    expect(dueItems(s, T0 + 100)).toHaveLength(0);
    expect(dueItems(s, T0 + 100 + backoffMs(1))).toHaveLength(1);
  });

  it('aeroplane mode for an hour: backoff doubles and is capped, so the item is due again within 10 minutes of any wake-up', () => {
    let s = enqueue(emptyOutbox());
    let now = T0;
    for (let i = 1; i <= 12; i++) {
      s = outboxReducer(s, { type: 'sendStart', key: KEY, now });
      s = outboxReducer(s, {
        type: 'sendFailure',
        key: KEY,
        version: 1,
        error: 'offline',
        permanent: false,
        now,
      });
      now = s.items[KEY]!.nextAttemptAt;
    }
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([2_000, 4_000, 8_000, 16_000]);
    expect(backoffMs(12)).toBe(BACKOFF_CAP_MS);
    expect(s.items[KEY]!.status).toBe('queued');
    expect(s.items[KEY]!.answers).toEqual(answers);
    expect(nextDueIn(s, now)).toBe(0);
    expect(nextDueIn(s, now - 1)).toBe(1);
  });

  it('app killed mid-send: on rehydrate a "sending" item goes back to queued, due now — nothing stays stuck', () => {
    let s = enqueue(emptyOutbox());
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    expect(s.items[KEY]!.status).toBe('sending');
    // process dies here; the persisted state is reloaded later
    s = outboxReducer(s, { type: 'rehydrate', now: T0 + 60_000 });
    expect(s.items[KEY]!.status).toBe('queued');
    expect(s.items[KEY]!.sendingVersion).toBeNull();
    expect(dueItems(s, T0 + 60_000).map((i) => i.key)).toEqual([KEY]);
  });

  it('server 500: treated as transient — queued with backoff, answers kept', () => {
    let s = enqueue(emptyOutbox());
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    s = outboxReducer(s, {
      type: 'sendFailure',
      key: KEY,
      version: 1,
      error: 'HTTP 500',
      permanent: false,
      now: T0,
    });
    expect(s.items[KEY]!.status).toBe('queued');
    expect(s.items[KEY]!.lastError).toBe('HTTP 500');
  });

  it('server says no (4xx, e.g. editing closed): marked failed, answers retained, not retried on its own, retryable by hand', () => {
    let s = enqueue(emptyOutbox());
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    s = outboxReducer(s, {
      type: 'sendFailure',
      key: KEY,
      version: 1,
      error: 'editing closed',
      permanent: true,
      now: T0,
    });
    expect(s.items[KEY]!.status).toBe('failed');
    expect(s.items[KEY]!.answers).toEqual(answers);
    expect(dueItems(s, T0 + 24 * 3_600_000)).toHaveLength(0);
    s = outboxReducer(s, { type: 'retryNow', key: KEY, now: T0 + 1 });
    expect(dueItems(s, T0 + 1)).toHaveLength(1);
  });

  it('the same report submitted twice from a retry: one item, one clientRef — the server sees the same ref and does nothing', () => {
    let s = enqueue(emptyOutbox(), answers, 'ref-1');
    s = enqueue(s, answers, 'ref-2'); // review screen tapped Send again with identical answers
    expect(Object.keys(s.items)).toEqual([KEY]);
    expect(s.items[KEY]!.version).toBe(1);
    expect(s.items[KEY]!.clientRef).toBe('ref-1');
    // a timed-out send that actually committed, then retried with the same ref
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    s = outboxReducer(s, {
      type: 'sendFailure',
      key: KEY,
      version: 1,
      error: 'timeout',
      permanent: false,
      now: T0,
    });
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 + backoffMs(1) });
    expect(s.items[KEY]!.clientRef).toBe('ref-1'); // the retry carries the ref the server already recorded
  });

  it('edit made while the earlier version is still in flight: the newer answers win and are sent exactly once more', () => {
    let s = enqueue(emptyOutbox(), answers, 'ref-1');
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    const edited = { ...answers, overall: 2 };
    s = enqueue(s, edited, 'ref-2', T0 + 10); // person edits while v1 is on the wire
    expect(s.items[KEY]!.version).toBe(2);
    expect(s.items[KEY]!.status).toBe('sending'); // v1 still in flight
    expect(s.items[KEY]!.answers).toEqual(edited);
    // v1 completes: the server now holds the OLD answers → not "sent"; v2 is queued immediately
    s = outboxReducer(s, {
      type: 'sendSuccess',
      key: KEY,
      version: 1,
      serverId: 'sub-1',
      serverStatus: 'submitted',
      isLate: false,
      now: T0 + 20,
    });
    expect(s.items[KEY]!.status).toBe('queued');
    expect(s.items[KEY]!.answers).toEqual(edited);
    expect(dueItems(s, T0 + 20)).toHaveLength(1);
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 + 20 });
    s = outboxReducer(s, {
      type: 'sendSuccess',
      key: KEY,
      version: 2,
      serverId: 'sub-1',
      serverStatus: 'submitted',
      isLate: false,
      now: T0 + 30,
    });
    expect(s.items[KEY]!.status).toBe('sent');
    expect(s.items[KEY]!.clientRef).toBe('ref-2');
  });

  it('edit made while the earlier version is still unsent (queued): replaces it, only the newest goes out', () => {
    let s = enqueue(emptyOutbox(), answers, 'ref-1');
    s = enqueue(s, { ...answers, overall: 1 }, 'ref-2', T0 + 5);
    expect(Object.keys(s.items)).toHaveLength(1);
    expect(s.items[KEY]!.status).toBe('queued');
    expect(s.items[KEY]!.version).toBe(2);
    expect(s.items[KEY]!.answers.overall).toBe(1);
    expect(s.items[KEY]!.attempts).toBe(0);
  });

  it('a failed send of v1 followed by an edit: the edit re-queues with fresh backoff', () => {
    let s = enqueue(emptyOutbox(), answers, 'ref-1');
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    s = outboxReducer(s, {
      type: 'sendFailure',
      key: KEY,
      version: 1,
      error: 'editing closed',
      permanent: true,
      now: T0,
    });
    s = enqueue(s, { ...answers, overall: 5 }, 'ref-2', T0 + 1);
    expect(s.items[KEY]!.status).toBe('queued');
    expect(s.items[KEY]!.nextAttemptAt).toBe(T0 + 1);
  });

  it('success records the server result for the Submitted screen; forgetting removes the item', () => {
    let s = enqueue(emptyOutbox());
    s = outboxReducer(s, { type: 'sendStart', key: KEY, now: T0 });
    s = outboxReducer(s, {
      type: 'sendSuccess',
      key: KEY,
      version: 1,
      serverId: 'sub-9',
      serverStatus: 'excused',
      isLate: true,
      now: T0 + 1,
    });
    expect(s.items[KEY]).toMatchObject({
      status: 'sent',
      serverId: 'sub-9',
      serverStatus: 'excused',
      isLate: true,
      sentAt: T0 + 1,
    });
    s = outboxReducer(s, { type: 'forget', key: KEY });
    expect(s.items[KEY]).toBeUndefined();
  });

  it('two different dates are independent items', () => {
    let s = enqueue(emptyOutbox());
    s = outboxReducer(s, {
      type: 'enqueue',
      formId: 'f',
      reportDate: '2026-09-05',
      answers,
      clientRef: 'ref-b',
      now: T0,
    });
    expect(Object.keys(s.items).sort()).toEqual([outboxKey('f', '2026-09-05'), KEY].sort());
  });
});

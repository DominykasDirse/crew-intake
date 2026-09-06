// A photo taken at 01:00 in a loading bay with no signal. None of these lose it.
import { backoffMs } from '@/offline/outbox';
import {
  dueUploads,
  emptyUploads,
  photosFor,
  unfinishedCount,
  uploadsReducer,
  type UploadsState,
} from '@/offline/uploads';

const T0 = 1_757_000_000_000;
const add = (s: UploadsState, id = 'p1', questionKey = 'fault_photo', now = T0) =>
  uploadsReducer(s, {
    type: 'add',
    now,
    item: {
      id,
      formId: 'f',
      reportDate: '2026-09-06',
      questionKey,
      questionId: `q-${questionKey}`,
      localUri: `file:///photos/${id}.jpg`,
      filename: 'IMG_0001.jpg',
      mime: 'image/jpeg',
      bytes: 180_000,
      width: 1600,
      height: 1200,
    },
  });
const yes = () => true;
const no = () => false;

describe('photo upload queue', () => {
  it('taken offline before the report is submitted: queued, and it waits for the report to exist on the server', () => {
    const s = add(emptyUploads());
    expect(s.items.p1!.status).toBe('queued');
    expect(dueUploads(s, T0, no)).toHaveLength(0); // report not sent yet → nothing to attach to
    expect(dueUploads(s, T0, yes)).toHaveLength(1); // the moment the outbox has sent it
  });

  it('submitting offline with a photo attached: the report is never blocked by the upload', () => {
    const s = add(emptyUploads());
    expect(unfinishedCount(s, 'f', '2026-09-06')).toBe(1); // shown as "1 photo still uploading", nothing else waits
  });

  it('no signal during upload: back to queued with backoff, file kept', () => {
    let s = add(emptyUploads());
    s = uploadsReducer(s, { type: 'uploadStart', id: 'p1', now: T0 });
    s = uploadsReducer(s, {
      type: 'uploadFailure',
      id: 'p1',
      error: 'Network request failed',
      permanent: false,
      now: T0,
    });
    expect(s.items.p1).toMatchObject({
      status: 'queued',
      attempts: 1,
      localUri: 'file:///photos/p1.jpg',
      nextAttemptAt: T0 + backoffMs(1),
    });
  });

  it('app killed mid-upload: rehydrate returns "uploading" to queued, due now', () => {
    let s = add(emptyUploads());
    s = uploadsReducer(s, { type: 'uploadStart', id: 'p1', now: T0 });
    s = uploadsReducer(s, { type: 'rehydrate', now: T0 + 5 });
    expect(s.items.p1!.status).toBe('queued');
    expect(dueUploads(s, T0 + 5, yes).map((i) => i.id)).toEqual(['p1']);
  });

  it('Storage refuses (permanent): failed, kept, retryable by hand', () => {
    let s = add(emptyUploads());
    s = uploadsReducer(s, { type: 'uploadStart', id: 'p1', now: T0 });
    s = uploadsReducer(s, {
      type: 'uploadFailure',
      id: 'p1',
      error: 'mime type not allowed',
      permanent: true,
      now: T0,
    });
    expect(s.items.p1!.status).toBe('failed');
    expect(dueUploads(s, T0 + 3_600_000, yes)).toHaveLength(0);
    s = uploadsReducer(s, { type: 'retryNow', id: 'p1', now: T0 + 1 });
    expect(dueUploads(s, T0 + 1, yes)).toHaveLength(1);
  });

  it('stored: keeps storagePath + attachmentId so Drive state can be read back from the row', () => {
    let s = add(emptyUploads());
    s = uploadsReducer(s, { type: 'uploadStart', id: 'p1', now: T0 });
    s = uploadsReducer(s, {
      type: 'uploadSuccess',
      id: 'p1',
      storagePath: 'u/s/fault_photo/p1.jpg',
      attachmentId: 'att-1',
      now: T0 + 9,
    });
    expect(s.items.p1).toMatchObject({
      status: 'stored',
      storagePath: 'u/s/fault_photo/p1.jpg',
      attachmentId: 'att-1',
    });
    expect(unfinishedCount(s, 'f', '2026-09-06')).toBe(0);
  });

  it('report edited before the photo uploaded: the photo stays queued and still attaches to the same report', () => {
    let s = add(emptyUploads());
    // the edit keeps fault=yes, so fault_photo is still visible: nothing changes for the photo
    s = uploadsReducer(s, {
      type: 'pruneHidden',
      formId: 'f',
      reportDate: '2026-09-06',
      visibleKeys: ['worked_today', 'fault', 'fault_note', 'fault_photo', 'catering_ok'],
    });
    expect(s.items.p1!.status).toBe('queued');
  });

  it('report edited so the photo question is hidden (fault → no): an un-uploaded photo is dropped, an uploaded one is kept', () => {
    let s = add(add(emptyUploads(), 'p1'), 'p2');
    s = uploadsReducer(s, { type: 'uploadStart', id: 'p2', now: T0 });
    s = uploadsReducer(s, {
      type: 'uploadSuccess',
      id: 'p2',
      storagePath: 'u/s/fault_photo/p2.jpg',
      attachmentId: 'att-2',
      now: T0,
    });
    s = uploadsReducer(s, {
      type: 'pruneHidden',
      formId: 'f',
      reportDate: '2026-09-06',
      visibleKeys: ['worked_today', 'fault', 'catering_ok'],
    });
    expect(s.items.p1).toBeUndefined();
    expect(s.items.p2!.status).toBe('stored');
  });

  it('photos are per question and per day', () => {
    let s = add(emptyUploads(), 'a', 'fault_photo');
    s = add(s, 'b', 'other_photo');
    expect(photosFor(s, 'f', '2026-09-06', 'fault_photo').map((i) => i.id)).toEqual(['a']);
    expect(photosFor(s, 'f', '2026-09-06').map((i) => i.id)).toEqual(['a', 'b']);
    expect(photosFor(s, 'f', '2026-09-05')).toHaveLength(0);
  });
});

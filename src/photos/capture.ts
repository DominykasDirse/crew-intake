// Take or pick a photo, shrink it on the device, strip everything but pixels, and keep a
// copy in the app's document directory (a picker/cache URI can be reclaimed by the OS).
//
// A 12 MP phone photo (~4–6 MB) becomes ~150–300 KB at 1600 px / JPEG 0.7. Re-encoding
// through expo-image-manipulator drops all EXIF, GPS included — location is never
// collected silently (requirement 8).
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

export const MAX_EDGE = 1600;
export const JPEG_QUALITY = 0.7;

export type CapturedPhoto = {
  id: string;
  localUri: string;
  filename: string;
  mime: 'image/jpeg';
  bytes: number;
  width: number;
  height: number;
};

export type CaptureOutcome =
  | { ok: true; photo: CapturedPhoto }
  | { ok: false; reason: 'cancelled' | 'permission' | 'error'; message?: string };

function photosDir(): Directory {
  const dir = new Directory(Paths.document, 'photos');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function shrinkAndKeep(asset: ImagePicker.ImagePickerAsset): Promise<CapturedPhoto> {
  const longEdge = Math.max(asset.width || 0, asset.height || 0);
  const actions =
    longEdge > MAX_EDGE
      ? [
          asset.width >= asset.height
            ? { resize: { width: MAX_EDGE } }
            : { resize: { height: MAX_EDGE } },
        ]
      : [];
  // re-encode even when small: that is what drops the EXIF
  const out = await manipulateAsync(asset.uri, actions, {
    compress: JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });
  const id = newId();
  const dest = new File(photosDir(), `${id}.jpg`);
  new File(out.uri).copy(dest);
  return {
    id,
    localUri: dest.uri,
    filename: (asset.fileName ?? `IMG_${id.slice(0, 8)}.jpg`).replace(/\.[a-z0-9]+$/i, '.jpg'),
    mime: 'image/jpeg',
    bytes: dest.size ?? 0,
    width: out.width,
    height: out.height,
  };
}

async function fromResult(res: ImagePicker.ImagePickerResult): Promise<CaptureOutcome> {
  if (res.canceled) return { ok: false, reason: 'cancelled' };
  const asset = res.assets[0];
  if (!asset) return { ok: false, reason: 'cancelled' };
  try {
    return { ok: true, photo: await shrinkAndKeep(asset) };
  } catch (e) {
    return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}

export async function takePhoto(): Promise<CaptureOutcome> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'permission' };
  return fromResult(
    await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
      allowsEditing: false,
    }),
  );
}

export async function pickPhoto(): Promise<CaptureOutcome> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return { ok: false, reason: 'permission' };
  return fromResult(
    await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
      exif: false,
      allowsMultipleSelection: false,
    }),
  );
}

/** Removes the local copy; ignores a file that is already gone. */
export function deleteLocal(localUri: string) {
  try {
    const f = new File(localUri);
    if (f.exists) f.delete();
  } catch {
    /* already gone */
  }
}

export async function readBytes(localUri: string): Promise<Uint8Array> {
  return new File(localUri).bytes();
}

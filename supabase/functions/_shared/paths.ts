// Drive path builder. Pure: no I/O, no Deno APIs — shared by the Edge Functions and the
// Jest tests in tests/drivePath.test.ts.
//
//   ROOT/{code name}/reports/{date city}/{Group}/{Lastname_Firstname}/{date}_{HHmm}__{key}__{original}
//   ROOT/{code name}/invoices/{Lastname_Firstname}/{date}_{HHmm}__invoice__{original}
//   ROOT/backups/{date}/{table}.json
//
// Every folder in a chain carries the STABLE identity it is cached under (drive_folders):
// never its name. Names are recomputed each time; if the cached name differs, the folder
// is renamed on Drive (C1).

export const MAX_SEGMENT = 120;
export const UNASSIGNED_TOUR = '_unassigned';
export const NO_GROUP = '_nogroup';
export const INVOICE_KEY = 'invoice';

export function sanitizeSegment(raw: string | null | undefined, fallback = '_'): string {
  let s = (raw ?? '')
    .normalize('NFC')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[/\\]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '')
    .trim();
  if (s.length > MAX_SEGMENT) s = s.slice(0, MAX_SEGMENT).trim();
  return s.length ? s : fallback;
}

/** "Vaitkus_Jonas"; inner spaces and underscores become hyphens so the two parts stay separable. */
export function personFolder(firstName: string, lastName: string): string {
  const part = (x: string) => sanitizeSegment(x, 'unknown').replace(/[\s_]+/g, '-');
  return `${part(lastName)}_${part(firstName)}`;
}

export function tourFolder(tour: { code: string; name: string } | null): string {
  if (!tour) return UNASSIGNED_TOUR;
  return sanitizeSegment(`${tour.code} ${tour.name}`);
}

/** "{date} {city}" or, with no show that day, just "{date}" (Q8). */
export function dateFolder(reportDate: string, city?: string | null): string {
  const c = city?.trim() ? sanitizeSegment(city) : '';
  return c ? `${reportDate} ${c}` : reportDate;
}

/** {date}_{HHmm}__{question key}__{original filename} */
export function fileName(
  o: { date: string; time: string; questionKey: string; original: string },
): string {
  return `${o.date}_${o.time}__${o.questionKey}__${sanitizeSegment(o.original, 'file')}`;
}

/** HHmm in the person's local timezone, 24-hour. */
export function localTimeHHmm(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const pick = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${pick('hour')}${pick('minute')}`;
}

/** yyyy-mm-dd in a timezone. */
export function localDate(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const pick = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export type FolderKind =
  | 'tour'
  | 'reports'
  | 'invoices'
  | 'date'
  | 'group'
  | 'person'
  | 'backups'
  | 'backup_date';

export type ChainNode = {
  kind: FolderKind;
  name: string;
  tour_id: string | null;
  group_id: string | null;
  user_id: string | null;
  report_date: string | null;
};

const node = (
  kind: FolderKind,
  name: string,
  ids: Partial<Omit<ChainNode, 'kind' | 'name'>> = {},
): ChainNode => ({
  kind,
  name,
  tour_id: ids.tour_id ?? null,
  group_id: ids.group_id ?? null,
  user_id: ids.user_id ?? null,
  report_date: ids.report_date ?? null,
});

export type TourRef = { id: string; code: string; name: string } | null;
export type PersonRef = { user_id: string; first_name: string; last_name: string };

export function reportChain(i: {
  tour: TourRef;
  reportDate: string;
  city?: string | null;
  group: { id: string; name_en: string } | null;
  person: PersonRef;
}): ChainNode[] {
  const tour_id = i.tour?.id ?? null;
  const group_id = i.group?.id ?? null;
  return [
    node('tour', tourFolder(i.tour), { tour_id }),
    node('reports', 'reports', { tour_id }),
    node('date', dateFolder(i.reportDate, i.city), { tour_id, report_date: i.reportDate }),
    node('group', i.group ? sanitizeSegment(i.group.name_en) : NO_GROUP, {
      tour_id,
      group_id,
      report_date: i.reportDate,
    }),
    node('person', personFolder(i.person.first_name, i.person.last_name), {
      tour_id,
      group_id,
      user_id: i.person.user_id,
      report_date: i.reportDate,
    }),
  ];
}

export function invoiceChain(i: { tour: TourRef; person: PersonRef }): ChainNode[] {
  const tour_id = i.tour?.id ?? null;
  return [
    node('tour', tourFolder(i.tour), { tour_id }),
    node('invoices', 'invoices', { tour_id }),
    node('person', personFolder(i.person.first_name, i.person.last_name), {
      tour_id,
      user_id: i.person.user_id,
    }),
  ];
}

export function backupChain(date: string): ChainNode[] {
  return [node('backups', 'backups'), node('backup_date', date, { report_date: date })];
}

/** For logs and the sync-health screen: the human path under ROOT. */
export const chainPath = (chain: ChainNode[]) => chain.map((n) => n.name).join('/');

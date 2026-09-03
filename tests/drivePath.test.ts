import {
  backupChain,
  chainPath,
  dateFolder,
  fileName,
  invoiceChain,
  localTimeHHmm,
  personFolder,
  reportChain,
  sanitizeSegment,
  tourFolder,
} from '../supabase/functions/_shared/paths';

const tour = { id: 't1', code: 'T1', name: 'Tour 1' };
const crew = { id: 'g1', name_en: 'Crew' };
const jonas = { user_id: 'u1', first_name: 'Jonas', last_name: 'Vaitkus' };

type Identity = {
  kind: string;
  tour_id: string | null;
  group_id: string | null;
  user_id: string | null;
  report_date: string | null;
};
const identity = (n: Identity) =>
  [n.kind, n.tour_id, n.group_id, n.user_id, n.report_date].join('|');

describe('drive path builder', () => {
  it('builds the full report chain with a city', () => {
    const chain = reportChain({
      tour,
      reportDate: '2026-11-03',
      city: 'Riga',
      group: crew,
      person: jonas,
    });
    expect(chainPath(chain)).toBe('T1 Tour 1/reports/2026-11-03 Riga/Crew/Vaitkus_Jonas');
    expect(chain.map((n) => n.kind)).toEqual(['tour', 'reports', 'date', 'group', 'person']);
  });

  it('uses the date alone when there is no show that day (Q8)', () => {
    expect(dateFolder('2026-11-04', null)).toBe('2026-11-04');
    expect(dateFolder('2026-11-04', '   ')).toBe('2026-11-04');
    expect(
      chainPath(reportChain({ tour, reportDate: '2026-11-04', group: crew, person: jonas })),
    ).toBe('T1 Tour 1/reports/2026-11-04/Crew/Vaitkus_Jonas');
  });

  it('caches folders on identity, not name: same tuple whatever the name (C1)', () => {
    const a = reportChain({
      tour,
      reportDate: '2026-11-03',
      city: null,
      group: crew,
      person: jonas,
    });
    const b = reportChain({
      tour,
      reportDate: '2026-11-03',
      city: 'Riga',
      group: crew,
      person: { ...jonas, last_name: 'Vaitkienė' },
    });
    expect(a.map(identity)).toEqual(b.map(identity)); // → rename, never a second folder
    expect(a[2]?.name).toBe('2026-11-03');
    expect(b[2]?.name).toBe('2026-11-03 Riga');
    expect(b[4]?.name).toBe('Vaitkienė_Jonas');
  });

  it('person folder is Lastname_Firstname from the two columns, never split (Q9)', () => {
    expect(personFolder('Jonas', 'Vaitkus')).toBe('Vaitkus_Jonas');
    expect(personFolder('Jonas Petras', 'Van der Berg')).toBe('Van-der-Berg_Jonas-Petras');
    expect(personFolder('Anne_Marie', "O'Neil")).toBe("O'Neil_Anne-Marie");
    expect(personFolder('  ', 'X')).toBe('X_unknown');
  });

  it('tour folder is "{code} {name}" (Q7); unassigned reports go under _unassigned', () => {
    expect(tourFolder(tour)).toBe('T1 Tour 1');
    expect(tourFolder(null)).toBe('_unassigned');
    const chain = reportChain({ tour: null, reportDate: '2026-11-03', group: null, person: jonas });
    expect(chain[0]?.tour_id).toBeNull();
    expect(chainPath(chain)).toBe('_unassigned/reports/2026-11-03/_nogroup/Vaitkus_Jonas');
  });

  it('invoice chain and backup chain', () => {
    expect(chainPath(invoiceChain({ tour, person: jonas }))).toBe(
      'T1 Tour 1/invoices/Vaitkus_Jonas',
    );
    expect(invoiceChain({ tour, person: jonas })[2]).toMatchObject({
      kind: 'person',
      user_id: 'u1',
      group_id: null,
      report_date: null,
    });
    expect(chainPath(backupChain('2026-09-03'))).toBe('backups/2026-09-03');
  });

  it('file name is {date}_{HHmm}__{key}__{original}', () => {
    expect(
      fileName({
        date: '2026-11-03',
        time: '2315',
        questionKey: 'fault_photo',
        original: 'IMG_0001.jpg',
      }),
    ).toBe('2026-11-03_2315__fault_photo__IMG_0001.jpg');
    expect(
      fileName({
        date: '2026-11-03',
        time: '0012',
        questionKey: 'invoice',
        original: '../../etc/passwd',
      }),
    ).toBe('2026-11-03_0012__invoice__-..-etc-passwd');
  });

  it("local time is HHmm in the person's zone, 24h, after midnight too", () => {
    expect(localTimeHHmm(new Date('2026-11-03T21:15:00Z'), 'Europe/Vilnius')).toBe('2315'); // UTC+2 in November
    expect(localTimeHHmm(new Date('2026-11-03T22:12:00Z'), 'Europe/Vilnius')).toBe('0012');
    expect(localTimeHHmm(new Date('2026-07-03T21:15:00Z'), 'Europe/Vilnius')).toBe('0015'); // UTC+3 in July
    expect(localTimeHHmm(new Date('2026-11-03T21:15:00Z'), 'UTC')).toBe('2115');
  });

  it('sanitises segments: separators, control chars, dots, length; unicode kept', () => {
    expect(sanitizeSegment('a/b\\c')).toBe('a-b-c');
    expect(sanitizeSegment('  Šiauliai  Arena \t')).toBe('Šiauliai Arena');
    expect(sanitizeSegment('...hidden...')).toBe('hidden');
    expect(sanitizeSegment('bad\u0000name')).toBe('badname');
    expect(sanitizeSegment(' ')).toBe('_');
    expect(sanitizeSegment('x'.repeat(500)).length).toBe(120);
    expect(sanitizeSegment('', 'fallback')).toBe('fallback');
  });
});

# Crew Intake — implementation plan

Internal daily-reporting app for touring production crews. Expo + Supabase.
Repo: `~/crew-intake` (git initialised, no commits yet).

**Status: approved 2026-09-02 with corrections C1–C10 (folded in below).**

---

## 1. Scope of this first build

You asked to stop after notifications. That gives us:

| Phase | Name                                                                | In this build                                          |
| ----- | ------------------------------------------------------------------- | ------------------------------------------------------ |
| 0     | Scaffold and CI                                                     | yes                                                    |
| 1     | Schema and RLS — **all 13 tables**                                  | yes                                                    |
| 2     | Seed from `forms.seed.json` — **Crew group + one tour only**        | yes                                                    |
| 3     | `drive-sync` + `resync-drive`, tested standalone                    | yes                                                    |
| 4     | Auth and invite onboarding (single person; **no XLSX bulk import**) | yes                                                    |
| 5     | Daily report flow                                                   | yes                                                    |
| 6     | Photos + offline queue (**EXIF strip yes, location no**)            | yes                                                    |
| 7     | Invoices                                                            | **skipped**                                            |
| 8     | Notifications and scheduler                                         | yes                                                    |
| 9     | Admin calendar, dashboards, issues list                             | **skipped**                                            |
| 10    | Exports and digests                                                 | **skipped**                                            |
| 11    | Build configuration                                                 | folded into 0 and 8 (a dev build is required for push) |

Heads-up for when the weekly form is seeded: it carries `intro_en` / `intro_lt`, which
have no column today. Add `forms.intro_en`, `forms.intro_lt` in that phase's migration.

Deferred but **not** deleted: every one of the 13 tables is created in phase 1,
including `invoices`, `issues`, `audit_log`. Weekly form, invoice form, all five
groups and their forms stay in `forms.seed.json` and are seeded later by re-running
the same seed script with a wider filter — no migration will be needed.

Three things I want to flag inside the cut scope:

1. **A minimal admin surface is unavoidable.** Phases 4–8 cannot be tested without
   creating a person, a tour and an assignment. I will build the thinnest possible
   admin screens for people / tours / assignments / invite / sync-health, and nothing
   else. No calendar, no dashboards, no charts.
2. **`issues` rows still get written.** `opens_issue` fires on `fault` and `missing`
   in the Crew form from day one; only the admin _list_ is deferred. The data is
   there when you build phase 9.
3. **Nightly backup (req 12) — I recommend building it now, in phase 3.** Your own
   requirement says it must exist before real data does, and phase 4 is where real
   people get accounts. It is one small Edge Function reusing the Drive helpers we
   write in phase 3. Say the word and I will drop it; the free tier has no automatic
   backups, so without it a bad migration is unrecoverable. See open question Q13.

Skipped for now, exactly as you asked: invoices, weekly form, admin calendar and
dashboards, exports and digests, XLSX bulk import and printable QR sheets, location
capture. Location **columns** are created and location is never captured — the consent
checkbox, settings toggle and submit-time GPS point arrive with the location phase.
EXIF stripping ships in phase 6 regardless, since photos ship in phase 6.

---

## 2. Confirmed environment

Checked on this machine:

| Tool               | Version                                               |
| ------------------ | ----------------------------------------------------- |
| Node               | 26.8.1                                                |
| npm                | 11.19.0                                               |
| Supabase CLI       | 2.116.0                                               |
| EAS CLI            | 23.2.0                                                |
| Deno               | 2.9.6 (installed via brew in phase 0)                 |
| PostgreSQL         | 17 via brew, used only to validate migrations locally |
| Expo latest stable | SDK **57** (`expo@57.0.19`, React Native 0.86.3)      |

Supabase project ref `huodsskyppiuqzybkjhu` (EU). EAS project id
`52529350-6421-4916-a602-d4440e49bcec`, slug `crew-intake`.

Two environment risks, both in the open questions: Node 26 is ahead of what Expo/Metro
is routinely tested against (Q1), and Deno is missing, which only matters for running
Edge Function unit tests locally (Q2).

---

## 3. What is in `forms.seed.json`

Read and verified. 5 groups, 5 daily forms, 1 shared optional weekly form, 1 invoice form.

Groups and default notify times: orchestra 23:15, **crew 23:30**, production 23:00,
chef 21:30, driver 22:00.

Question attributes actually used: `key`, `type`, `label_en`, `label_lt`, `required`,
`visible_if` (`{question, equals}` only), `validation` (`{min, max}` on the three
`number` questions), `opens_issue` (true on `fault`, `missing`, and equivalents).
Types used across all forms: `yes_no` 24, `short_text` 17, `rating` 12, `long_text` 9,
`photo` 5, `number` 3. The invoice form adds `tour_select`, `date`, `single_choice`,
`money`, `file`.

**`closes_form_if` does not appear anywhere in the seed file.** You listed it as
something to unit-test. I read it as the `worked_today = no` behaviour, which the seed
expresses through `visible_if` on every work question. I will implement it that way and
test it under that name — see Q6.

The Crew daily form, which is the whole of this build's report flow (13 questions,
7 visible on a working day, 3 on a day off):

```
worked_today   yes_no    required
absence_reason short_text          visible_if worked_today = false
overall        rating    required  visible_if worked_today = true
setup_ok       yes_no    required  visible_if worked_today = true
setup_note     short_text          visible_if setup_ok = false
local_crew     rating    required  visible_if worked_today = true
fault          yes_no    required  visible_if worked_today = true   opens_issue
fault_note     short_text          visible_if fault = true
fault_photo    photo               visible_if fault = true
missing        yes_no    required  visible_if worked_today = true   opens_issue
missing_note   short_text          visible_if missing = true
catering_ok    yes_no    required  (always asked, worked or not)
notes          long_text           visible_if worked_today = true
```

Keys are permanent. The seed script asserts that every key it is about to write either
does not exist or matches an existing key exactly; it will refuse to rename one.

---

## 4. Data model

All 13 tables as specified. Enums: `question_type`, `submission_status`
(`draft | submitted | excused`), `invoice_status`, `issue_status`, `sync_status`,
`notification_status`, `profile_status`, `form_kind`.

### Decisions worth stating

**One report per person per date.** `submissions` carries
`unique(user_id, form_id, report_date)` as specified. Because a person belongs to one
group and therefore one daily form, this is effectively one per person per date. Shows
are context only: the report flow never requires a show to exist, so travel days, days
off and double-show days all work identically.

**Report date is the person's local date**, from `profiles.timezone`, not the server's.

**Versioning without orphaning answers.** `answers.question_id` points at an immutable
`questions` row. Publishing a new form version inserts a _new_ `forms` row (same
`group_id`, `version + 1`) and new `questions` rows; old rows are never mutated or
deleted, only `is_published` flips. Existing answers keep pointing at the questions they
were actually answered against. All reporting aggregates on `questions.key`, which is
why the key is the permanent identifier. Editing a label in place is allowed; changing a
`key` or a `type` forces a new version.

**Submission is one atomic RPC.** `submit_report(p_form_id, p_report_date, p_answers jsonb, ...)`
inserts the submission, all answers, and any `issues` rows in a single transaction, and
computes `is_late` and `status` server-side. Reason: people file these on one bar of
signal, and a half-written submission is worse than none. Retrying is safe — the unique
constraint makes it idempotent and the RPC returns the existing submission id. Drafts
live only on the phone until submit (requirement 5), so no partial rows ever reach the
server.

**`status = excused`** is set by the RPC when `worked_today = false`. Counted as filed,
never as missed, its own colour when the calendar is built.

**`is_late`** — on time if `submitted_at` is before **06:00 local on the day after
`report_date`**, late after that (C3). Load-out routinely runs past midnight, so a plain
midnight cutoff would mark honest reports late.

**Backfill** — a person can file for today and the previous **7 days**; anything older is
admin only. Every backfilled day is `is_late = true` (C4).

**Editing after submit** — allowed until the same 06:00 cutoff. `submissions.edited_at`
is set, and the previous answer values are written to `audit_log` before they are
replaced (C5). After the cutoff, admin only; the RLS policy enforces the cutoff in SQL.

**Nobody is ever hard-deleted.** Deactivating a person is `status = 'inactive'`. FKs from
`submissions`, `answers`, `invoices`, `attachments`, `issues`, `assignments` to
`profiles` are `ON DELETE RESTRICT`, stated explicitly in `0002_tables.sql` (C2).

**Extra columns (C9):** `profiles.first_name`, `profiles.last_name`, `profiles.phone`,
`tours.currency default 'EUR'`, `groups.lead_user_id`. The Drive folder is built from
`last_name`/`first_name`; `full_name` is never split (Q9).

### Indexes (for the calendar and dashboard queries you will build in phase 9)

```
submissions (user_id, report_date)            -- unique already covers part of this
submissions (report_date, status)             -- day/week/month rollups
submissions (form_id, report_date)
answers     (submission_id)
answers     (question_id)                     -- per-key trend series
assignments (tour_id, starts_on, ends_on)
assignments (user_id, starts_on, ends_on)     -- "is X expected on date D"
profiles    (group_id) where status = 'active'
attachments (sync_status, attempts) where sync_status <> 'synced'
attachments (submission_id), (invoice_id)
notifications (user_id, kind, report_date)    -- see Q11
shows       (tour_id, date)
issues      (status, assigned_to)
```

Every admin list is paginated with keyset pagination (`order by (report_date, id)`),
never `offset`.

### Row-level security

`alter table … enable row level security` on all 15, `anon` revoked outright (including
default privileges for future tables), no permissive default, and **no write policy at all**
on tables the app must not touch directly (`audit_log`, `notifications`, `invites`,
`drive_folders` are written only by triggers, `SECURITY DEFINER` functions and the service
role). `FORCE` is deliberately not used: the `SECURITY DEFINER` functions rely on the owner
bypassing policies, which is the standard Supabase pattern.

Helper: `public.is_admin()` — `SECURITY DEFINER`, `stable`, `set search_path = ''`,
reads `profiles.is_admin` for `auth.uid()`. Defining it as a function is not decoration:
a policy on `profiles` that queries `profiles` recurses.

Shape of the policies:

- `profiles` — select own row, or any row if admin. Update own row but only
  `locale`, `timezone`, `notify_at`, `push_token` (enforced by a trigger that reverts
  changes to `is_admin`, `group_id`, `status`). Admin: full.
- `submissions` / `answers` — select own; insert own; **update own until 06:00 local
  the day after `report_date`** (C5); no delete. Admin: full.
- `attachments` — select and insert own (own = attached to own submission/invoice);
  update restricted to nothing user-facing (sync columns are service-role only).
- `invoices` — select/insert/update own while `status = 'submitted'`. Admin: full.
- `forms` / `questions` — select where `is_published` and
  (`group_id = my group_id` or `group_id is null`). Admin: full.
- `groups` / `tours` / `shows` — select all (needed to render); write admin only.
- `assignments` — select own; admin full.
- `issues` — select own (via own submission); admin full.
- `notifications` — select own; write service-role only.
- `audit_log` — admin select only; no client writes.

Every policy gets a test in phase 1: a script that signs in as a normal user and asserts
it cannot read another person's submission, cannot see another group's form, and cannot
update its own submission after submitting.

### Schema additions I need permission for

The 13 tables do not quite cover three mechanisms you asked for. Rather than bend them
into a column that means something else, I want to add three small things — Q10, Q11, Q12:

- **`invites`** (`id, user_id, token_hash, expires_at, used_at, created_by, created_at`).
  Requirement 11 needs a single-use, short-lived, hashed token, usable as a link _or_ a
  QR code off the same token. There is nowhere to put it today. Storing the raw token
  anywhere is not acceptable; we store a SHA-256 hash and show the raw value exactly once.
- **`drive_folders`** keyed on a **stable tuple**, not a path:
  `(tour_id, user_id, kind, report_date)` with `folder_id`, `last_name_seen`. The
  `drive.file` scope means the Edge Function can only _see_ files and folders it created
  itself. Keying on the tuple means a person changing their name results in a Drive
  **rename** of their existing folder, never a second folder that splits their files (C1).
- **`notifications.report_date date`**. Requirement 7 needs "one push, one follow-up two
  hours later, then stop", deduped per person per day. A crew member notified at 23:30
  gets the follow-up at 01:30 the _next_ calendar day for the _previous_ report date;
  without this column the dedupe key is wrong at exactly the hour it matters most.

---

## 5. Drive sync

**Flow.** App uploads to Supabase Storage → row inserted in `attachments` with
`sync_status = 'pending'` → Postgres webhook (`pg_net`) calls the `drive-sync` Edge
Function → function downloads from Storage, resolves/creates the folder chain, uploads
to Drive, writes back `drive_file_id`, `drive_url`, `sync_status = 'synced'`.
On failure: `sync_status = 'failed'`, `sync_error`, `attempts + 1`. A cron function
retries `failed` rows with `attempts < 5`.

`drive_file_id` is stored so a retry issues a Drive **update** (`PATCH /upload/drive/v3/files/{id}`)
rather than a create — retries never duplicate.

**Credentials.** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`,
`DRIVE_ROOT_FOLDER_ID` are read from `Deno.env` inside Edge Functions only. They are
never imported into the app, never written to `app.json` / `app.config.ts` / `.env` that
Expo reads, and `.gitignore` plus a CI grep step will fail the build if any of those four
names appears outside `supabase/functions/`. The app bundle is public; it will contain
only the Supabase URL and the anon key.

**Paths.**

```
ROOT/{tour}/reports/{date} {city}/{group}/{Lastname_Firstname}/
ROOT/{tour}/invoices/{Lastname_Firstname}/
filename: {date}_{time}__{question key}__{original filename}
```

Four things here are underspecified — Q7, Q8, Q9:

- `{tour}` — `tours` has both `code` and `name`. Default: `{code} {name}`, e.g. `T26 Bocelli EU`.
- `{city}` — comes from `shows` for that tour+date, which is optional. Default: on a date
  with no show, the folder is just `{date}` with no trailing space. With two shows, the
  lowest `sequence` wins.
- `{Lastname_Firstname}` — from `profiles.last_name` and `profiles.first_name`, spaces
  inside each part turned into hyphens. `full_name` is never split (Q9/C9).
- `{time}` — `HHmm` in the person's local timezone at submit.

Everything is sanitised: control characters and `/` `\` stripped, whitespace collapsed,
leading/trailing dots removed, truncated to 120 chars per segment, original extension kept.
The path builder is a pure function with unit tests, shared verbatim between `drive-sync`
and `resync-drive`.

**`resync-drive`** — admin-triggered, your migration tool. Walks every `attachments` row
in batches, rebuilds the path against the Drive root that is configured _now_, re-uploads,
and writes the new `drive_file_id`. Clears the `drive_folders` cache first so the tree is
rebuilt under the new root. Runs as a resumable job (cursor in the audit log) so a timeout
does not mean starting over.

**Phase 3 is tested standalone**, before any app code touches it: a script inserts a
fixture attachment, invokes the function locally, and I show you the resulting Drive tree.

---

### Phase 3 outcome (2026-09-03)

- **Drive access probe: A, with a nuance.** With `drive.file`, the app can _create_ under
  the hand-made root folder (parents = `DRIVE_ROOT_FOLDER_ID`) but `files.get` on that
  folder returns 404 — it can write into it, not read or list it. Everything below the
  root is app-created and therefore visible. `drive-probe` stays deployed as a diagnostic.
- **Webhook without secrets in SQL.** `attachments` after-insert → `call_edge_function()`
  → `pg_net`, with the service-role key read from **Vault** (`service_role_key`). Until that
  Vault entry exists the trigger logs a warning and does nothing; `retry-sync` (pg_cron,
  every 10 min) picks up `pending` rows older than 5 minutes anyway, so a missed webhook
  heals itself.
- **Functions:** `drive-sync`, `retry-sync`, `resync-drive` (batched, cursor, moves files
  Storage no longer holds), `backup-db` (JSON per table + `auth_users` ids/emails +
  manifest, 30-day retention, `fetch` for restores), `drive-probe`.
- **Proven live:** `scripts/sync-test.ts` — upload, exact path, rename-not-duplicate (C1),
  resync, backup run + fetch. `scripts/restore-proof.ts` restored that backup into a
  scratch Postgres with the same migrations: every table count matched, all FKs held (C7).
- **Seed bug found and fixed:** `diff.ts` compared `visible_if` with raw `JSON.stringify`;
  `jsonb` reorders keys, so a plain re-run claimed a structural change and, with
  `--allow-new-version`, created crew/daily **v2** (identical) and unpublished v1. Fixed with
  key-canonical comparison + regression test. Nothing references either version.

## 6. Offline behaviour (phase 6)

- **Drafts** — every answer change writes to persistent device storage, keyed by
  `(form_id, report_date)`. Kill the app mid-report, reopen, everything is there.
- **Upload queue** — a persisted list of jobs `{id, localUri, questionKey, submissionId,
attempts, nextAttemptAt, status}`. Photos are copied into app documents storage
  immediately (a `cacheDirectory` URI from the image picker can be reclaimed by iOS at
  any time). The queue survives restart, drains on app foreground and on network regain,
  and backs off `2^n` seconds capped at one hour.
- The reducer is a pure function — `queueReducer(state, event)` — and is unit tested for
  restart, backoff, permanent failure, and duplicate enqueue.
- **EXIF** — every photo goes through `expo-image-manipulator` (resize to max 1600px,
  JPEG q0.7) before it is queued. That re-encode drops all EXIF including GPS. No photo
  ever carries a location, which is the point: location must be something you choose,
  not something that leaks.

---

## 7. Notifications (phase 8)

`notify-daily` runs on cron every 15 minutes. In one SQL statement it finds every person who:

- is `active`, has a `push_token`, and has an `assignments` row covering **their local
  today** on a tour with `is_active`,
- whose local time is at or past `coalesce(profiles.notify_at, groups.notify_at)`,
- has no `submissions` row for that `report_date` (any status — `excused` counts as filed),
- and has no `notifications` row for `(user_id, kind, report_date)`.

Sends via Expo Push (`https://exp.host/--/api/v2/push/send`, chunked at 100, receipts
checked on the next run, `DeviceNotRegistered` clears the token). Follow-up: same query
with `kind = 'daily_followup'`, `notify_at + 2h`, requiring the first to have been sent
and still no submission. Then it stops. Every send, failure and receipt is a row in
`notifications`.

Local time is computed in Postgres as `(now() at time zone profiles.timezone)`, so DST
is handled by the tz database, not by us. The same rule is mirrored in a pure TS function
`isNotificationDue(profile, now)` which is unit-tested across Europe/Vilnius,
Europe/Berlin, a DST switch weekend, and a 23:30 notify time whose follow-up lands after
midnight — the case most likely to double-send.

Admin broadcast to a group or tour ships as a small screen plus a `broadcast` function.
Weekly push is wired but inert until the weekly form is seeded.

---

## 8. File tree

```
crew-intake/
├── app/                                  expo-router
│   ├── _layout.tsx                       providers: Query, i18n, Sentry, auth gate
│   ├── index.tsx                         route by session + is_admin
│   ├── (auth)/sign-in.tsx  claim.tsx  scan.tsx
│   ├── (app)/
│   │   ├── _layout.tsx                   tabs: Today · History · Settings
│   │   ├── today.tsx                     the one screen that matters
│   │   ├── report/[date].tsx             form runner
│   │   ├── history.tsx                   own filed/excused/missed only
│   │   └── settings.tsx                  language, notify time, sign out
│   └── (admin)/                          is_admin only, minimal
│       ├── people/{index,new,[id]}.tsx
│       ├── invite/[id].tsx               link + QR off one token
│       ├── tours.tsx  assignments.tsx
│       ├── broadcast.tsx  sync.tsx
├── src/
│   ├── api/          supabase.ts, queries/*.ts (TanStack)
│   ├── components/   RatingBlocks YesNo PhotoField NumberField TextField SubmitBar
│   ├── forms/        runner.tsx, visibility.ts, zodFromQuestions.ts
│   ├── offline/      queue.ts (reducer), uploader.ts, drafts.ts
│   ├── lib/          drivePath.ts dates.ts compliance.ts notifyDue.ts sanitize.ts
│   ├── store/        session.ts settings.ts
│   ├── i18n/         index.ts en.json lt.json
│   └── types/        database.types.ts  (generated, committed)
├── supabase/
│   ├── migrations/
│   │   ├── 0001_extensions_enums.sql
│   │   ├── 0002_tables.sql               all 13 + invites + drive_folders
│   │   ├── 0003_indexes.sql
│   │   ├── 0004_rls.sql
│   │   ├── 0005_functions.sql            is_admin, submit_report, invites, audit triggers
│   │   ├── 0006_drive_webhook.sql
│   │   └── 0007_cron.sql
│   ├── seed/seed.ts                      reads ../../forms.seed.json
│   └── functions/
│       ├── _shared/{drive,expo,paths,auth,cors}.ts
│       ├── drive-sync/  resync-drive/  retry-sync/
│       ├── notify-daily/  broadcast/
│       ├── create-person/  claim-invite/
│       └── backup-db/                    (see Q13)
├── tests/            visibility  validation  drivePath  queue  notifyDue  compliance
├── .github/workflows/ci.yml
├── app.config.ts  eas.json  tsconfig.json  eslint.config.js
├── forms.seed.json
└── PLAN.md
```

---

## 9. Tests

Pure logic only, `jest` + `ts-jest`, no device needed:

| Test         | Covers                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| `visibility` | `visible_if` chains, cascade hide (`fault=false` hides note _and_ photo), stale answers dropped on hide |
| `closesForm` | `worked_today=false` → 3 visible questions → `EXCUSED` (see Q6)                                         |
| `validation` | zod built from `required` + `validation.min/max`, per type                                              |
| `drivePath`  | all four path variables, missing city, two shows, unicode names, sanitisation, filename format          |
| `queue`      | reducer: enqueue, backoff, restart rehydration, max attempts, dedupe                                    |
| `notifyDue`  | notify_at across Vilnius/Berlin, DST switch, 23:30 → follow-up after midnight                           |
| `compliance` | filed/excused/missed against `assignments`, not the roster; unassigned days are neither                 |

CI (`.github/workflows/ci.yml`): `tsc --noEmit`, `eslint`, `jest`, and a grep that fails
if any Google secret name appears outside `supabase/functions/`.

---

## 10. Dependencies I must ask about

Everything you listed is used as listed. These are needed but not on your list — I will
not install any of them until you say so:

| Package                                       | Why                                                            | Alternative                                                          |
| --------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `@react-native-async-storage/async-storage`   | persist drafts, queue and session                              | `react-native-mmkv` (faster, needs dev build — which we need anyway) |
| `expo-file-system`                            | keep queued photos out of a reclaimable cache dir              | none                                                                 |
| `expo-localization`                           | device locale + timezone at first sign-in                      | ask the user to pick manually                                        |
| `@date-fns/tz` + `date-fns`                   | timezone math in app and tests                                 | Luxon; or `Intl` by hand                                             |
| `@sentry/react-native`                        | you asked for Sentry                                           | —                                                                    |
| `react-i18next`                               | the React bindings for i18next                                 | —                                                                    |
| `jest`, `jest-expo`, `ts-jest`, `@types/jest` | the tests you asked for                                        | —                                                                    |
| `eslint`, `eslint-config-expo`, `prettier`    | "lint before every commit"                                     | —                                                                    |
| `expo-crypto`                                 | hash invite tokens on device? (server-side only if you prefer) | do it server-side                                                    |

Decision: yes to all, with **`@react-native-async-storage/async-storage`** — MMKV does
not run in Expo Go and the early screens are developed in Expo Go (C6).

---

## 11. Decisions (formerly open questions)

Answered 2026-09-02:

- **Q1 — Node version.** Node 22 LTS, pinned with `fnm` + `.nvmrc` so the pin is real (C10).
- **Q2 — No Docker.** Develop directly against the cloud project `huodsskyppiuqzybkjhu`;
  no real data exists until phase 4. Deno installed via brew for Edge Function tests.
- **Q3 — Tour to seed:** `T1` / `Tour 1` / 2026-11-01 → 2027-05-30 / `Europe/Vilnius`.
- **Q4 — Seed all five group rows** with their notify times, but only the Crew form.
- **Q5 — `is_late`:** 06:00 local the day after `report_date` (C3).
- **Q6 — `closes_form_if`** = the `worked_today = no` path, deliberately expressed through
  `visible_if` in the seed. Tested under that name.

Drive paths:

- **Q7 — `{tour}` folder name:** `{code} {name}`.
- **Q8 — no show that date:** folder is `{date}` alone.
- **Q9 — `first_name` / `last_name` columns added**; the folder is built from them and
  `full_name` is never split.

Schema additions — see §4:

- **Q10 — `invites` table:** yes.
- **Q11 — `drive_folders` (keyed per C1) and `notifications.report_date`:** yes.
- **Q12 — extra columns:** exactly the five in C9, nothing else.

Other:

- **Q13 — build `backup-db` now (phase 3) rather than at phase 12?** The free tier has no
  automatic backups and phase 4 creates real accounts. An Edge Function cannot run
  `pg_dump`; the backup is **JSON per table** written to `ROOT/backups/{date}/`, 30 days
  retained, and a restore into a scratch schema is proven before phase 4 (C7).
- **Q14 — SMTP:** left alone for the pilot; QR and copy-link only. Supabase's built-in
  sender is rate-limited to a handful per hour, so custom SMTP is a config change before
  the 200-person rollout.
- **Q15 — Sentry:** scaffolded, disabled until `EXPO_PUBLIC_SENTRY_DSN` is set.
- **Q16 — Android only.** No Apple account, no iOS build. Package name
  **`io.github.dominykasdirse.crewintake`** — permanent once published (C8). FCM key goes
  into EAS credentials; exact console steps are printed at the end of phase 8.
- **Q17 — `must_change_password`:** used for admin-reset accounts.
- **Q18 — backfill:** today + previous 7 days, all `is_late`; older is admin only (C4).
- **Q19 — editing:** allowed until the 06:00 cutoff with `edited_at` + audit trail (C5).

---

## 12. How each phase ends

One commit per phase, conventional message, `tsc --noEmit` + `eslint` + `jest` green
before every commit. After each phase I print a **DO BY HAND** block: the exact console
commands for you (`supabase db push`, `eas build`, secret setting, Drive folder sharing),
and nothing else in it that I could have done myself.

---

## 13. What I am explicitly not building

No identity documents, no passport or ID numbers, no financial account details, no health
data. Two places where that line gets close, and how I am holding it:

- `absence_reason` is free text and someone will type "sick" into it. That is a person
  volunteering a word, not a health field: it is not typed as health data, not indexed as
  such, not aggregated, and never charted. If you later want absence _categories_, tell me
  and we will make them neutral (`day off / travel / unavailable`) rather than medical.
- Invoice categories include `catering` and `accommodation` — expense categories, not
  personal data. No bank details, no card numbers, no IBANs: an invoice is a description,
  an amount, and a photo of a receipt. If a receipt photo happens to show a card number,
  that is not something the schema asks for or reads.

Location: nothing is captured in this build, and when it arrives it is one point at
submit, opt-in per report, never a background track, and never counted against anyone.

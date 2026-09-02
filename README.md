# Crew Intake

Internal daily-reporting app for touring production crews. Expo (Android) + Supabase.
See [PLAN.md](PLAN.md) for scope, schema, and decisions.

## Prerequisites

- `fnm` with Node 22 (`.nvmrc` is honoured once the fnm shell hook is installed)
- Supabase CLI, EAS CLI, Deno 2

## Commands

| | |
|---|---|
| `npm start` | Expo dev server (Expo Go for early screens, dev build for push) |
| `npm run check` | typecheck + lint + tests + secrets scan — run before every commit |
| `npm run db:push` | apply `supabase/migrations` to the linked project |
| `npm run db:types` | regenerate `src/types/database.types.ts` |
| `npm run seed` | seed groups, tour and forms from `forms.seed.json` |
| `npm run rls:test` | live RLS + `submit_report` acceptance test (creates and removes throwaway users) |

## Database

Migrations live in `supabase/migrations`, applied with `npm run db:push` against the
linked project. Every migration is validated on a local Postgres 17 before it is committed.
Nobody is ever hard-deleted: people are `status = 'inactive'`, and every FK from report
data to `profiles` is `ON DELETE RESTRICT`.

## Secrets

Google / Drive credentials live only in Supabase Edge Function secrets.
`scripts/check-secrets.sh` fails CI if their names appear in app code or their
values appear anywhere in the repo.

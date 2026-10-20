-- Enable Banking: a new consent (every ~180 days) brings new account uids;
-- identification_hash stays stable across sessions and is what eb-callback
-- matches on, so renewals never duplicate accounts or history.
-- Idempotent — from 0007 on, the "Supabase deploy" workflow applies every
-- migration on each run, so each one must be safe to re-run.
alter table accounts
  add column if not exists eb_identification_hash text;

create unique index if not exists accounts_eb_identification_unique
  on accounts (household_id, eb_identification_hash)
  where eb_identification_hash is not null;

-- Enable Banking: a new consent (every ~180 days) brings new account uids;
-- identification_hash stays stable across sessions and is what eb-callback
-- matches on, so renewals never duplicate accounts or history.
-- eb_last_sync_at: each account's own sync window (a never-synced account
-- gets its full history, even when added on a renewal).
-- Idempotent — from 0007 on, the "Supabase deploy" workflow applies every
-- migration on each run, so each one must be safe to re-run.
alter table accounts
  add column if not exists eb_identification_hash text;

create unique index if not exists accounts_eb_identification_unique
  on accounts (household_id, eb_identification_hash)
  where eb_identification_hash is not null;

-- Added once; accounts that were already syncing keep their incremental
-- window (the backfill must not run again on later deploys).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounts' and column_name = 'eb_last_sync_at'
  ) then
    alter table accounts add column eb_last_sync_at timestamptz;
    update accounts a
    set eb_last_sync_at = bc.last_sync_at
    from bank_connections bc
    where a.household_id = bc.household_id
      and a.eb_account_uid is not null
      and bc.last_sync_at is not null;
  end if;
end
$$;

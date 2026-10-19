-- M3 — Enable Banking (Santander) support.

-- Short-lived authorization requests (CSRF state → household). Only the
-- service role (Edge Functions) touches this; RLS on with no policies blocks
-- all client access.
create table eb_auth_requests (
  state uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table eb_auth_requests enable row level security;

-- One active bank connection per household (upsert target for eb-callback).
alter table bank_connections
  add constraint bank_connections_household_unique unique (household_id);

-- M9 — Web Push.
-- Unique endpoint so a device re-subscribing upserts instead of duplicating.
alter table push_subscriptions
  add constraint push_subscriptions_endpoint_unique unique (endpoint);

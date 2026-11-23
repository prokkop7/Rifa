-- Distinguish standalone commercial checkouts by Asaas environment.
-- This does not activate any numbered draw or prize entry purchase.
alter table commercial_orders add column if not exists provider_environment text
 not null default 'sandbox' check(provider_environment in ('sandbox','production'));
alter table commercial_orders add column if not exists sale_type text
 not null default 'product' check(sale_type in ('product','service'));
create index if not exists commercial_orders_provider_environment_idx
 on commercial_orders(provider_environment,created_at desc);

-- Track Asaas Checkout by unique ID for standalone commercial orders.
-- Apply after the base schema. This does not authorize paid raffle entries.
alter table commercial_orders add column if not exists provider_checkout_id text;
create unique index if not exists commercial_orders_checkout_unique
on commercial_orders(provider_checkout_id) where provider_checkout_id is not null;

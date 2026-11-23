-- Reservations in authorized free campaigns, independent of payments.
-- Apply AFTER schema.sql for a new database; existing installations need a migration plan.
create table if not exists number_reservations (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references campaigns(id) on delete cascade,
 participant_id uuid not null references participants(id) on delete cascade,
 number integer not null check(number>0),
 reservation_group uuid not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(campaign_id,number)
);
create index if not exists number_reservations_expiry on number_reservations(expires_at);
create index if not exists number_reservations_group on number_reservations(reservation_group,participant_id);
alter table number_reservations enable row level security;

-- Extensões administrativas do cadastro de ações (sem ativar comercialização).
alter table action_catalog
 add column if not exists price_cents integer not null default 0 check(price_cents between 0 and 100000000),
 add column if not exists prize_details text not null default '',
 add column if not exists rules_text text not null default '',
 add column if not exists regulation_url text,
 add column if not exists max_numbers_per_person integer not null default 10 check(max_numbers_per_person between 1 and 10000),
 add column if not exists starts_at timestamptz,
 add column if not exists ends_at timestamptz;
alter table action_catalog drop constraint if exists action_catalog_dates_check;
alter table action_catalog add constraint action_catalog_dates_check
 check(starts_at is null or ends_at is null or ends_at > starts_at);

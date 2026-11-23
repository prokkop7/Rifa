-- Permite guardar os dois ambientes de forma independente.
-- Não ativa cobranças: a seleção é apenas uma preferência administrativa.
alter table payment_provider_settings drop constraint if exists payment_provider_settings_id_check;
alter table payment_provider_settings add constraint payment_provider_settings_id_check
 check (id in ('asaas_sandbox','asaas_production'));
create table if not exists payment_provider_mode (
 id text primary key check (id='asaas'),
 active_environment text not null default 'sandbox' check(active_environment in ('sandbox','production')),
 updated_at timestamptz not null default now()
);
insert into payment_provider_mode(id,active_environment) values('asaas','sandbox') on conflict(id) do nothing;

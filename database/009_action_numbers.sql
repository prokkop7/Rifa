-- Controle transacional de seleções temporárias por ação.
-- Este módulo NÃO confirma participações nem integra pagamentos.
create table if not exists action_number_holds (
 id uuid primary key default gen_random_uuid(),
 action_id uuid not null references action_catalog(id) on delete cascade,
 participant_id uuid not null references participants(id) on delete cascade,
 number integer not null check(number>0),
 reservation_group uuid not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 unique(action_id,number)
);
create index if not exists action_holds_owner_idx on action_number_holds(action_id,participant_id,expires_at);
create index if not exists action_holds_expire_idx on action_number_holds(expires_at);
alter table action_number_holds enable row level security;
-- Separado das inscrições reais, não é preenchido por esta etapa.
create table if not exists action_number_confirmations (
 id uuid primary key default gen_random_uuid(),
 action_id uuid not null references action_catalog(id) on delete cascade,
 participant_id uuid not null references participants(id),
 number integer not null check(number>0),
 confirmed_at timestamptz not null default now(),
 unique(action_id,number)
);
create index if not exists action_confirmations_owner_idx on action_number_confirmations(participant_id,action_id);
alter table action_number_confirmations enable row level security;

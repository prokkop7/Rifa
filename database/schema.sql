-- Ações: schema de instalação nova. Não execute para atualizar base existente sem migração revisada.
create extension if not exists pgcrypto;
create table if not exists organizers (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null unique,
 display_name text not null,
 created_at timestamptz not null default now()
);
create table if not exists campaigns (
 id uuid primary key default gen_random_uuid(),
 organizer_id uuid not null references organizers(id),
 title text not null,
 description text,
 kind text not null check(kind in ('authorized_free_promotion','authorized_osc','demo')),
 approval_reference text,
 approval_document_url text,
 regulation_url text,
 status text not null default 'draft' check(status in ('draft','review','published','closed','archived')),
 number_count integer not null check(number_count between 1 and 100000),
 starts_at timestamptz,
 ends_at timestamptz,
 created_at timestamptz not null default now(),
 constraint published_requires_authorization check(
 status <> 'published' or (kind in ('authorized_free_promotion','authorized_osc')
 and nullif(trim(approval_reference),'') is not null
 and nullif(trim(regulation_url),'') is not null))
);
create table if not exists prizes (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references campaigns(id) on delete cascade,
 label text not null,
 specs text,
 image_url text,
 position integer not null,
 unique(campaign_id,position)
);
create table if not exists participants (
 id uuid primary key default gen_random_uuid(),
 full_name text not null check(char_length(trim(full_name)) >= 3),
 phone_e164 text not null check(phone_e164 ~ '^[+]55[1-9][1-9][0-9]{8,9}$'),
 social_network text,
 social_handle text,
 created_at timestamptz not null default now()
);
create unique index if not exists participants_phone_unique on participants(phone_e164);
create table if not exists entries (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references campaigns(id),
 participant_id uuid not null references participants(id),
 number integer not null check(number>0),
 created_at timestamptz not null default now(),
 unique(campaign_id,number),
 unique(campaign_id,participant_id,number)
);
create table if not exists winners (
 id uuid primary key default gen_random_uuid(),
 campaign_id uuid not null references campaigns(id),
 prize_id uuid not null unique references prizes(id),
 entry_id uuid not null unique references entries(id),
 selection_reference text,
 published_at timestamptz,
 unique(campaign_id,prize_id)
);
create table if not exists audit_log (
 id bigint generated always as identity primary key,
 actor_id uuid,
 action text not null,
 entity_type text not null,
 entity_id uuid,
 details jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create table if not exists commercial_orders (
 id uuid primary key default gen_random_uuid(),
 organizer_id uuid not null references organizers(id),
 participant_id uuid references participants(id),
 description text not null,
 amount_cents integer not null check(amount_cents>0),
 status text not null default 'created' check(status in ('created','pending','paid','failed','refunded','cancelled')),
 provider text check(provider is null or provider='asaas'),
 provider_payment_id text unique,
 external_reference text not null unique,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create table if not exists payment_events (
 id uuid primary key default gen_random_uuid(),
 provider text not null,
 provider_event_id text not null,
 commercial_order_id uuid references commercial_orders(id),
 payload jsonb not null,
 received_at timestamptz not null default now(),
 unique(provider,provider_event_id)
);
create table if not exists participant_accounts (
 id uuid primary key default gen_random_uuid(),
 participant_id uuid not null unique references participants(id) on delete cascade,
 password_salt text not null,
 password_hash text not null,
 created_at timestamptz not null default now()
);
create table if not exists participant_sessions (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references participant_accounts(id) on delete cascade,
 token_hash text not null unique,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists participant_sessions_account_idx on participant_sessions(account_id);
alter table organizers enable row level security;
alter table campaigns enable row level security;
alter table prizes enable row level security;
alter table participants enable row level security;
alter table entries enable row level security;
alter table winners enable row level security;
alter table audit_log enable row level security;
alter table commercial_orders enable row level security;
alter table payment_events enable row level security;
alter table participant_accounts enable row level security;
alter table participant_sessions enable row level security;
-- API server must connect with privileged DB role; no public direct table access.

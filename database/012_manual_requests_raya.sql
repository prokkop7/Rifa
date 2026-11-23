-- Modo de finalização por ação: automático ou solicitação manual via WhatsApp.
-- Solicitações manuais não são pagamentos nem participações confirmadas.
create table if not exists action_checkout_settings (
 id text primary key default 'global' check (id='global'),
 mode text not null default 'automatic' check(mode in ('automatic','whatsapp')),
 raya_endpoint text not null default 'https://api.rayaconnect.com.br/v2/api/external/9f945521-57eb-426a-8207-f4e9cc69b8de',
 destination_phone text not null default '5522999397655',
 token_ciphertext text,
 updated_at timestamptz not null default now()
);
insert into action_checkout_settings(id) values('global') on conflict do nothing;

create table if not exists action_manual_requests (
 id uuid primary key default gen_random_uuid(),
 action_id uuid not null references action_catalog(id) on delete restrict,
 customer_id uuid not null default gen_random_uuid(),
 contact_name text not null check(char_length(contact_name) between 3 and 120),
 contact_phone text not null check(contact_phone ~ '^[+]55[1-9][1-9][0-9]{8,9}$'),
 unit_price_cents integer not null check(unit_price_cents>=0),
 quantity integer not null check(quantity between 1 and 20),
 total_cents bigint not null check(total_cents>=0),
 numbers integer[] not null,
 status text not null default 'reserved' check(status in ('reserved','released','expired')),
 notification_status text not null default 'pending' check(notification_status in ('pending','sending','sent','failed')),
 notification_attempts integer not null default 0,
 notification_error text,
 notification_sent_at timestamptz,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists action_manual_request_numbers (
 action_id uuid not null references action_catalog(id) on delete restrict,
 number integer not null check(number>0),
 request_id uuid not null references action_manual_requests(id) on delete cascade,
 primary key(action_id,number)
);
create index if not exists action_manual_requests_list_idx on action_manual_requests(created_at desc);
create index if not exists action_manual_requests_active_idx on action_manual_requests(action_id,expires_at) where status='reserved';
alter table action_checkout_settings enable row level security;
alter table action_manual_requests enable row level security;
alter table action_manual_request_numbers enable row level security;

-- Demonstração Pix administrada, separada de campanhas e números.
-- Não armazena CPF, nome nem telefone do pagador; apenas os IDs necessários à conciliação.
create table if not exists sandbox_pix_demos (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default gen_random_uuid(),
 provider_customer_id text,
 provider_payment_id text unique,
 external_reference text not null unique,
 amount_cents integer not null default 500 check(amount_cents=500),
 status text not null default 'created' check(status in ('created','pending','paid','cancelled','failed','refunded')),
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create index if not exists sandbox_pix_demos_created_idx on sandbox_pix_demos(created_at desc);
alter table sandbox_pix_demos enable row level security;

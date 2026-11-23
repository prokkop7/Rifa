-- Private, encrypted provider credentials for the sandbox environment.
-- Apply on existing PostgreSQL database as a separate migration.
create table if not exists payment_provider_settings (
 id text primary key check (id = 'asaas_sandbox'),
 credential_ciphertext text not null,
 updated_at timestamptz not null default now()
);
alter table payment_provider_settings enable row level security;

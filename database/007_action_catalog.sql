-- Catálogo de demonstração; nenhum vínculo com cobrança, inscrição ou sorteio pago.
create table if not exists action_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check(slug ~ '^[a-z0-9-]{8,90}$'),
  category text not null check(category in ('product','money','service')),
  title text not null check(char_length(title) between 4 and 110),
  description text not null default '',
  image_url text,
  number_count integer not null default 100 check(number_count between 1 and 10000),
  state text not null default 'preview' check(state in ('preview','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists action_catalog_visible_idx on action_catalog(created_at desc) where state='preview';
alter table action_catalog enable row level security;

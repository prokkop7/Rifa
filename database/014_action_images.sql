-- Fotos cadastradas diretamente no painel, persistidas no PostgreSQL.
-- Limite de seis imagens por ação, com capa definida pelo campo is_cover.
create table if not exists action_images (
 id uuid primary key default gen_random_uuid(),
 action_id uuid not null references action_catalog(id) on delete cascade,
 filename text not null,
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
 image_data bytea not null check(octet_length(image_data) between 100 and 2000000),
 sort_order smallint not null default 0,
 is_cover boolean not null default false,
 uploaded_at timestamptz not null default now()
);
create index if not exists action_images_order_idx on action_images(action_id,sort_order,uploaded_at);
create unique index if not exists action_images_one_cover_idx on action_images(action_id) where is_cover;
alter table action_images enable row level security;

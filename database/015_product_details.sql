-- Informações essenciais do produto, independentes dos parâmetros operacionais da ação.
alter table action_catalog
 add column if not exists product_brand varchar(80) not null default '',
 add column if not exists product_model varchar(120) not null default '',
 add column if not exists product_condition varchar(16) not null default 'unspecified'
  check (product_condition in ('new','used','refurbished','unspecified')),
 add column if not exists condition_notes varchar(600) not null default '';

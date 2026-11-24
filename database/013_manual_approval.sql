-- Manual approval is an administrative review, not evidence of payment.
alter table action_manual_requests drop constraint if exists action_manual_requests_status_check;
alter table action_manual_requests add constraint action_manual_requests_status_check
 check (status in ('reserved','approved','rejected','released','expired'));
alter table action_manual_requests add column if not exists reviewed_at timestamptz;
alter table action_manual_requests add column if not exists reviewed_by text;
alter table action_manual_requests add column if not exists review_note text;
create table if not exists action_manual_approved_numbers (
 action_id uuid not null references action_catalog(id) on delete restrict,
 number integer not null check(number>0),
 request_id uuid not null references action_manual_requests(id) on delete restrict,
 approved_at timestamptz not null default now(),
 primary key(action_id,number),
 unique(request_id,number)
);
create index if not exists action_manual_approved_request_idx on action_manual_approved_numbers(request_id);
alter table action_manual_approved_numbers enable row level security;
create table if not exists action_manual_decisions (
 id bigint generated always as identity primary key,
 request_id uuid not null references action_manual_requests(id) on delete restrict,
 action_id uuid not null references action_catalog(id) on delete restrict,
 decision text not null check(decision in ('approved','rejected')),
 reviewed_by text not null,
 review_note text,
 decided_at timestamptz not null default now()
);
create unique index if not exists action_manual_decisions_request_idx on action_manual_decisions(request_id);
alter table action_manual_decisions enable row level security;

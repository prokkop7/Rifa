-- Auditoria de eventos de reserva temporária. Dados pessoais não são registrados.
-- Eventos persistem após a exclusão da reserva; ação/participante ficam anonimizados ao serem excluídos.
create table if not exists action_reservation_audit (
 id bigint generated always as identity primary key,
 action_id uuid references action_catalog(id) on delete set null,
 action_slug text not null,
 participant_id uuid references participants(id) on delete set null,
 reservation_group uuid,
 number integer not null check(number>0),
 event_type text not null check(event_type in ('created','released','expired','conflict')),
 occurred_at timestamptz not null default now()
);
create index if not exists reservation_audit_action_idx on action_reservation_audit(action_slug,id desc);
create index if not exists reservation_audit_kind_idx on action_reservation_audit(event_type,id desc);
alter table action_reservation_audit enable row level security;

create or replace function audit_action_hold_change() returns trigger
language plpgsql as $$
declare
 item record;
 kind text;
begin
 if tg_op='INSERT' then
  item:=new;kind:='created';
 else
  item:=old;
  kind:=case when old.expires_at<=now() then 'expired' else 'released' end;
 end if;
 insert into action_reservation_audit(action_id,action_slug,participant_id,reservation_group,number,event_type)
 select item.action_id,a.slug,item.participant_id,item.reservation_group,item.number,kind
 from action_catalog a where a.id=item.action_id;
 return item;
end;
$$;
drop trigger if exists action_hold_audit_insert on action_number_holds;
create trigger action_hold_audit_insert after insert on action_number_holds for each row execute function audit_action_hold_change();
drop trigger if exists action_hold_audit_delete on action_number_holds;
create trigger action_hold_audit_delete after delete on action_number_holds for each row execute function audit_action_hold_change();

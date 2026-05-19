drop view if exists appointments_br;
drop view if exists audit_logs_br;

create view appointments_br
with (security_invoker = true) as
select
  id,
  patient_id,
  phone,
  calendar_event_id,
  status,
  starts_at,
  ends_at,
  created_at,
  updated_at,
  timezone('America/Sao_Paulo', starts_at) as starts_at_br,
  timezone('America/Sao_Paulo', ends_at) as ends_at_br,
  timezone('America/Sao_Paulo', created_at) as created_at_br,
  timezone('America/Sao_Paulo', updated_at) as updated_at_br,
  to_char(timezone('America/Sao_Paulo', starts_at), 'YYYY-MM-DD HH24:MI:SS') as starts_at_br_text,
  to_char(timezone('America/Sao_Paulo', ends_at), 'YYYY-MM-DD HH24:MI:SS') as ends_at_br_text,
  to_char(timezone('America/Sao_Paulo', created_at), 'YYYY-MM-DD HH24:MI:SS') as created_at_br_text,
  to_char(timezone('America/Sao_Paulo', updated_at), 'YYYY-MM-DD HH24:MI:SS') as updated_at_br_text
from appointments;

create view audit_logs_br
with (security_invoker = true) as
select
  id,
  event,
  phone,
  metadata,
  created_at,
  timezone('America/Sao_Paulo', created_at) as created_at_br,
  to_char(timezone('America/Sao_Paulo', created_at), 'YYYY-MM-DD HH24:MI:SS') as created_at_br_text
from audit_logs;

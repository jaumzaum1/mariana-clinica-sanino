update appointments a
set patient_id = p.id,
    metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
      'patient_id_backfilled_at', now(),
      'patient_id_backfilled_by', '009_appointment_audit_and_local_time_views'
    ),
    updated_at = now()
from patients p
where a.patient_id is null
  and a.phone = p.phone;

update appointments
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'orphan_before_fix', true,
      'orphan_reason', 'no patient found for appointment phone',
      'orphan_marked_at', now()
    ),
    updated_at = now()
where patient_id is null;

create or replace view appointments_br
with (security_invoker = true) as
select
  id,
  patient_id,
  phone,
  calendar_event_id,
  status,
  starts_at,
  timezone('America/Sao_Paulo', starts_at) as starts_at_br,
  ends_at,
  timezone('America/Sao_Paulo', ends_at) as ends_at_br,
  appointment_type,
  source,
  notes,
  metadata,
  created_at,
  timezone('America/Sao_Paulo', created_at) as created_at_br,
  updated_at,
  timezone('America/Sao_Paulo', updated_at) as updated_at_br
from appointments;

create or replace view audit_logs_br
with (security_invoker = true) as
select
  id,
  event,
  phone,
  metadata,
  created_at,
  timezone('America/Sao_Paulo', created_at) as created_at_br
from audit_logs;

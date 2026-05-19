alter table appointments
  add column if not exists appointment_type text,
  add column if not exists source text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists appointments_calendar_event_id_idx
  on appointments (calendar_event_id)
  where calendar_event_id is not null;

create index if not exists appointments_phone_starts_at_idx
  on appointments (phone, starts_at);

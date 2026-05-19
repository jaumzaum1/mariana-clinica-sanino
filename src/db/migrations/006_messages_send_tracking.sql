alter table messages
  add column if not exists sent_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists send_status text,
  add column if not exists send_error text;

create index if not exists messages_outbound_send_status_idx
  on messages (send_status, created_at)
  where direction = 'outbound' and sent_at is null;

update messages
set send_status = 'draft'
where direction = 'outbound'
  and sent_at is null
  and send_status is null
  and coalesce((raw_payload -> 'mariana' ->> 'draft')::boolean, false) = true;

alter table messages
  add column if not exists locked_at timestamptz,
  add column if not exists lock_id text,
  add column if not exists send_attempts integer not null default 0;

alter table messages
  drop constraint if exists messages_send_status_check;

alter table messages
  add constraint messages_send_status_check
  check (
    send_status is null
    or send_status in (
      'draft',
      'pending',
      'sending',
      'sent',
      'send_failed',
      'skipped',
      'draft_old_cleanup'
    )
  );

create index if not exists messages_outbound_pending_idx
  on messages (created_at)
  where direction = 'outbound'
    and send_status = 'pending'
    and sent_at is null;

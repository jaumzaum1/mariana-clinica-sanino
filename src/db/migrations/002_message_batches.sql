create table if not exists message_batches (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  status text not null default 'accumulating'
    check (status in ('accumulating', 'ready', 'processed')),
  accumulated_text text not null default '',
  message_ids uuid[] not null default '{}'::uuid[],
  last_message_at timestamptz not null,
  process_after timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_batches_phone_status_idx
  on message_batches (phone, status);

create index if not exists message_batches_due_idx
  on message_batches (process_after)
  where status = 'accumulating';

alter table message_batches enable row level security;

alter table message_batches
  drop constraint if exists message_batches_status_check;

alter table message_batches
  add constraint message_batches_status_check
  check (status in ('accumulating', 'ready', 'processed', 'failed'));

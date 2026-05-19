create extension if not exists pgcrypto;

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  phone text not null unique,
  name text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete set null,
  phone text not null,
  direction text not null check (direction in ('inbound', 'outbound', 'internal')),
  text text not null default '',
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete set null,
  phone text not null,
  calendar_event_id text,
  status text not null default 'pending',
  starts_at timestamptz,
  ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists internal_commands (
  id uuid primary key default gen_random_uuid(),
  command_type text not null,
  phone text,
  note text,
  requested_by text not null,
  raw_text text,
  created_at timestamptz not null default now()
);

create table if not exists followups (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references patients(id) on delete cascade,
  phone text not null,
  reason text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists eval_runs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'pending',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists eval_cases (
  id uuid primary key default gen_random_uuid(),
  eval_run_id uuid references eval_runs(id) on delete cascade,
  name text not null,
  input jsonb not null,
  expected jsonb not null default '{}'::jsonb,
  actual jsonb,
  score numeric,
  passed boolean,
  created_at timestamptz not null default now()
);

alter table patients enable row level security;
alter table messages enable row level security;
alter table appointments enable row level security;
alter table internal_commands enable row level security;
alter table followups enable row level security;
alter table audit_logs enable row level security;
alter table eval_runs enable row level security;
alter table eval_cases enable row level security;

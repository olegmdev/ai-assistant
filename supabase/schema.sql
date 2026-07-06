-- Schema for the Oleh AI assistant.
-- Run this in the Supabase SQL editor (project pvqrjqwswqbrjxmjcgep).

create extension if not exists "pgcrypto";

-- One row per (platform, user) DM thread.
create table if not exists conversations (
  id               uuid primary key default gen_random_uuid(),
  platform         text not null check (platform in ('instagram', 'threads')),
  external_user_id text not null,
  status           text not null default 'active',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (platform, external_user_id)
);

-- Every inbound (user) and outbound (assistant) message.
-- message_id is the Meta mid for inbound messages and is unique, so retried
-- webhook deliveries are deduped by the insert.
create table if not exists messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  message_id      text unique,
  created_at      timestamptz not null default now()
);

create index if not exists messages_conversation_created_idx
  on messages (conversation_id, created_at);

-- Collaboration / partnership leads captured by the assistant.
create table if not exists collab_leads (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete set null,
  platform        text not null check (platform in ('instagram', 'threads')),
  brand           text,
  contact         text,
  collab_type     text,
  budget          text,
  timeline        text,
  deliverables    text,
  notes           text,
  status          text not null default 'new',
  created_at      timestamptz not null default now()
);

create index if not exists collab_leads_status_idx on collab_leads (status, created_at);

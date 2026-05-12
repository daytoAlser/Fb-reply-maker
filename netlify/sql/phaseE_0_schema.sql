-- Phase E.0 — Schema migration for state-aware conversation intelligence
--
-- Adds five new columns to public.leads + one index. All columns are
-- forward-compatible with defaults so existing rows keep working without
-- backfill.
--
-- Run once in Supabase SQL editor (project: ccaw fb-reply-maker leads).
-- Safe to re-run: every statement uses IF NOT EXISTS.

alter table public.leads
  add column if not exists products_of_interest jsonb not null default '[]'::jsonb;

alter table public.leads
  add column if not exists conversation_mode text not null default 'standard';

alter table public.leads
  add column if not exists last_customer_message_at timestamptz;

alter table public.leads
  add column if not exists silence_duration_ms bigint not null default 0;

alter table public.leads
  add column if not exists manual_options_log jsonb not null default '[]'::jsonb;

create index if not exists idx_leads_conversation_mode
  on public.leads (conversation_mode);

-- Sanity check (uncomment to verify after running):
-- select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--  where table_schema = 'public' and table_name = 'leads'
--    and column_name in (
--      'products_of_interest',
--      'conversation_mode',
--      'last_customer_message_at',
--      'silence_duration_ms',
--      'manual_options_log'
--    )
--  order by column_name;

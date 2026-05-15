-- Learning capture for Auto Response variants.
--
-- One row per INSERT click in the Auto Response panel. Captures the
-- variant that was shown, the final message that was actually sent (if
-- any), and a structured order-aware diff between the two. The data
-- feeds prompt-tuning passes: variants the rep sends verbatim are
-- working, variants that get heavily edited are where the prompt is
-- missing the rep's voice.
--
-- Lifecycle:
--   1. INSERT click  -> row created with final_sent_message NULL
--   2a. send detected within 60s -> finalize: final_sent_message, was_edited, edit_diff populated
--   2b. 60s elapsed, no send     -> finalize with send_timeout = true
--   2c. fresh INSERT in same thread before 2a/2b -> previous row gets superseded_by set
--
-- Reviewed manually via the Learning Log tab in the side panel. Rows
-- can be flagged_for_review so future prompt-update passes can filter
-- to the patterns the rep cares about.

create extension if not exists "pgcrypto";

create table if not exists auto_response_learning (
  id                    uuid primary key default gen_random_uuid(),
  client_event_id       text not null,
  thread_id             text,
  variant_kind          text not null check (variant_kind in ('quick','standard','detailed')),
  variant_shown         text not null,
  customer_message      text,
  conversation_history  jsonb,
  captured_fields       jsonb,
  listing_title         text,
  partner_name          text,
  final_sent_message    text,
  was_edited            boolean,
  edit_diff             jsonb,
  char_distance         integer,
  send_timeout          boolean default false,
  superseded_by         text,
  flagged_for_review    boolean not null default false,
  inserted_at           timestamptz not null default now(),
  finalized_at          timestamptz,
  constraint auto_response_learning_client_event_id_key unique (client_event_id)
);

create index if not exists auto_response_learning_inserted_at_idx
  on auto_response_learning (inserted_at desc);

create index if not exists auto_response_learning_thread_id_idx
  on auto_response_learning (thread_id);

-- Partial index speeds up the supersession lookup in insert_event:
-- "find any pending row in this thread".
create index if not exists auto_response_learning_pending_idx
  on auto_response_learning (thread_id)
  where finalized_at is null;

-- Partial index supports the Flagged-only filter chip in the Learning
-- Log tab.
create index if not exists auto_response_learning_flagged_idx
  on auto_response_learning (flagged_for_review)
  where flagged_for_review = true;

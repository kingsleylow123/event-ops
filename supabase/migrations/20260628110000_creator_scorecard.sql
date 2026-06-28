-- Creator Scorecard (/creators tab): Instagram posts + collab tracking, joined to affiliates.
-- IG data is ingested via Apify (lib/instagram.ts) → creator_ig_posts. Collab = a post on
-- @claudemalaysiacommunity that has coauthorProducers; the creator(s) = the non-community co-authors.

-- 1) Map an affiliate to their REAL IG username. Lead-sheet handles (queenie7946) are
--    ManyChat-style and do NOT match IG usernames (queenieyan.13), so we need this bridge.
alter table public.affiliates add column if not exists ig_handle text;
create index if not exists affiliates_ig_handle_idx on public.affiliates (lower(ig_handle));

-- 2) Scraped IG posts from the scanned brand account(s).
create table if not exists public.creator_ig_posts (
  id uuid primary key default gen_random_uuid(),
  ig_post_id text not null unique,                  -- IG media id (stable dedup key)
  short_code text,
  account text not null,                            -- scanned account, e.g. claudemalaysiacommunity
  owner_username text,                              -- post owner (for collabs this is the creator)
  is_collab boolean not null default false,
  collab_creators text[] not null default '{}',    -- non-community co-authors = the creators credited
  coauthor_usernames text[] not null default '{}', -- raw coauthorProducers usernames
  tagged_users text[] not null default '{}',
  post_type text,                                  -- Image | Video | Sidecar
  post_url text,
  caption text,
  posted_at timestamptz,
  likes int not null default 0,
  comments int not null default 0,
  views int not null default 0,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists creator_ig_posts_posted_idx on public.creator_ig_posts (posted_at desc);
create index if not exists creator_ig_posts_collab_idx on public.creator_ig_posts using gin (collab_creators);
create index if not exists creator_ig_posts_account_idx on public.creator_ig_posts (account);

-- Server-only (supabaseAdmin bypasses RLS); blocks anon/authenticated, matching other tables.
alter table public.creator_ig_posts enable row level security;

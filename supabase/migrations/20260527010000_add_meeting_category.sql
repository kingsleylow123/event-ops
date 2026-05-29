alter table meetings
  add column if not exists meeting_category text not null default 'facilitator'
    check (meeting_category in ('facilitator', 'content_creator', 'videographer', 'mixed'));

create index if not exists meetings_category_idx on meetings (meeting_category);

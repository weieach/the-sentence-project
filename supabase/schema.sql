-- Run once in the SQL Editor of your Supabase project.
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  email text not null check (char_length(email) between 3 and 254),
  session_attended text not null check (char_length(session_attended) between 1 and 200),
  image_path text not null unique,
  caption text not null check (char_length(caption) between 1 and 500),
  include_name boolean not null default false,
  is_hidden boolean not null default false,
  sentence text not null default '' check (char_length(sentence) <= 2000),
  hometown text not null default '' check (char_length(hometown) <= 200),
  why_write text not null default '' check (char_length(why_write) <= 4000),
  year integer not null default extract(year from now()),
  created_at timestamptz not null default now()
);
alter table public.submissions add column if not exists is_hidden boolean not null default false;
create index if not exists submissions_gallery_order on public.submissions (created_at desc, id desc);
alter table public.submissions enable row level security;
revoke all on public.submissions from anon, authenticated;
grant all on public.submissions to service_role;

-- Only the server can query this view; private answers never enter its response.
create or replace view public.gallery_entries with (security_invoker = true) as
select id, caption,
  case when include_name then name else null end as display_name,
  year, image_path, created_at
from public.submissions
where not is_hidden;
revoke all on public.gallery_entries from anon, authenticated;
grant select on public.gallery_entries to service_role;

-- Images are public gallery content. No anonymous insert/update/delete policies.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sentence-images', 'sentence-images', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

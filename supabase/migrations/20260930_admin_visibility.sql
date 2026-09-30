begin;

alter table public.submissions
  add column if not exists is_hidden boolean not null default false;

create or replace view public.gallery_entries with (security_invoker = true) as
select id, caption,
  case when include_name then name else null end as display_name,
  year, image_path, created_at
from public.submissions
where not is_hidden;

revoke all on public.gallery_entries from anon, authenticated;
grant select on public.gallery_entries to service_role;

commit;
notify pgrst, 'reload schema';

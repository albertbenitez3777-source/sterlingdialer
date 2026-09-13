create index if not exists federal_one_research_creator_idx
  on public.federal_one_research_sessions(created_by, created_at desc);

update public.lead_staging set id = gen_random_uuid()::text where id is null or btrim(id) = '';
alter table public.lead_staging alter column id set default gen_random_uuid()::text;
alter table public.lead_staging alter column id set not null;
alter table public.lead_staging add constraint lead_staging_pkey primary key (id);

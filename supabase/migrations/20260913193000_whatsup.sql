create table if not exists public.federal_one_conversations (
 id uuid primary key default gen_random_uuid(),
 member_a uuid not null references public.agents(id),
 member_b uuid not null references public.agents(id),
 created_at timestamptz not null default now(),
 check(member_a < member_b), unique(member_a,member_b)
);
alter table public.federal_one_conversations enable row level security;
revoke all on public.federal_one_conversations from public,anon,authenticated;
alter table public.federal_one_chat_messages add column if not exists image_data text;
do $$ begin if not exists(select 1 from pg_constraint where conname='chat_image_size' and conrelid='public.federal_one_chat_messages'::regclass) then
alter table public.federal_one_chat_messages add constraint chat_image_size check(image_data is null or (length(image_data)<=400000 and image_data ~ '^data:image/(png|jpeg|webp);base64,'));
end if; end $$;
create index if not exists conversations_member_b_idx on public.federal_one_conversations(member_b);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  nickname text not null unique,
  days text[] not null default '{}',
  times text[] not null default '{}',
  attendance text not null default '참',
  class_name text not null default '수호성',
  power text not null default '600~700k',
  raid_focus text not null default '무스펠',
  difficulty text not null default '쉬움',
  mode text not null default '트라이',
  lead_ready text not null default 'X',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.members add column if not exists difficulty text not null default '쉬움';
alter table public.members add column if not exists mode text not null default '트라이';
alter table public.members add column if not exists lead_ready text not null default 'X';

create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists members_updated_at on public.members;
create trigger members_updated_at
before update on public.members
for each row
execute procedure public.handle_updated_at();

alter table public.members enable row level security;

create policy "Anyone can read members"
on public.members
for select
using (true);

create policy "Anyone can insert members"
on public.members
for insert
with check (true);

create policy "Anyone can update members"
on public.members
for update
using (true)
with check (true);

create policy "Anyone can delete members"
on public.members
for delete
using (true);

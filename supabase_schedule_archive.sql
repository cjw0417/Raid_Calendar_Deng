-- 지난 신청 보관 (지난 신청 불러오기용)
-- supabase_member_password.sql을 먼저 실행한 뒤, Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다.
-- 여러 번 실행해도 안전하다.
--
-- 동작
--   - raid_schedules는 캐릭터 · 레이드 조합마다 한 행이라, 지난 신청을 이번 주로 다시 등록하면 그 행을 덮어쓴다.
--     그 뒤에 삭제하면 지난 신청이 DB에서 사라져 다시 불러올 수 없었다.
--   - 지난주 이전에 저장된 행이 수정되거나 삭제되기 직전 값을 raid_schedule_archive에 남겨 둔다.
--     (캐릭터 · 레이드 조합마다 가장 최근 것 한 건)
--   - 앱은 raid_schedules의 지난 행과 이 보관 행을 합쳐 '지난 신청 불러오기' 목록을 만든다.
--   - 이 파일을 실행하기 전에 이미 지워진 지난 신청은 되살릴 수 없다.
--
-- 특정 캐릭터의 보관 기록을 지우려면:
--   delete from public.raid_schedule_archive where nickname = '닉네임';

-- 1. 보관 테이블 (읽기는 누구나, 쓰기는 아래 트리거로만)
create table if not exists public.raid_schedule_archive (
  nickname text not null,
  raid_name text not null,
  difficulty text not null,
  mode text not null,
  days text[] not null default '{}',
  times text[] not null default '{}',
  day_time_selection jsonb not null default '{}',
  attendance text not null default '참',
  class_name text not null default '수호성',
  power text not null default '600~700k',
  lead_ready text not null default 'X',
  updated_at timestamptz not null,
  archived_at timestamptz not null default now(),
  primary key (nickname, raid_name, difficulty, mode)
);

alter table public.raid_schedule_archive enable row level security;

drop policy if exists "Anyone can read raid schedule archive" on public.raid_schedule_archive;
create policy "Anyone can read raid schedule archive"
on public.raid_schedule_archive
for select
using (true);

-- 2. 지난주 이전 행이 바뀌거나 지워지면 바뀌기 전 값을 보관한다.
create or replace function public._archive_past_raid_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if old.updated_at < public._current_week_start() then
    insert into public.raid_schedule_archive (
      nickname, raid_name, difficulty, mode, days, times, day_time_selection,
      attendance, class_name, power, lead_ready, updated_at
    )
    values (
      old.nickname, old.raid_name, old.difficulty, old.mode, old.days, old.times, old.day_time_selection,
      old.attendance, old.class_name, old.power, old.lead_ready, old.updated_at
    )
    on conflict (nickname, raid_name, difficulty, mode) do update
    set days = excluded.days,
        times = excluded.times,
        day_time_selection = excluded.day_time_selection,
        attendance = excluded.attendance,
        class_name = excluded.class_name,
        power = excluded.power,
        lead_ready = excluded.lead_ready,
        updated_at = excluded.updated_at,
        archived_at = now()
    where public.raid_schedule_archive.updated_at <= excluded.updated_at;
  end if;

  return null;
end;
$$;

revoke execute on function public._archive_past_raid_schedule() from public, anon, authenticated;

drop trigger if exists raid_schedules_archive_past on public.raid_schedules;
create trigger raid_schedules_archive_past
after update or delete on public.raid_schedules
for each row
execute procedure public._archive_past_raid_schedule();

notify pgrst, 'reload schema';

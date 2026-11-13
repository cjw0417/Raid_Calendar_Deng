-- 횟수 제한 레이드(초월 · 에라쿠스 유적 주 5회)의 쓴 횟수 직접 조정
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다. 여러 번 실행해도 안전하다.
-- supabase_member_password.sql을 먼저 실행해 둔 상태여야 한다. (비밀번호 확인 함수를 같이 쓴다)
--
-- 동작
--   - 앱은 '클리어 O'로 표시된 시간대의 정원(먼저 신청한 10명)을 1회씩 자동으로 센다. 클리어 X는 세지 않는다.
--   - 이 표는 그 밖의 조정만 담는다. 레기온 밖에서 쓴 횟수는 +, 앱 기록이 실제와 다르면 −로 맞춘다.
--     남은 횟수 = 제한 횟수 − (자동으로 센 횟수 + 조정)
--   - 주(수요일 0시 시작)마다 따로 저장하므로 리셋되면 새 주는 조정 없이 시작한다.
--   - 읽기는 누구나 할 수 있고(리더가 남은 횟수를 볼 수 있게), 쓰기는 아래 함수로만 한다.
--     본캐로 로그인하면 본캐 비밀번호로 부캐 횟수도 조정할 수 있다.
--
-- 관리자가 직접 고치려면:
--   update public.raid_entry_adjustments set adjustment = 0
--   where nickname = '닉네임' and raid_name = '에라쿠스 유적' and week_start = '2026-11-11';

-- 1. 조정 기록 표
create table if not exists public.raid_entry_adjustments (
  week_start date not null,
  nickname text not null,
  raid_name text not null,
  adjustment integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (week_start, nickname, raid_name)
);

alter table public.raid_entry_adjustments enable row level security;

grant select on public.raid_entry_adjustments to anon, authenticated;
drop policy if exists "Anyone can read raid entry adjustments" on public.raid_entry_adjustments;
create policy "Anyone can read raid entry adjustments"
on public.raid_entry_adjustments
for select
using (true);

-- 2. 조정 함수: 이번 주 쓴 횟수를 1회 더하거나(p_delta = 1) 뺀다(p_delta = -1).
--    반환값: { weekStart, nickname, raidName, adjustment } 또는 { error }
create or replace function public.member_adjust_raid_entries(p_nickname text, p_password text, p_raid_name text, p_delta integer)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  raid_name_value text := btrim(coalesce(p_raid_name, ''));
  week_start_value date := (public._current_week_start() at time zone 'Asia/Seoul')::date;
  verify_result text;
  next_value integer;
begin
  if p_delta is null or p_delta not in (-1, 1) or raid_name_value = '' then
    return jsonb_build_object('error', 'invalid_request');
  end if;

  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  -- 잘못 여러 번 눌러도 터무니없는 값이 되지 않게 -10 ~ 10으로 묶는다. (앱은 0 ~ 제한 횟수 안에서만 누르게 한다)
  insert into public.raid_entry_adjustments as a (week_start, nickname, raid_name, adjustment)
  values (week_start_value, nickname_value, raid_name_value, p_delta)
  on conflict (week_start, nickname, raid_name) do update
    set adjustment = greatest(-10, least(10, a.adjustment + p_delta)),
        updated_at = now()
  returning adjustment into next_value;

  return jsonb_build_object(
    'weekStart', week_start_value,
    'nickname', nickname_value,
    'raidName', raid_name_value,
    'adjustment', next_value
  );
end;
$$;

revoke execute on function public.member_adjust_raid_entries(text, text, text, integer) from public;
grant execute on function public.member_adjust_raid_entries(text, text, text, integer) to anon, authenticated;

-- 3. 실시간 반영 (다른 사람이 조정한 남은 횟수가 바로 보이도록)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'raid_entry_adjustments'
     ) then
    alter publication supabase_realtime add table public.raid_entry_adjustments;
  end if;
end;
$$;

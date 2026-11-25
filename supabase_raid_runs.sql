-- 시간대별 레이드 준비 / 클리어 기록과 디스코드 알림
-- supabase_member_password.sql을 먼저 실행한 뒤, Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다.
-- 여러 번 실행해도 안전하다.
--
-- 동작
--   - 요일별 신청 현황의 시간 줄마다 준비 상태와 클리어 O/X를 기록한다. (한 주 단위, 수요일 시작)
--   - 그 시간대에 투표한 사람만 로그인해서 바꿀 수 있고, 누가 바꿨는지 함께 남긴다.
--   - 시간대별 신청 순서: raid_schedules.slot_signed_at에 시간대마다 처음 신청한 시각을 남긴다. (트리거가 채운다)
--     먼저 신청한 10명(초월 레이드는 5명, _raid_full_size)이 정원이고, 나머지는 대기다. 시간을 다시 저장해도 이미 있던 시간대의 순서는 그대로다.
--     시간대를 뺐다가 1분 안에 다시 넣으면(삭제 되돌리기 포함) 원래 순서로 돌아가고, 그 뒤에는 맨 뒤로 간다.
--   - 정원에 든 사람이 시간대를 빼면 대기 1번이 정원으로 올라가고 디스코드로 알린다.
--   - 준비: 한 명이 "준비 확인"을 누르면 디스코드로 알림이 가고, 정원에 든 사람이 각자 "준비 완료"를 누른다.
--     정원에 든 사람이 모두 준비 완료를 누르면 전원 준비가 되고 디스코드로 완료 알림이 간다.
--     안 오는 사람이 있으면 "이 인원으로 시작"에서 실제로 갈 사람을 골라 기다리지 않고 넘어갈 수 있다. (대기자를 대신 고를 수도 있다)
--     시작한 뒤에도 "출발 인원"에서 고칠 수 있다. 출발한 사람(rally_checkins)이 클리어 명단에 들어가고 횟수가 차감된다.
--     전원 준비 뒤에는 준비 완료를 풀 수 없다. 준비 확인을 취소하면 준비 완료 · 전원 준비 · 클리어 기록을 모두 비운다.
--   - 클리어는 전원 준비 뒤에만 정할 수 있다.
--   - 횟수 제한 레이드(에라쿠스 유적 주 5회)는 한 번 출발해 여러 번 클리어할 수 있다. 누를 때마다 출발한 사람이 1회씩 차감되고,
--     누군가 마지막 1회를 써서 0회가 되는 클리어에서만 디스코드로 알린다. (clear_log에 그때 차감된 사람을 남긴다)
--   - 준비 확인 알림은 시간대마다 두 번까지 보낸다. (인원이 늘었을 때 "다시 알림"으로 한 번 더,
--     또는 취소했다가 다시 호출할 때) 전원 준비 / 클리어 알림은 시간대마다 한 번씩만 보낸다. (에라쿠스 클리어는 위 기준)
--     웹후크 주소가 비어 있으면 보내지 않는다.
--
-- 디스코드 웹후크 연결 · 확인 · 관리용 SQL은 이 파일 맨 아래 "관리용 SQL"에 있다.
-- 웹후크 주소는 DB(app_settings)에만 두고, 이 파일이나 앱 코드에는 넣지 않는다.

create extension if not exists pg_net with schema extensions;

-- 1. 기록 테이블 (읽기는 누구나, 쓰기는 아래 함수로만)
create table if not exists public.raid_runs (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  day text not null,
  time text not null,
  raid_name text not null,
  difficulty text not null,
  mode text not null,
  departed text check (departed in ('O', 'X')),
  cleared text check (cleared in ('O', 'X')),
  departed_by text,
  cleared_by text,
  departed_at timestamptz,
  cleared_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (week_start, day, time, raid_name, difficulty, mode)
);

-- 알림을 보낸 시각. 값이 있으면 같은 시간대의 같은 알림은 다시 보내지 않는다.
alter table public.raid_runs add column if not exists departed_notified_at timestamptz;
alter table public.raid_runs add column if not exists cleared_notified_at timestamptz;

-- 준비: 호출한 사람 · 시각, 체크한 닉네임 목록, 모두 모인 시각
-- (예전 출발 기록 departed* 컬럼은 더 이상 쓰지 않지만 기록 보존을 위해 남겨 둔다)
alter table public.raid_runs add column if not exists rally_called_by text;
alter table public.raid_runs add column if not exists rally_called_at timestamptz;
alter table public.raid_runs add column if not exists rally_checkins text[] not null default '{}';
alter table public.raid_runs add column if not exists gathered_at timestamptz;
alter table public.raid_runs add column if not exists rally_notified_at timestamptz;
alter table public.raid_runs add column if not exists gathered_notified_at timestamptz;

-- 준비 확인 알림을 보낸 횟수 (최대 2번). 이 컬럼이 생기기 전에 이미 보낸 시간대는 1번으로 친다.
alter table public.raid_runs add column if not exists rally_notify_count integer not null default 0;
update public.raid_runs set rally_notify_count = 1 where rally_notified_at is not null and rally_notify_count = 0;

-- 클리어 기록: [{ "at": 시각, "by": 누른 사람, "members": [클리어한 사람] }, ...]
-- 그때의 명단을 남겨, 나중에 신청을 지워도 클리어한 사람과 차감한 횟수가 바뀌지 않는다.
-- 횟수 제한 레이드(에라쿠스 유적)는 클리어할 때마다 한 건씩 쌓이고, 다른 레이드는 클리어 O일 때 한 건이다.
-- clear_finished는 마지막 횟수를 썼다고 이미 디스코드로 알린 사람
alter table public.raid_runs add column if not exists clear_log jsonb not null default '[]';
alter table public.raid_runs add column if not exists clear_finished text[] not null default '{}';

alter table public.raid_runs enable row level security;

drop policy if exists "Anyone can read raid runs" on public.raid_runs;
create policy "Anyone can read raid runs"
on public.raid_runs
for select
using (true);

-- 실시간 반영 (다른 사람이 바꾼 신청 · 준비 · 클리어 표시가 바로 보이도록)
do $$
declare
  table_name_value text;
begin
  foreach table_name_value in array array['raid_runs', 'raid_schedules', 'members'] loop
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (
         select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name_value
       ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name_value);
    end if;
  end loop;
end;
$$;

-- 시간대별 신청 순서: { "수|21:00": "처음 신청한 시각" }
-- 기존 행은 일부러 채우지 않는다. (UPDATE하면 updated_at이 바뀌어 지난주 신청이 이번 주 신청으로 되살아난다)
-- 값이 없는 시간대는 updated_at을 신청 시각으로 본다.
alter table public.raid_schedules add column if not exists slot_signed_at jsonb not null default '{}';

-- 방금 뺀 시간대의 신청 시각. 되돌리기로 다시 넣으면 순서를 유지하려고 잠깐 남겨 둔다. (앱에서 직접 읽지 않는다)
create table if not exists public.raid_slot_removed (
  nickname text not null,
  raid_name text not null,
  difficulty text not null,
  mode text not null,
  slot_key text not null,
  signed_at text not null,
  removed_at timestamptz not null default now(),
  primary key (nickname, raid_name, difficulty, mode, slot_key)
);

alter table public.raid_slot_removed enable row level security;

-- 예전 방식으로 members에 남은 요일 · 시간을 비운다. 신청은 raid_schedules에만 있고, 앱도 더 이상 members의 시간을 읽지 않는다.
update public.members set days = '{}', times = '{}' where days <> '{}' or times <> '{}';

-- 저장할 때 시간대별 신청 시각을 채운다. 이번 주에 이미 있던 시간대는 원래 시각을 그대로 둔다.
-- 지난주에 저장한 행을 다시 저장하면 새 주의 신청이므로 모두 지금 시각이 된다.
-- 1분 안에 뺐던 시간대를 다시 넣으면 뺄 때의 시각으로 돌아간다.
create or replace function public._stamp_slot_signed_at()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  slot record;
  slot_key_value text;
  previous_value text;
  stamped jsonb := '{}'::jsonb;
  was_this_week boolean := tg_op = 'UPDATE' and old.updated_at >= public._current_week_start();
begin
  for slot in
    select d.key as slot_day, t.value as slot_time
    from jsonb_each(case when jsonb_typeof(new.day_time_selection) = 'object' then new.day_time_selection else '{}'::jsonb end) d
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) t
  loop
    slot_key_value := slot.slot_day || '|' || slot.slot_time;
    previous_value := null;

    if was_this_week then
      previous_value := old.slot_signed_at ->> slot_key_value;

      if previous_value is null and coalesce(old.day_time_selection -> slot.slot_day, '[]'::jsonb) ? slot.slot_time then
        previous_value := to_jsonb(old.updated_at) #>> '{}';
      end if;
    end if;

    if previous_value is null then
      select r.signed_at into previous_value
      from public.raid_slot_removed r
      where r.nickname = new.nickname
        and r.raid_name = new.raid_name
        and r.difficulty = new.difficulty
        and r.mode = new.mode
        and r.slot_key = slot_key_value
        and r.removed_at > now() - interval '1 minute';
    end if;

    stamped := stamped || jsonb_build_object(slot_key_value, coalesce(previous_value, to_jsonb(now()) #>> '{}'));
  end loop;

  new.slot_signed_at := stamped;
  return new;
end;
$$;

revoke execute on function public._stamp_slot_signed_at() from public, anon, authenticated;

drop trigger if exists raid_schedules_slot_signed_at on public.raid_schedules;
create trigger raid_schedules_slot_signed_at
before insert or update on public.raid_schedules
for each row
execute procedure public._stamp_slot_signed_at();

-- 2. 디스코드 웹후크 주소 (app_settings는 외부에서 읽을 수 없다)
insert into public.app_settings (key, value)
values ('discord_webhook_url', '')
on conflict (key) do nothing;

-- 웹후크로 메시지를 보낸다. 주소가 없으면 false. (pg_net은 비동기라 전송 실패가 저장을 막지 않는다)
create or replace function public._send_discord(p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  webhook_url text;
begin
  select btrim(value) into webhook_url from public.app_settings where key = 'discord_webhook_url';

  if coalesce(webhook_url, '') = '' then
    return false;
  end if;

  perform net.http_post(
    url := webhook_url,
    body := p_payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );

  return true;
end;
$$;

revoke execute on function public._send_discord(jsonb) from public, anon, authenticated;

-- 그 주 그 시간대(요일 · 시간 · 레이드 조합)에 참여로 투표한 스케줄
-- 앱의 "요일별 레이드 신청 현황"과 같은 기준으로, 그 주 수요일 00시(한국 시간) 이후에 저장한 신청만 본다.
-- (주 구분 없이 지난주 신청까지 읽던 예전 5개 인자 버전은 지운다)
drop function if exists public._raid_slot_voters(text, text, text, text, text);

create or replace function public._raid_slot_voters(
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text
)
returns setof public.raid_schedules
language sql
stable
security definer
set search_path = public, extensions
as $$
  select s.*
  from public.raid_schedules s
  where s.raid_name = p_raid_name
    and s.difficulty = p_difficulty
    and s.mode = p_mode
    and s.attendance = '참'
    and s.updated_at >= (p_week_start::timestamp at time zone 'Asia/Seoul')
    and (
      coalesce(s.day_time_selection -> p_day, '[]'::jsonb) ? p_time
      -- 요일별 시간이 없는 예전 기록은 days × times 조합으로 본다.
      or (coalesce(s.day_time_selection, '{}'::jsonb) = '{}'::jsonb and p_day = any(s.days) and p_time = any(s.times))
    );
$$;

revoke execute on function public._raid_slot_voters(date, text, text, text, text, text) from public, anon, authenticated;

-- 레이드별 한 타임 정원. 기본 10명(5명 × 2파티), 초월(에라쿠스 유적)은 5명 1파티.
-- 앱의 getRaidFullSize(src/lib/schedule.js)와 같은 값이어야 한다.
create or replace function public._raid_full_size(p_raid_name text)
returns integer
language sql
immutable
set search_path = public, extensions
as $$
  select case p_raid_name when '에라쿠스 유적' then 5 else 10 end;
$$;

revoke execute on function public._raid_full_size(text) from public, anon, authenticated;

-- 캐릭터마다 일주일에 클리어할 수 있는 횟수. 0이면 제한 없음. 앱의 raidOptions.weeklyLimit(src/lib/schedule.js)과 같은 값이어야 한다.
create or replace function public._raid_weekly_limit(p_raid_name text)
returns integer
language sql
immutable
set search_path = public, extensions
as $$
  select case p_raid_name when '에라쿠스 유적' then 5 else 0 end;
$$;

revoke execute on function public._raid_weekly_limit(text) from public, anon, authenticated;

-- 그 시간대의 정원: 먼저 신청한 _raid_full_size명(기본 10명, 초월 5명). 앱의 정렬(compareSlotPeople)과 같은 기준이어야 한다.
-- 앱은 밀리초까지만 다루므로 여기서도 밀리초로 맞추고, 같으면 닉네임 순(코드값)으로 정한다.
create or replace function public._raid_slot_roster(
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text
)
returns setof public.raid_schedules
language sql
stable
security definer
set search_path = public, extensions
as $$
  select v.*
  from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
  order by
    date_trunc('milliseconds', coalesce((v.slot_signed_at ->> (p_day || '|' || p_time))::timestamptz, v.updated_at)),
    v.nickname collate "C"
  limit public._raid_full_size(p_raid_name);
$$;

revoke execute on function public._raid_slot_roster(date, text, text, text, text, text) from public, anon, authenticated;

-- 신청에서 시간대가 빠졌을 때: 되돌리기에 쓸 신청 시각을 남기고, 대기 1번이 정원으로 올라갔으면 디스코드로 알린다.
-- 이 트리거의 실패가 신청 저장 · 삭제를 막지 않도록 오류는 경고로만 남긴다.
create or replace function public._after_raid_slot_removed()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  removed record;
  slot_key_value text;
  removed_order timestamptz;
  week_start_value date;
  slot_date date;
  slot_start timestamptz;
  tenth public.raid_schedules;
  tenth_order timestamptz;
  promoted_lines text[] := '{}';
begin
  if old.attendance <> '참' or old.updated_at < public._current_week_start() then
    return null;
  end if;

  week_start_value := (public._current_week_start() at time zone 'Asia/Seoul')::date;
  delete from public.raid_slot_removed where removed_at < now() - interval '1 hour';

  for removed in
    select d.key as slot_day, t.value as slot_time
    from jsonb_each(case when jsonb_typeof(old.day_time_selection) = 'object' then old.day_time_selection else '{}'::jsonb end) d
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) t
    where tg_op = 'DELETE'
       or new.attendance <> '참'
       or not coalesce(new.day_time_selection -> d.key, '[]'::jsonb) ? t.value
  loop
    slot_key_value := removed.slot_day || '|' || removed.slot_time;
    removed_order := date_trunc('milliseconds', coalesce((old.slot_signed_at ->> slot_key_value)::timestamptz, old.updated_at));

    insert into public.raid_slot_removed (nickname, raid_name, difficulty, mode, slot_key, signed_at)
    values (old.nickname, old.raid_name, old.difficulty, old.mode, slot_key_value, to_jsonb(removed_order) #>> '{}')
    on conflict (nickname, raid_name, difficulty, mode, slot_key) do update
    set signed_at = excluded.signed_at,
        removed_at = now();

    slot_date := week_start_value + (array_position(array['수', '목', '금', '토', '일', '월', '화'], removed.slot_day) - 1);

    if slot_date is null then
      continue;
    end if;

    slot_start := (slot_date + case when removed.slot_time = '00:00' then 1 else 0 end + removed.slot_time::time) at time zone 'Asia/Seoul';

    if slot_start <= now() then
      continue;
    end if;

    -- 뺀 뒤의 정원 마지막 사람(10번째, 초월은 5번째)이 뺀 사람보다 늦게 신청했으면, 그 사람이 대기에서 올라온 것이다.
    select * into tenth
    from public._raid_slot_roster(week_start_value, removed.slot_day, removed.slot_time, old.raid_name, old.difficulty, old.mode)
    offset public._raid_full_size(old.raid_name) - 1
    limit 1;

    if tenth.nickname is null then
      continue;
    end if;

    tenth_order := date_trunc('milliseconds', coalesce((tenth.slot_signed_at ->> slot_key_value)::timestamptz, tenth.updated_at));

    if removed_order < tenth_order or (removed_order = tenth_order and (old.nickname collate "C") < (tenth.nickname collate "C")) then
      promoted_lines := promoted_lines || format(
        '%s월 %s일 (%s) %s · %s · %s · %s: %s',
        extract(month from slot_date),
        extract(day from slot_date),
        removed.slot_day,
        case when removed.slot_time = '00:00' then '24:00' else removed.slot_time end,
        old.raid_name,
        old.difficulty,
        old.mode,
        tenth.nickname
      );
    end if;
  end loop;

  if array_length(promoted_lines, 1) > 0 then
    perform public._send_discord(jsonb_build_object(
      'username', '레이드 캘린더',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '🎟 대기에서 정원으로',
        'color', 5793266,
        'description', left(array_to_string(promoted_lines, E'\n'), 3500)
      ))
    ));
  end if;

  return null;
exception when others then
  raise warning '_after_raid_slot_removed 실패: %', sqlerrm;
  return null;
end;
$$;

revoke execute on function public._after_raid_slot_removed() from public, anon, authenticated;

drop trigger if exists raid_schedules_slot_removed on public.raid_schedules;
create trigger raid_schedules_slot_removed
after update or delete on public.raid_schedules
for each row
execute procedure public._after_raid_slot_removed();

-- 준비 확인을 시작했고, 그 시간대 정원에 든 사람이 모두 체크했는지
create or replace function public._raid_run_all_gathered(p_run public.raid_runs)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_run.rally_called_at is not null
    and exists (
      select 1 from public._raid_slot_roster(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode)
    )
    and not exists (
      select 1
      from public._raid_slot_roster(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode) v
      where not (v.nickname = any(p_run.rally_checkins))
    );
$$;

revoke execute on function public._raid_run_all_gathered(public.raid_runs) from public, anon, authenticated;

-- 알림에 넣는 일정 문구: "10월 8일 (수) 21:00". 00:00은 그 요일 밤 12시라서 앱과 같이 24:00으로 쓴다.
create or replace function public._raid_run_schedule_text(p_run public.raid_runs)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select format('%s월 %s일 (%s) %s', extract(month from d), extract(day from d), p_run.day, case when p_run.time = '00:00' then '24:00' else p_run.time end)
  from (
    select p_run.week_start + (array_position(array['수', '목', '금', '토', '일', '월', '화'], p_run.day) - 1) as d
  ) t;
$$;

revoke execute on function public._raid_run_schedule_text(public.raid_runs) from public, anon, authenticated;

-- 출발한 사람: 그 시간대 신청자 중 준비 완료로 되어 있는 사람 (신청 순서대로). 대기자도 출발 인원으로 고르면 들어간다.
-- 지난주 시간대는 새 주 신청으로 바뀌어 신청자를 알 수 없으므로, 준비 완료로 되어 있는 사람을 그대로 본다.
create or replace function public._raid_departed(p_run public.raid_runs)
returns table (nickname text, sort_order bigint)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select v.nickname, row_number() over (
    order by
      date_trunc('milliseconds', coalesce((v.slot_signed_at ->> (p_run.day || '|' || p_run.time))::timestamptz, v.updated_at)),
      v.nickname collate "C"
  )
  from public._raid_slot_voters(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode) v
  where p_run.week_start >= (public._current_week_start() at time zone 'Asia/Seoul')::date
    and v.nickname = any(p_run.rally_checkins)
  union all
  select c.name, c.position
  from unnest(p_run.rally_checkins) with ordinality as c(name, position)
  where p_run.week_start < (public._current_week_start() at time zone 'Asia/Seoul')::date;
$$;

revoke execute on function public._raid_departed(public.raid_runs) from public, anon, authenticated;

-- 3. 횟수 제한 레이드(에라쿠스 유적)의 클리어 횟수
-- 그 주에 그 캐릭터에게 남은 횟수. 제한이 없는 레이드면 null.
-- 남은 횟수 = 제한 − (클리어 기록에 들어간 횟수 + 직접 조정). 앱의 getEntryUsage와 같은 기준이어야 한다.
-- 직접 조정 표(supabase_raid_entries.sql)가 아직 없으면 조정 없이 계산한다.
create or replace function public._raid_entries_left(p_week_start date, p_raid_name text, p_nickname text)
returns integer
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  limit_value integer := public._raid_weekly_limit(p_raid_name);
  cleared_count integer;
  adjustment_value integer := 0;
begin
  if limit_value = 0 then
    return null;
  end if;

  select count(*) into cleared_count
  from public.raid_runs r
  cross join lateral jsonb_array_elements(r.clear_log) e
  where r.week_start = p_week_start
    and r.raid_name = p_raid_name
    and (e -> 'members') ? p_nickname;

  if to_regclass('public.raid_entry_adjustments') is not null then
    execute 'select coalesce(sum(adjustment), 0)::integer from public.raid_entry_adjustments where week_start = $1 and raid_name = $2 and nickname = $3'
    into adjustment_value
    using p_week_start, p_raid_name, p_nickname;
  end if;

  return greatest(0, limit_value - greatest(0, cleared_count + adjustment_value));
end;
$$;

revoke execute on function public._raid_entries_left(date, text, text) from public, anon, authenticated;

-- 클리어 1회를 기록한다. 출발한 사람(_raid_departed) 중 횟수가 남은 사람이 정원까지 1회씩 차감된다.
-- 디스코드는 남은 횟수가 1회였다가 0회가 된 사람이 있을 때만 알린다. 같은 시간대에서 같은 사람은 한 번만 알린다.
create or replace function public._raid_clear_add(p_run_id uuid, p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  run_row public.raid_runs;
  limit_value integer;
  charged text[];
  finished text[];
  members_text text;
  notified boolean := false;
begin
  select * into run_row from public.raid_runs where id = p_run_id for update;
  limit_value := public._raid_weekly_limit(run_row.raid_name);

  select
    array_agg(t.nickname order by t.nickname) filter (where t.entries_left > 0),
    array_agg(t.nickname order by t.nickname) filter (where t.entries_left = 1 and not (t.nickname = any(run_row.clear_finished)))
  into charged, finished
  from (
    select d.nickname, e.entries_left
    from public._raid_departed(run_row) d
    cross join lateral (
      select public._raid_entries_left(run_row.week_start, run_row.raid_name, d.nickname) as entries_left
    ) e
    where e.entries_left > 0
    order by d.sort_order
    limit public._raid_full_size(run_row.raid_name)
  ) t;

  if charged is null then
    return jsonb_build_object('error', 'no_entries_left', 'run', to_jsonb(run_row));
  end if;

  update public.raid_runs
  set clear_log = clear_log || jsonb_build_array(jsonb_build_object('at', now(), 'by', p_nickname, 'members', to_jsonb(charged))),
      cleared = 'O',
      cleared_by = p_nickname,
      cleared_at = now(),
      updated_at = now()
  where id = p_run_id
  returning * into run_row;

  if finished is not null then
    select string_agg(
      format('%s %s/%s', n.nickname, public._raid_entries_left(run_row.week_start, run_row.raid_name, n.nickname), limit_value),
      ', ' order by n.nickname
    )
    into members_text
    from unnest(charged) as n(nickname);

    notified := public._send_discord(jsonb_build_object(
      'username', '레이드 캘린더',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', format('🏆 이번 주 %s회 완료! | %s · %s · %s', limit_value, run_row.raid_name, run_row.difficulty, run_row.mode),
        'color', 16766720,
        'description', format(E'📅 %s\n이번 출발에서 클리어 %s회', public._raid_run_schedule_text(run_row), jsonb_array_length(run_row.clear_log)),
        'fields', jsonb_build_array(
          jsonb_build_object('name', format('✅ 이번 주 %s회를 모두 마친 사람', limit_value), 'value', left(array_to_string(finished, ', '), 1000)),
          jsonb_build_object('name', '참여 인원 (남은 횟수)', 'value', left(members_text, 1000))
        ),
        'footer', jsonb_build_object('text', '클리어 표시: ' || p_nickname)
      ))
    ));

    -- 실제로 보냈을 때만 기록한다. (되돌렸다가 다시 눌러도 같은 사람을 두 번 알리지 않는다)
    if notified then
      update public.raid_runs
      set clear_finished = clear_finished || finished,
          cleared_notified_at = now()
      where id = p_run_id
      returning * into run_row;
    end if;
  end if;

  return jsonb_build_object('run', to_jsonb(run_row), 'notified', notified);
end;
$$;

revoke execute on function public._raid_clear_add(uuid, text) from public, anon, authenticated;

-- 클리어 1회 추가('add') / 마지막 1회 되돌리기('undo')
--    p_expected_count: 누른 사람 화면의 클리어 횟수. 여러 명이 같은 클리어를 동시에 눌러 두 번 차감되는 것을 막는다.
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant' | 'not_gathered'
--                            | 'clear_changed'(다른 사람이 먼저 바꿈) | 'no_entries_left', "run": {...} }
create or replace function public.member_raid_clear_count(
  p_nickname text,
  p_password text,
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text,
  p_action text,
  p_expected_count integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
  run_row public.raid_runs;
  last_clear jsonb;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  if p_action is null or p_action not in ('add', 'undo') or public._raid_weekly_limit(p_raid_name) = 0 then
    return jsonb_build_object('error', 'bad_request');
  end if;

  -- 그 시간대에 투표한 사람만 바꿀 수 있다.
  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value
  ) then
    return jsonb_build_object('error', 'not_participant');
  end if;

  select * into run_row
  from public.raid_runs
  where week_start = p_week_start and day = p_day and time = p_time
    and raid_name = p_raid_name and difficulty = p_difficulty and mode = p_mode
  for update;

  if run_row.id is null or run_row.rally_called_at is null then
    return jsonb_build_object('error', 'not_gathered');
  end if;

  -- 호출 뒤에 체크하지 않은 사람이 투표를 지워 모두 모인 상태가 됐을 수 있으니 한 번 더 본다.
  if run_row.gathered_at is null and public._raid_run_all_gathered(run_row) then
    update public.raid_runs set gathered_at = now() where id = run_row.id returning * into run_row;
  end if;

  if run_row.gathered_at is null then
    return jsonb_build_object('error', 'not_gathered');
  end if;

  if jsonb_array_length(run_row.clear_log) is distinct from p_expected_count then
    return jsonb_build_object('error', 'clear_changed', 'run', to_jsonb(run_row));
  end if;

  if p_action = 'add' then
    return public._raid_clear_add(run_row.id, nickname_value);
  end if;

  if p_expected_count = 0 then
    return jsonb_build_object('error', 'bad_request', 'run', to_jsonb(run_row));
  end if;

  last_clear := (run_row.clear_log - (-1)) -> -1;

  update public.raid_runs
  set clear_log = clear_log - (-1),
      cleared = case when last_clear is null then null else 'O' end,
      cleared_by = last_clear ->> 'by',
      cleared_at = (last_clear ->> 'at')::timestamptz,
      updated_at = now()
  where id = run_row.id
  returning * into run_row;

  return jsonb_build_object('run', to_jsonb(run_row), 'notified', false);
end;
$$;

revoke execute on function public.member_raid_clear_count(text, text, date, text, text, text, text, text, text, integer) from public;
grant execute on function public.member_raid_clear_count(text, text, date, text, text, text, text, text, text, integer) to anon, authenticated;

-- 이 기능 전에 클리어 O로 표시한 이번 주 기록을 클리어 1회로 옮긴다. (그때 기준대로 정원 전원. 한 번 옮긴 기록은 다시 바뀌지 않는다)
update public.raid_runs run
set clear_log = jsonb_build_array(jsonb_build_object(
  'at', run.cleared_at,
  'by', run.cleared_by,
  'members', coalesce((
    select jsonb_agg(r.nickname)
    from public._raid_slot_roster(run.week_start, run.day, run.time, run.raid_name, run.difficulty, run.mode) r
  ), '[]'::jsonb)
))
where run.week_start = (public._current_week_start() at time zone 'Asia/Seoul')::date
  and run.cleared = 'O'
  and run.clear_log = '[]'::jsonb;

-- 4. 클리어 표시
--    횟수 제한 레이드(에라쿠스 유적)는 위 member_raid_clear_count로 센다. 여기서는 실패(X)와 표시 지우기만 쓰고,
--    예전 화면이 'O'를 보내면 클리어 1회로 기록한다.
--    p_field: 'cleared' (예전 'departed'는 준비로 바뀌어 받지 않는다), p_value: 'O' | 'X' | null(표시 지우기)
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant' | 'not_gathered' | 'clear_count_only' }
create or replace function public.member_set_raid_run_status(
  p_nickname text,
  p_password text,
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text,
  p_field text,
  p_value text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
  run_row public.raid_runs;
  previous_value text;
  run_title text := format('%s · %s · %s', p_raid_name, p_difficulty, p_mode);
  members_text text;
  payload jsonb;
  notified boolean := false;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  if p_field is distinct from 'cleared'
     or (p_value is not null and p_value not in ('O', 'X'))
     or array_position(array['수', '목', '금', '토', '일', '월', '화'], p_day) is null then
    return jsonb_build_object('error', 'bad_request');
  end if;

  -- 그 시간대에 투표한 사람만 바꿀 수 있다.
  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value
  ) then
    return jsonb_build_object('error', 'not_participant');
  end if;

  select * into run_row
  from public.raid_runs
  where week_start = p_week_start and day = p_day and time = p_time
    and raid_name = p_raid_name and difficulty = p_difficulty and mode = p_mode
  for update;

  if run_row.id is null or run_row.rally_called_at is null then
    return jsonb_build_object('error', 'not_gathered');
  end if;

  -- 호출 뒤에 체크하지 않은 사람이 투표를 지워 모두 모인 상태가 됐을 수 있으니 한 번 더 본다.
  if run_row.gathered_at is null and public._raid_run_all_gathered(run_row) then
    update public.raid_runs set gathered_at = now() where id = run_row.id returning * into run_row;
  end if;

  if run_row.gathered_at is null then
    return jsonb_build_object('error', 'not_gathered');
  end if;

  if public._raid_weekly_limit(p_raid_name) > 0 then
    if p_value = 'O' then
      if jsonb_array_length(run_row.clear_log) > 0 then
        return jsonb_build_object('run', to_jsonb(run_row), 'notified', false);
      end if;

      return public._raid_clear_add(run_row.id, nickname_value);
    end if;

    -- 여러 번 센 클리어를 한꺼번에 지우지 않는다.
    if jsonb_array_length(run_row.clear_log) > 1 then
      return jsonb_build_object('error', 'clear_count_only', 'run', to_jsonb(run_row));
    end if;
  end if;

  previous_value := run_row.cleared;

  update public.raid_runs
  set cleared = p_value,
      -- 클리어한 사람: 출발한 사람. (아무도 없으면 정원 전원)
      clear_log = case when p_value = 'O' then jsonb_build_array(jsonb_build_object(
        'at', now(),
        'by', nickname_value,
        'members', coalesce(
          (
            select jsonb_agg(t.nickname order by t.sort_order)
            from (
              select d.nickname, d.sort_order
              from public._raid_departed(run_row) d
              order by d.sort_order
              limit public._raid_full_size(p_raid_name)
            ) t
          ),
          (
            select jsonb_agg(r.nickname)
            from public._raid_slot_roster(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) r
          ),
          '[]'::jsonb
        )
      )) else '[]'::jsonb end,
      cleared_by = case when p_value is null then null else nickname_value end,
      cleared_at = case when p_value is null then null else now() end,
      updated_at = now()
  where id = run_row.id
  returning * into run_row;

  -- O로 바뀌는 순간, 그 시간대에 아직 클리어 알림을 보낸 적이 없을 때만 알린다.
  if p_value = 'O' and previous_value is distinct from 'O' and run_row.cleared_notified_at is null then
    select string_agg(s.nickname || case when s.lead_ready = 'O' then '★' else '' end, ', ' order by (s.lead_ready = 'O') desc, s.nickname)
    into members_text
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) s
    where (run_row.clear_log -> -1 -> 'members') ? s.nickname;

    payload := jsonb_build_object(
      'username', '레이드 캘린더',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', '🏆 클리어! | ' || run_title,
        'color', 16766720,
        'description', format(
          E'📅 %s\n⏱ 준비 %s → 클리어 %s (%s분)',
          public._raid_run_schedule_text(run_row),
          to_char(run_row.gathered_at at time zone 'Asia/Seoul', 'HH24:MI'),
          to_char(run_row.cleared_at at time zone 'Asia/Seoul', 'HH24:MI'),
          floor(extract(epoch from run_row.cleared_at - run_row.gathered_at) / 60)::integer
        ),
        'fields', jsonb_build_array(
          jsonb_build_object('name', '참여 인원', 'value', left(coalesce(members_text, '없음'), 1000))
        ),
        'footer', jsonb_build_object('text', '클리어 표시: ' || nickname_value)
      ))
    );

    notified := public._send_discord(payload);

    -- 실제로 보냈을 때만 기록한다. (웹후크를 연결하기 전에 누른 O는 나중에 다시 알릴 수 있다)
    if notified then
      update public.raid_runs set cleared_notified_at = now() where id = run_row.id returning * into run_row;
    end if;
  end if;

  return jsonb_build_object('run', to_jsonb(run_row), 'notified', notified);
end;
$$;

revoke execute on function public.member_set_raid_run_status(text, text, date, text, text, text, text, text, text, text) from public;
grant execute on function public.member_set_raid_run_status(text, text, date, text, text, text, text, text, text, text) to anon, authenticated;

-- 5. 준비 확인 / 준비 완료
--    p_action: 'call'(호출, 호출한 사람은 자동 체크) | 'check' | 'uncheck' | 'cancel'(호출 취소)
--              | 'remind'(준비 확인 중에 디스코드로 한 번 더 알림)
--              | 'start'(아직 준비 안 한 사람을 기다리지 않고 전원 준비로 넘어감)
--              | 'members'(시작한 뒤 출발 인원 고치기)
--    p_members: 'start' · 'members'에서 실제로 출발하는 사람. 그 시간대 신청자(대기 포함) 중에서 정원까지.
--               'start'에서 비우면 지금까지 준비 완료한 사람 그대로 시작한다.
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant'
--                            | 'already_called' | 'not_called' | 'already_gathered' | 'not_gathered' | 'notify_limit'
--                            | 'no_members'(아무도 안 고름) | 'too_many_members'(정원 초과) }
drop function if exists public.member_raid_rally(text, text, date, text, text, text, text, text, text);

create or replace function public.member_raid_rally(
  p_nickname text,
  p_password text,
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text,
  p_action text,
  p_members text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
  run_row public.raid_runs;
  run_title text := format('%s · %s · %s', p_raid_name, p_difficulty, p_mode);
  member_count integer;
  ready_count integer;
  members_text text;
  leaders_text text;
  waiting_text text;
  overflow_text text;
  departed_text text;
  departing text[];
  just_gathered boolean := false;
  notified boolean := false;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  if p_action not in ('call', 'check', 'uncheck', 'cancel', 'remind', 'start', 'members')
     or (p_action = 'members' and p_members is null)
     or array_position(array['수', '목', '금', '토', '일', '월', '화'], p_day) is null then
    return jsonb_build_object('error', 'bad_request');
  end if;

  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value
  ) then
    return jsonb_build_object('error', 'not_participant');
  end if;

  -- 고른 출발 인원. 그 사이 신청을 지운 사람은 빠진다.
  if p_action in ('start', 'members') and p_members is not null then
    select array_agg(v.nickname order by v.nickname) into departing
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = any(p_members);

    if departing is null then
      return jsonb_build_object('error', 'no_members');
    end if;

    if array_length(departing, 1) > public._raid_full_size(p_raid_name) then
      return jsonb_build_object('error', 'too_many_members');
    end if;
  end if;

  insert into public.raid_runs (week_start, day, time, raid_name, difficulty, mode)
  values (p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode)
  on conflict (week_start, day, time, raid_name, difficulty, mode) do nothing;

  select * into run_row
  from public.raid_runs
  where week_start = p_week_start and day = p_day and time = p_time
    and raid_name = p_raid_name and difficulty = p_difficulty and mode = p_mode
  for update;

  if p_action = 'call' then
    if run_row.rally_called_at is not null then
      return jsonb_build_object('error', 'already_called', 'run', to_jsonb(run_row));
    end if;

    update public.raid_runs
    set rally_called_by = nickname_value,
        rally_called_at = now(),
        rally_checkins = array[nickname_value],
        gathered_at = null,
        updated_at = now()
    where id = run_row.id
    returning * into run_row;
  elsif p_action = 'cancel' then
    update public.raid_runs
    set rally_called_by = null,
        rally_called_at = null,
        rally_checkins = '{}',
        gathered_at = null,
        -- 준비 확인이 없던 일이 되면 클리어 기록도 의미가 없으므로 비운다. (차감한 횟수도 되돌아간다)
        clear_log = '[]',
        cleared = null,
        cleared_by = null,
        cleared_at = null,
        updated_at = now()
    where id = run_row.id
    returning * into run_row;

    return jsonb_build_object('run', to_jsonb(run_row), 'notified', false);
  elsif p_action = 'remind' then
    if run_row.rally_called_at is null then
      return jsonb_build_object('error', 'not_called', 'run', to_jsonb(run_row));
    end if;

    if run_row.gathered_at is not null then
      return jsonb_build_object('error', 'already_gathered', 'run', to_jsonb(run_row));
    end if;

    if run_row.rally_notify_count >= 2 then
      return jsonb_build_object('error', 'notify_limit', 'run', to_jsonb(run_row));
    end if;
  elsif p_action = 'start' then
    if run_row.rally_called_at is null then
      return jsonb_build_object('error', 'not_called', 'run', to_jsonb(run_row));
    end if;

    if run_row.gathered_at is not null then
      return jsonb_build_object('error', 'already_gathered', 'run', to_jsonb(run_row));
    end if;

    update public.raid_runs
    set gathered_at = now(),
        rally_checkins = coalesce(departing, rally_checkins),
        updated_at = now()
    where id = run_row.id
    returning * into run_row;

    just_gathered := true;
  elsif p_action = 'members' then
    if run_row.gathered_at is null then
      return jsonb_build_object('error', 'not_gathered', 'run', to_jsonb(run_row));
    end if;

    update public.raid_runs
    set rally_checkins = departing,
        updated_at = now()
    where id = run_row.id
    returning * into run_row;

    return jsonb_build_object('run', to_jsonb(run_row), 'notified', false);
  else
    if run_row.rally_called_at is null then
      return jsonb_build_object('error', 'not_called', 'run', to_jsonb(run_row));
    end if;

    if p_action = 'uncheck' and run_row.gathered_at is not null then
      return jsonb_build_object('error', 'already_gathered', 'run', to_jsonb(run_row));
    end if;

    update public.raid_runs
    set rally_checkins = case
          when p_action = 'check' then
            case when nickname_value = any(rally_checkins) then rally_checkins else array_append(rally_checkins, nickname_value) end
          else array_remove(rally_checkins, nickname_value)
        end,
        updated_at = now()
    where id = run_row.id
    returning * into run_row;
  end if;

  -- 정원에 든 사람이 모두 체크했으면 전원 준비
  if run_row.gathered_at is null and public._raid_run_all_gathered(run_row) then
    update public.raid_runs set gathered_at = now() where id = run_row.id returning * into run_row;
    just_gathered := true;
  end if;

  -- 이 시간대 정원에 든 인원 (리딩 가능자 먼저, ★ 표시)
  select
    count(*),
    count(*) filter (where s.nickname = any(run_row.rally_checkins)),
    string_agg(s.nickname || case when s.lead_ready = 'O' then '★' else '' end, ', ' order by (s.lead_ready = 'O') desc, s.nickname),
    string_agg(s.nickname, ', ' order by s.nickname) filter (where s.lead_ready = 'O'),
    string_agg(s.nickname, ', ' order by s.nickname) filter (where not (s.nickname = any(run_row.rally_checkins)))
  into member_count, ready_count, members_text, leaders_text, waiting_text
  from public._raid_slot_roster(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) s;

  -- '이 인원으로 시작' 알림에는 정원 전체가 아니라 실제로 출발하는 사람을 적는다.
  if p_action = 'start' then
    select
      count(*),
      string_agg(v.nickname || case when v.lead_ready = 'O' then '★' else '' end, ', ' order by (v.lead_ready = 'O') desc, v.nickname),
      string_agg(v.nickname, ', ' order by v.nickname) filter (where v.lead_ready = 'O')
    into ready_count, departed_text, leaders_text
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = any(run_row.rally_checkins);
  end if;

  -- 정원을 넘어 대기 중인 인원
  select string_agg(v.nickname, ', ' order by v.nickname)
  into overflow_text
  from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
  where v.nickname not in (
    select r.nickname from public._raid_slot_roster(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) r
  );

  -- 준비 확인 알림: 호출 때 한 번, 인원이 늘었을 때 다시 알림으로 한 번 더 (시간대마다 최대 2번)
  if p_action in ('call', 'remind') and run_row.rally_notify_count < 2 then
    if public._send_discord(jsonb_build_object(
      'username', '레이드 캘린더',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', case when p_action = 'remind' then '📣 준비 확인 (다시 알림) | ' else '📣 준비 확인 | ' end || run_title,
        'description', '레이드 캘린더에서 준비 완료를 눌러 주세요. 모두 누르면 전원 준비 알림이 갑니다.',
        'color', 5793266,
        'fields', jsonb_build_array(
          jsonb_build_object('name', '📅 일정', 'value', public._raid_run_schedule_text(run_row), 'inline', true),
          jsonb_build_object('name', '👥 인원', 'value', member_count || '명', 'inline', true),
          jsonb_build_object('name', '★ 리딩', 'value', coalesce(leaders_text, '없음'), 'inline', true),
          jsonb_build_object('name', '참여 인원', 'value', left(coalesce(members_text, '없음'), 1000))
        ) || case when p_action = 'remind' then jsonb_build_array(
          jsonb_build_object('name', '⏳ 아직 준비 안 함', 'value', left(coalesce(waiting_text, '없음'), 1000))
        ) else '[]'::jsonb end || case when overflow_text is not null then jsonb_build_array(
          jsonb_build_object('name', '🕒 대기', 'value', left(overflow_text, 1000))
        ) else '[]'::jsonb end,
        'footer', jsonb_build_object('text', case when p_action = 'remind' then '다시 알림: ' else '준비 확인: ' end || nickname_value)
      ))
    )) then
      notified := true;
      update public.raid_runs
      set rally_notified_at = now(),
          rally_notify_count = rally_notify_count + 1
      where id = run_row.id
      returning * into run_row;
    end if;
  end if;

  if just_gathered and run_row.gathered_notified_at is null then
    if public._send_discord(jsonb_build_object(
      'username', '레이드 캘린더',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', case when p_action = 'start' then '▶️ 이 인원으로 시작 | ' else '✅ 전원 준비 | ' end || run_title,
        'color', 5693610,
        'description', format(
          E'📅 %s\n⏱ 확인 시작 %s → 시작 %s (%s분)',
          public._raid_run_schedule_text(run_row),
          to_char(run_row.rally_called_at at time zone 'Asia/Seoul', 'HH24:MI'),
          to_char(run_row.gathered_at at time zone 'Asia/Seoul', 'HH24:MI'),
          floor(extract(epoch from run_row.gathered_at - run_row.rally_called_at) / 60)::integer
        ),
        'fields', jsonb_build_array(
          jsonb_build_object(
            'name', '👥 인원',
            'value', case
              when p_action = 'start' then ready_count || '/' || member_count || '명 출발'
              when ready_count >= member_count then member_count || '명 모두 준비됐어요'
              else ready_count || '/' || member_count || '명 준비'
            end,
            'inline', true
          ),
          jsonb_build_object('name', '★ 리딩', 'value', coalesce(leaders_text, '없음'), 'inline', true),
          jsonb_build_object('name', '참여 인원', 'value', left(coalesce(departed_text, members_text, '없음'), 1000))
        ) || case when p_action = 'start' and waiting_text is not null then jsonb_build_array(
          jsonb_build_object('name', '⏳ 함께 출발 안 함', 'value', left(waiting_text, 1000))
        ) else '[]'::jsonb end,
        'footer', jsonb_build_object('text', case when p_action = 'start' then '시작: ' || nickname_value else '준비 확인: ' || coalesce(run_row.rally_called_by, '-') end)
      ))
    )) then
      notified := true;
      update public.raid_runs set gathered_notified_at = now() where id = run_row.id returning * into run_row;
    end if;
  end if;

  return jsonb_build_object('run', to_jsonb(run_row), 'notified', notified);
end;
$$;

revoke execute on function public.member_raid_rally(text, text, date, text, text, text, text, text, text, text[]) from public;
grant execute on function public.member_raid_rally(text, text, date, text, text, text, text, text, text, text[]) to anon, authenticated;

notify pgrst, 'reload schema';

-- ===========================================================================
-- 관리용 SQL
-- 위 파일 전체를 실행할 때 같이 돌지 않도록 주석으로 둔다.
-- 필요한 부분만 SQL Editor에 복사하고, 줄 앞의 "-- "를 지운 뒤 실행한다.
-- ===========================================================================

-- [1] 디스코드 웹후크 연결 / 주소 변경
--     웹후크 주소는 디스코드 채널 편집 → 연동 → 웹후크에서 복사한다.
-- update public.app_settings
-- set value = '웹후크 주소'
-- where key = 'discord_webhook_url';

-- [2] 연결 확인
--     주소가 들어갔는지 (앞부분만 표시)
-- select key, left(value, 45) || '...' as value
-- from public.app_settings
-- where key = 'discord_webhook_url';
--
--     pg_net이 켜져 있는지 (한 줄이 나오면 정상)
-- select extname, extversion from pg_extension where extname = 'pg_net';

-- [3] 알림 끄기 (다시 켜려면 [1]을 실행)
-- update public.app_settings set value = '' where key = 'discord_webhook_url';

-- [4] 이번 주 준비 / 클리어 기록 보기
-- select day, time, raid_name, difficulty, mode,
--        rally_called_by, rally_checkins, gathered_at is not null as 전원준비,
--        cleared, cleared_by,
--        rally_notify_count as 확인알림횟수,
--        gathered_notified_at is not null as 준비알림,
--        cleared_notified_at is not null as 클리어알림
-- from public.raid_runs
-- where week_start = (current_date - ((extract(isodow from current_date)::int + 4) % 7))
-- order by array_position(array['수', '목', '금', '토', '일', '월', '화'], day), time;

-- [5] 테스트로 누른 시간대 기록 지우기
--     기록과 알림 여부가 함께 초기화되므로, 다시 호출하면 알림이 또 간다.
-- delete from public.raid_runs
-- where week_start = (current_date - ((extract(isodow from current_date)::int + 4) % 7))
--   and day = '수' and time = '21:00'
--   and raid_name = '무스펠' and difficulty = '보통' and mode = '트라이';

-- [7] 준비 확인이 끝까지 가는 비율 (이 인원으로 시작을 넣은 효과 확인용)
-- select week_start,
--        count(*) filter (where rally_called_at is not null) as 호출,
--        count(*) filter (where gathered_at is not null) as 전원준비,
--        count(*) filter (where cleared is not null) as 클리어표시
-- from public.raid_runs
-- group by week_start
-- order by week_start desc;

-- [6] 디스코드 전송 결과 확인 (알림이 안 올 때)
--     status_code 204 = 성공, 다른 값이면 error_msg를 본다.
-- select created, status_code, error_msg
-- from net._http_response
-- order by created desc
-- limit 5;

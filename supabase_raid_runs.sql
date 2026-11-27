-- 시간대별 레이드 준비 / 클리어 기록과 디스코드 알림
-- supabase_member_password.sql을 먼저 실행한 뒤, Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다.
-- 여러 번 실행해도 안전하다.
--
-- 동작
--   - 요일별 신청 현황의 시간 줄마다 준비 상태와 클리어 O/X를 기록한다. (한 주 단위, 수요일 시작)
--   - 그 시간대에 투표한 사람만 로그인해서 바꿀 수 있고, 누가 바꿨는지 함께 남긴다.
--   - 시간대별 신청 순서: raid_schedules.slot_signed_at에 시간대마다 처음 신청한 시각을 남긴다. (트리거가 채운다)
--     먼저 신청한 10명(초월 레이드는 5명, _raid_full_size)이 1공대(초월은 1파티), 그다음 10명(5명)이 2공대(2파티)이고,
--     그보다 늦은 사람은 대기다. (최대 2파티, _raid_max_parties) 시간을 다시 저장해도 이미 있던 시간대의 순서는 그대로다.
--     시간대를 뺐다가 1분 안에 다시 넣으면(삭제 되돌리기 포함) 원래 순서로 돌아가고, 그 뒤에는 맨 뒤로 간다.
--   - 준비 확인 · 전원 준비 · 출발 인원 · 클리어는 파티마다 따로 기록한다. (raid_runs.party: 1 | 2)
--   - 그 시간대 리딩 가능자는 사람을 끌어서 공대(파티) · A/B · 대기를 직접 옮길 수 있다. (raid_slot_layouts)
--     옮긴 배치가 준비 확인 · 클리어 인원에도 그대로 쓰인다.
--   - 정원(2파티까지)에 든 사람이 시간대를 빼면 대기 1번이 정원으로 올라가고 디스코드로 알린다.
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
  updated_at timestamptz not null default now()
);

-- 파티 번호. 같은 시간대 · 레이드 조합에 2파티까지 기록이 따로 있다. 이 컬럼 전의 기록은 모두 1파티다.
alter table public.raid_runs add column if not exists party smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.raid_runs'::regclass and conname = 'raid_runs_party_check') then
    alter table public.raid_runs add constraint raid_runs_party_check check (party in (1, 2));
  end if;
end;
$$;

-- 예전 고유 조건(파티 없이 시간대 · 레이드 조합마다 한 줄)을 지우고 파티까지 넣은 고유 조건으로 바꾼다.
do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.raid_runs'::regclass
      and c.contype = 'u'
      and not exists (
        select 1
        from unnest(c.conkey) k(attnum)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where a.attname = 'party'
      )
  loop
    execute format('alter table public.raid_runs drop constraint %I', constraint_row.conname);
  end loop;
end;
$$;

create unique index if not exists raid_runs_slot_party_key
on public.raid_runs (week_start, day, time, raid_name, difficulty, mode, party);

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
-- clear_dropped는 이 시간대에서 클리어해 0회가 되어 신청이 일정표에서 자동으로 빠진 사람.
-- 신청이 없어도 출발한 사람으로 보아, 클리어를 되돌렸다 다시 누르면 다시 차감한다.
alter table public.raid_runs add column if not exists clear_dropped text[] not null default '{}';

alter table public.raid_runs enable row level security;

drop policy if exists "Anyone can read raid runs" on public.raid_runs;
create policy "Anyone can read raid runs"
on public.raid_runs
for select
using (true);

-- 직접 배치: 그 시간대 리딩 가능자가 끌어서 옮긴 공대(파티) · A/B 자리. 주마다 따로다.
-- layout: { "닉네임": "1A" | "1B" | "2A" | "2B" | "W" } (1 · 2 = 공대(파티), A · B = 파티 안의 자리, W = 대기. 초월은 A만 쓴다)
-- 여기 없는 사람(새로 신청한 사람 등)은 신청순으로 빈자리를 채운다. 비어 있으면({}) 모두 신청순 자동 배치다.
create table if not exists public.raid_slot_layouts (
  week_start date not null,
  day text not null,
  time text not null,
  raid_name text not null,
  difficulty text not null,
  mode text not null,
  layout jsonb not null default '{}',
  updated_by text,
  updated_at timestamptz not null default now(),
  primary key (week_start, day, time, raid_name, difficulty, mode)
);

alter table public.raid_slot_layouts enable row level security;

drop policy if exists "Anyone can read raid slot layouts" on public.raid_slot_layouts;
create policy "Anyone can read raid slot layouts"
on public.raid_slot_layouts
for select
using (true);

-- 실시간 반영 (다른 사람이 바꾼 신청 · 준비 · 클리어 표시 · 직접 배치가 바로 보이도록)
do $$
declare
  table_name_value text;
begin
  foreach table_name_value in array array['raid_runs', 'raid_schedules', 'members', 'raid_slot_layouts'] loop
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

-- 한 시간대에 꾸릴 수 있는 파티 수. 정원(_raid_full_size)을 넘으면 2파티를 꾸리고, 그보다 많으면 대기다.
-- 앱의 MAX_PARTIES(src/lib/schedule.js)와 같은 값이어야 한다.
create or replace function public._raid_max_parties()
returns integer
language sql
immutable
set search_path = public, extensions
as $$
  select 2;
$$;

revoke execute on function public._raid_max_parties() from public, anon, authenticated;

-- 알림에 붙이는 파티 이름. 10인 레이드는 "2공대", 초월(5인 1파티)은 "2파티". 앱의 getPartyGroupLabel과 같아야 한다.
create or replace function public._raid_party_label(p_raid_name text, p_party integer)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select p_party || case when public._raid_full_size(p_raid_name) <= 5 then '파티' else '공대' end;
$$;

revoke execute on function public._raid_party_label(text, integer) from public, anon, authenticated;

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

-- 그 시간대 신청자마다 든 공대(파티): 1 | 2, 대기는 0. 앱의 arrangeSlot(src/lib/schedule.js)과 같은 기준이어야 한다.
--   1. 직접 배치(raid_slot_layouts)에 공대가 정해진 사람은 그 공대에 둔다. (공대마다 신청순으로 _raid_full_size명까지)
--      W로 정해진 사람은 대기다.
--   2. 나머지는 신청순으로 1공대 빈자리, 2공대 빈자리를 채우고, 그래도 남으면 대기다.
--   직접 배치가 없으면 먼저 신청한 _raid_full_size명이 1공대, 그다음 _raid_full_size명이 2공대다.
-- is_pinned: 직접 배치로 자리가 정해졌는지, unpinned_rank: 직접 배치되지 않은 사람 사이의 신청 순서
-- 신청 순서는 앱의 정렬(compareSlotPeople)과 같다. 앱은 밀리초까지만 다루므로 여기서도 밀리초로 맞추고, 같으면 닉네임 순(코드값)으로 정한다.
create or replace function public._raid_slot_assignment(
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text
)
returns table (nickname text, party integer, is_pinned boolean, unpinned_rank bigint, sort_order bigint)
language sql
stable
security definer
set search_path = public, extensions
as $$
  with layout as (
    select coalesce((
      select l.layout
      from public.raid_slot_layouts l
      where l.week_start = p_week_start and l.day = p_day and l.time = p_time
        and l.raid_name = p_raid_name and l.difficulty = p_difficulty and l.mode = p_mode
    ), '{}'::jsonb) as value
  ),
  voters as (
    select
      v.nickname,
      row_number() over (
        order by
          date_trunc('milliseconds', coalesce((v.slot_signed_at ->> (p_day || '|' || p_time))::timestamptz, v.updated_at)),
          v.nickname collate "C"
      ) as sort_order,
      case left(layout.value ->> v.nickname, 1) when '1' then 1 when '2' then 2 when 'W' then 0 end as pin
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    cross join layout
  ),
  placed as (
    select
      vo.nickname,
      vo.sort_order,
      case
        when vo.pin = 0 then 0
        when vo.pin in (1, 2)
          and row_number() over (partition by vo.pin order by vo.sort_order) <= public._raid_full_size(p_raid_name) then vo.pin
      end as pinned_party
    from voters vo
  ),
  ranked as (
    select
      pl.*,
      case when pl.pinned_party is null then row_number() over (partition by pl.pinned_party is null order by pl.sort_order) end as unpinned_rank
    from placed pl
  ),
  free as (
    select
      public._raid_full_size(p_raid_name) - count(*) filter (where pl.pinned_party = 1) as free1,
      public._raid_full_size(p_raid_name) - count(*) filter (where pl.pinned_party = 2) as free2
    from placed pl
  )
  select
    r.nickname,
    coalesce(
      r.pinned_party,
      case when r.unpinned_rank <= f.free1 then 1 when r.unpinned_rank <= f.free1 + f.free2 then 2 else 0 end
    )::integer,
    r.pinned_party is not null,
    r.unpinned_rank,
    r.sort_order
  from ranked r
  cross join free f;
$$;

revoke execute on function public._raid_slot_assignment(date, text, text, text, text, text) from public, anon, authenticated;

-- 그 시간대의 정원(2파티까지): 1공대 · 2공대에 든 사람 (기본 20명, 초월 10명까지). 나머지는 대기다.
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
  join public._raid_slot_assignment(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) a on a.nickname = v.nickname
  where a.party in (1, 2)
  order by a.party, a.sort_order;
$$;

revoke execute on function public._raid_slot_roster(date, text, text, text, text, text) from public, anon, authenticated;

-- 한 공대(파티)의 인원. 준비 확인 · 전원 준비 · 클리어는 이 인원을 기준으로 공대마다 따로 센다.
create or replace function public._raid_party_roster(
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text,
  p_party integer
)
returns setof public.raid_schedules
language sql
stable
security definer
set search_path = public, extensions
as $$
  select v.*
  from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
  join public._raid_slot_assignment(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) a on a.nickname = v.nickname
  where p_party between 1 and public._raid_max_parties()
    and a.party = p_party
  order by a.sort_order;
$$;

revoke execute on function public._raid_party_roster(date, text, text, text, text, text, integer) from public, anon, authenticated;

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
  last_rank bigint;
  free_total bigint;
  removed_pin text;
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

    -- 뺀 뒤에 직접 배치되지 않은 사람이 남은 정원 자리를 꽉 채웠으면, 그 마지막 사람이 대기에서 올라왔을 수 있다.
    -- (직접 배치가 없으면 2파티까지 20번째, 초월은 10번째 사람)
    select
      max(a.unpinned_rank) filter (where a.party in (1, 2) and not a.is_pinned),
      public._raid_full_size(old.raid_name) * public._raid_max_parties() - count(*) filter (where a.is_pinned and a.party in (1, 2))
    into last_rank, free_total
    from public._raid_slot_assignment(week_start_value, removed.slot_day, removed.slot_time, old.raid_name, old.difficulty, old.mode) a;

    if last_rank is null or last_rank <> free_total then
      continue;
    end if;

    select v.* into tenth
    from public._raid_slot_voters(week_start_value, removed.slot_day, removed.slot_time, old.raid_name, old.difficulty, old.mode) v
    join public._raid_slot_assignment(week_start_value, removed.slot_day, removed.slot_time, old.raid_name, old.difficulty, old.mode) a
      on a.nickname = v.nickname
    where not a.is_pinned and a.unpinned_rank = last_rank;

    if tenth.nickname is null then
      continue;
    end if;

    -- 뺀 사람이 정원 안에 있었는지: 직접 배치로 공대에 있었으면 정원, 대기(W)로 정해져 있었으면 아니다.
    -- 직접 배치가 없었으면 올라온 사람보다 먼저 신청했을 때 정원이었다.
    select l.layout ->> old.nickname into removed_pin
    from public.raid_slot_layouts l
    where l.week_start = week_start_value and l.day = removed.slot_day and l.time = removed.slot_time
      and l.raid_name = old.raid_name and l.difficulty = old.difficulty and l.mode = old.mode;

    tenth_order := date_trunc('milliseconds', coalesce((tenth.slot_signed_at ->> slot_key_value)::timestamptz, tenth.updated_at));

    if coalesce(removed_pin, '') <> 'W' and (
      left(coalesce(removed_pin, ''), 1) in ('1', '2')
      or removed_order < tenth_order
      or (removed_order = tenth_order and (old.nickname collate "C") < (tenth.nickname collate "C"))
    ) then
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
      select 1 from public._raid_party_roster(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode, p_run.party)
    )
    and not exists (
      select 1
      from public._raid_party_roster(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode, p_run.party) v
      where not (v.nickname = any(p_run.rally_checkins))
    );
$$;

revoke execute on function public._raid_run_all_gathered(public.raid_runs) from public, anon, authenticated;

-- 알림 제목의 레이드 이름: "무스펠 · 보통 · 트라이". 그 시간대가 2파티로 나뉘었으면 " · 2공대"처럼 파티를 붙인다.
create or replace function public._raid_run_title(p_run public.raid_runs)
returns text
language sql
stable
security definer
set search_path = public, extensions
as $$
  select format('%s · %s · %s', p_run.raid_name, p_run.difficulty, p_run.mode)
    || case
      when p_run.party > 1 or exists (
        select 1 from public._raid_party_roster(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode, 2)
      ) then ' · ' || public._raid_party_label(p_run.raid_name, p_run.party)
      else ''
    end;
$$;

revoke execute on function public._raid_run_title(public.raid_runs) from public, anon, authenticated;

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
  -- 0회가 되어 신청이 자동으로 빠진 사람도 출발 명단에 있으면 출발한 사람이다. (신청한 사람 뒤에 둔다)
  select c.name, 100000 + c.position
  from unnest(p_run.rally_checkins) with ordinality as c(name, position)
  where p_run.week_start >= (public._current_week_start() at time zone 'Asia/Seoul')::date
    and c.name = any(p_run.clear_dropped)
    and not exists (
      select 1
      from public._raid_slot_voters(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode) v
      where v.nickname = c.name
    )
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

-- 이번 주 횟수를 다 쓴(0회 남은) 캐릭터의 아직 시작하지 않은 신청 시간을 일정표에서 뺀다. 그 레이드의 모든 난이도 · 공략 방식이 대상이다.
-- 이미 시작한 시간대는 남기되, 지금 클리어한 시간대(p_cleared_*)는 시작했어도 뺀다. 남은 시간이 없으면 신청 한 건을 지운다.
-- 빠진 자리는 raid_schedules 트리거(_after_raid_slot_removed)가 대기 승격 알림까지 처리한다.
-- 반환값: 뺀 시간대 수. 횟수가 남았거나 이번 주가 아니면 0.
create or replace function public._raid_drop_exhausted_slots(
  p_week_start date,
  p_raid_name text,
  p_nickname text,
  p_cleared_difficulty text default null,
  p_cleared_mode text default null,
  p_cleared_day text default null,
  p_cleared_time text default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  schedule_row public.raid_schedules;
  kept jsonb;
  row_removed integer;
  removed_count integer := 0;
begin
  if public._raid_weekly_limit(p_raid_name) = 0
     or p_week_start is distinct from (public._current_week_start() at time zone 'Asia/Seoul')::date
     or coalesce(public._raid_entries_left(p_week_start, p_raid_name, p_nickname), 1) > 0 then
    return 0;
  end if;

  for schedule_row in
    select s.*
    from public.raid_schedules s
    where s.nickname = p_nickname
      and s.raid_name = p_raid_name
      and s.attendance = '참'
      and s.updated_at >= public._current_week_start()
    for update
  loop
    with slots as (
      select
        d.key as slot_day,
        t.value as slot_time,
        t.position,
        ((p_week_start + (array_position(array['수', '목', '금', '토', '일', '월', '화'], d.key) - 1))
          + case when t.value = '00:00' then 1 else 0 end + t.value::time) at time zone 'Asia/Seoul' as slot_start
      from jsonb_each(case when jsonb_typeof(schedule_row.day_time_selection) = 'object' then schedule_row.day_time_selection else '{}'::jsonb end) d
      cross join lateral jsonb_array_elements_text(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) with ordinality t(value, position)
    ),
    keep as (
      select *
      from slots
      where (slot_start is null or slot_start <= now())
        and not (schedule_row.difficulty is not distinct from p_cleared_difficulty and schedule_row.mode is not distinct from p_cleared_mode
                 and slot_day is not distinct from p_cleared_day and slot_time is not distinct from p_cleared_time)
    )
    select
      (select count(*) from slots) - (select count(*) from keep),
      coalesce((
        select jsonb_object_agg(k.slot_day, k.times)
        from (select slot_day, jsonb_agg(slot_time order by position) as times from keep group by slot_day) k
      ), '{}'::jsonb)
    into row_removed, kept;

    if row_removed = 0 then
      continue;
    end if;

    if kept = '{}'::jsonb then
      delete from public.raid_schedules where id = schedule_row.id;
    else
      update public.raid_schedules
      set day_time_selection = kept,
          days = array(
            select k.key from jsonb_object_keys(kept) k(key)
            order by array_position(array['수', '목', '금', '토', '일', '월', '화'], k.key)
          ),
          times = array(
            select u.value
            from (select distinct v.value from jsonb_each(kept) d cross join lateral jsonb_array_elements_text(d.value) v(value)) u
            order by u.value = '00:00', u.value
          )
      where id = schedule_row.id;
    end if;

    removed_count := removed_count + row_removed;
  end loop;

  return removed_count;
end;
$$;

revoke execute on function public._raid_drop_exhausted_slots(date, text, text, text, text, text, text) from public, anon, authenticated;

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
  dropped text[] := '{}';
  charged_name text;
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
        'title', format('🏆 이번 주 %s회 완료! | %s', limit_value, public._raid_run_title(run_row)),
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

  -- 이번 클리어로 0회가 된 사람은 지금 클리어한 시간대와 아직 시작하지 않은 시간대 신청을 일정표에서 뺀다.
  -- 알림을 보낸 뒤에 빼서 알림의 파티 표시가 클리어할 때 그대로다. 클리어 명단(clear_log)에는 이름이 남는다.
  foreach charged_name in array charged loop
    if public._raid_drop_exhausted_slots(
      run_row.week_start, run_row.raid_name, charged_name,
      run_row.difficulty, run_row.mode, run_row.day, run_row.time
    ) > 0 then
      dropped := dropped || charged_name;
    end if;
  end loop;

  if cardinality(dropped) > 0 then
    update public.raid_runs
    set clear_dropped = array(select distinct unnest(clear_dropped || dropped))
    where id = p_run_id
    returning * into run_row;
  end if;

  return jsonb_build_object('run', to_jsonb(run_row), 'notified', notified, 'dropped', to_jsonb(dropped));
end;
$$;

revoke execute on function public._raid_clear_add(uuid, text) from public, anon, authenticated;

-- 클리어 1회 추가('add') / 마지막 1회 되돌리기('undo')
--    p_expected_count: 누른 사람 화면의 클리어 횟수. 여러 명이 같은 클리어를 동시에 눌러 두 번 차감되는 것을 막는다.
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant' | 'not_gathered'
--                            | 'clear_changed'(다른 사람이 먼저 바꿈) | 'no_entries_left', "run": {...} }
--    p_party: 1 | 2 (그 시간대의 몇 번째 파티인지). 예전 화면은 보내지 않아 1파티로 본다.
drop function if exists public.member_raid_clear_count(text, text, date, text, text, text, text, text, text, integer);

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
  p_expected_count integer,
  p_party integer default 1
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

  if p_action is null or p_action not in ('add', 'undo') or public._raid_weekly_limit(p_raid_name) = 0
     or p_party is null or p_party not between 1 and public._raid_max_parties() then
    return jsonb_build_object('error', 'bad_request');
  end if;

  select * into run_row
  from public.raid_runs
  where week_start = p_week_start and day = p_day and time = p_time
    and raid_name = p_raid_name and difficulty = p_difficulty and mode = p_mode
    and party = p_party
  for update;

  -- 그 시간대에 투표한 사람과 이 파티로 출발한 사람만 바꿀 수 있다.
  -- (0/5가 되어 신청이 일정표에서 빠진 사람도 출발 명단에 남아 있으면 되돌리기 · 클리어를 누를 수 있다)
  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value
  ) and not (nickname_value = any(coalesce(run_row.rally_checkins, '{}'))) then
    return jsonb_build_object('error', 'not_participant');
  end if;

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

revoke execute on function public.member_raid_clear_count(text, text, date, text, text, text, text, text, text, integer, integer) from public;
grant execute on function public.member_raid_clear_count(text, text, date, text, text, text, text, text, text, integer, integer) to anon, authenticated;

-- 이 기능 전에 클리어 O로 표시한 이번 주 기록을 클리어 1회로 옮긴다. (그때 기준대로 그 파티 전원. 한 번 옮긴 기록은 다시 바뀌지 않는다)
update public.raid_runs run
set clear_log = jsonb_build_array(jsonb_build_object(
  'at', run.cleared_at,
  'by', run.cleared_by,
  'members', coalesce((
    select jsonb_agg(r.nickname)
    from public._raid_party_roster(run.week_start, run.day, run.time, run.raid_name, run.difficulty, run.mode, run.party) r
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
--    p_party: 1 | 2 (그 시간대의 몇 번째 파티인지). 예전 화면은 보내지 않아 1파티로 본다.
drop function if exists public.member_set_raid_run_status(text, text, date, text, text, text, text, text, text, text);

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
  p_value text,
  p_party integer default 1
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
  run_title text;
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
     or array_position(array['수', '목', '금', '토', '일', '월', '화'], p_day) is null
     or p_party is null or p_party not between 1 and public._raid_max_parties() then
    return jsonb_build_object('error', 'bad_request');
  end if;

  select * into run_row
  from public.raid_runs
  where week_start = p_week_start and day = p_day and time = p_time
    and raid_name = p_raid_name and difficulty = p_difficulty and mode = p_mode
    and party = p_party
  for update;

  -- 그 시간대에 투표한 사람과 이 파티로 출발한 사람만 바꿀 수 있다.
  -- (0/5가 되어 신청이 일정표에서 빠진 사람도 출발 명단에 남아 있으면 되돌리기 · 클리어를 누를 수 있다)
  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value
  ) and not (nickname_value = any(coalesce(run_row.rally_checkins, '{}'))) then
    return jsonb_build_object('error', 'not_participant');
  end if;

  if run_row.id is null or run_row.rally_called_at is null then
    return jsonb_build_object('error', 'not_gathered');
  end if;

  run_title := public._raid_run_title(run_row);

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
      -- 클리어한 사람: 출발한 사람. (아무도 없으면 그 파티 전원)
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
            from public._raid_party_roster(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode, p_party) r
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

revoke execute on function public.member_set_raid_run_status(text, text, date, text, text, text, text, text, text, text, integer) from public;
grant execute on function public.member_set_raid_run_status(text, text, date, text, text, text, text, text, text, text, integer) to anon, authenticated;

-- 5. 준비 확인 / 준비 완료
--    p_action: 'call'(호출, 호출한 사람은 자동 체크) | 'check' | 'uncheck' | 'cancel'(호출 취소)
--              | 'remind'(준비 확인 중에 디스코드로 한 번 더 알림)
--              | 'start'(아직 준비 안 한 사람을 기다리지 않고 전원 준비로 넘어감)
--              | 'members'(시작한 뒤 출발 인원 고치기)
--    p_members: 'start' · 'members'에서 실제로 출발하는 사람. 그 시간대 신청자(대기 포함) 중에서 한 파티 정원까지.
--               'start'에서 비우면 지금까지 준비 완료한 사람 그대로 시작한다.
--    p_party: 1 | 2 (그 시간대의 몇 번째 파티인지). 예전 화면은 보내지 않아 1파티로 본다.
--             다른 파티 인원은 이 파티의 준비 확인 · 준비 완료를 누를 수 없고, 다른 파티로 이미 출발한 사람은 고를 수 없다.
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant'
--                            | 'already_called' | 'not_called' | 'already_gathered' | 'not_gathered' | 'notify_limit'
--                            | 'no_members'(아무도 안 고름) | 'too_many_members'(정원 초과)
--                            | 'other_party'(다른 파티 인원) | 'in_other_party'(다른 파티로 이미 출발한 사람을 고름) }
drop function if exists public.member_raid_rally(text, text, date, text, text, text, text, text, text);
drop function if exists public.member_raid_rally(text, text, date, text, text, text, text, text, text, text[]);

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
  p_members text[] default null,
  p_party integer default 1
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
  run_title text;
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
     or array_position(array['수', '목', '금', '토', '일', '월', '화'], p_day) is null
     or p_party is null or p_party not between 1 and public._raid_max_parties() then
    return jsonb_build_object('error', 'bad_request');
  end if;

  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value
  ) then
    return jsonb_build_object('error', 'not_participant');
  end if;

  -- 다른 파티에 든 사람은 이 파티의 준비 확인을 시작하거나 준비 완료를 누를 수 없다. (대기자는 어느 파티든 누를 수 있다)
  if p_action in ('call', 'check') and exists (
    select 1
    from public._raid_slot_roster(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) r
    where r.nickname = nickname_value
  ) and not exists (
    select 1
    from public._raid_party_roster(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode, p_party) r
    where r.nickname = nickname_value
  ) then
    return jsonb_build_object('error', 'other_party');
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

    -- 한 사람이 두 파티로 출발하면 클리어가 두 번 차감되므로 막는다.
    if exists (
      select 1
      from public.raid_runs o
      where o.week_start = p_week_start and o.day = p_day and o.time = p_time
        and o.raid_name = p_raid_name and o.difficulty = p_difficulty and o.mode = p_mode
        and o.party <> p_party
        and o.gathered_at is not null
        and o.rally_checkins && departing
    ) then
      return jsonb_build_object('error', 'in_other_party');
    end if;
  end if;

  insert into public.raid_runs (week_start, day, time, raid_name, difficulty, mode, party)
  values (p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode, p_party)
  on conflict (week_start, day, time, raid_name, difficulty, mode, party) do nothing;

  select * into run_row
  from public.raid_runs
  where week_start = p_week_start and day = p_day and time = p_time
    and raid_name = p_raid_name and difficulty = p_difficulty and mode = p_mode
    and party = p_party
  for update;

  run_title := public._raid_run_title(run_row);

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

  -- 이 파티에 든 인원 (리딩 가능자 먼저, ★ 표시)
  select
    count(*),
    count(*) filter (where s.nickname = any(run_row.rally_checkins)),
    string_agg(s.nickname || case when s.lead_ready = 'O' then '★' else '' end, ', ' order by (s.lead_ready = 'O') desc, s.nickname),
    string_agg(s.nickname, ', ' order by s.nickname) filter (where s.lead_ready = 'O'),
    string_agg(s.nickname, ', ' order by s.nickname) filter (where not (s.nickname = any(run_row.rally_checkins)))
  into member_count, ready_count, members_text, leaders_text, waiting_text
  from public._raid_party_roster(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode, p_party) s;

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

  -- 정원(2파티까지)을 넘어 대기 중인 인원
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

revoke execute on function public.member_raid_rally(text, text, date, text, text, text, text, text, text, text[], integer) from public;
grant execute on function public.member_raid_rally(text, text, date, text, text, text, text, text, text, text[], integer) to anon, authenticated;

-- 6. 직접 배치 저장
--    그 시간대에 리딩 가능(O)으로 신청한 사람만 바꿀 수 있다.
--    p_layout: { "닉네임": "1A" | "1B" | "2A" | "2B" | "W" }. 비우면({} 또는 null) 신청순 자동 배치로 돌아간다.
--              그 시간대 신청자가 아닌 닉네임은 버린다. 초월(5인 1파티)은 "1A" · "2A" · "W"만 쓴다.
--    반환값: { "layout": {...} }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant' | 'not_leader' | 'party_full' }
create or replace function public.member_save_slot_layout(
  p_nickname text,
  p_password text,
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text,
  p_layout jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
  full_size integer := public._raid_full_size(p_raid_name);
  clean_layout jsonb;
  layout_row public.raid_slot_layouts;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  if array_position(array['수', '목', '금', '토', '일', '월', '화'], p_day) is null
     or (p_layout is not null and jsonb_typeof(p_layout) <> 'object') then
    return jsonb_build_object('error', 'bad_request');
  end if;

  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value
  ) then
    return jsonb_build_object('error', 'not_participant');
  end if;

  if not exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = nickname_value and v.lead_ready = 'O'
  ) then
    return jsonb_build_object('error', 'not_leader');
  end if;

  -- 자리 값 확인 (초월은 B 자리가 없다)
  if exists (
    select 1
    from jsonb_each(coalesce(p_layout, '{}'::jsonb)) e
    where jsonb_typeof(e.value) <> 'string'
       or (e.value #>> '{}') not in ('1A', '1B', '2A', '2B', 'W')
       or (full_size <= 5 and (e.value #>> '{}') in ('1B', '2B'))
  ) then
    return jsonb_build_object('error', 'bad_request');
  end if;

  -- 그 시간대 신청자만 남긴다.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into clean_layout
  from jsonb_each(coalesce(p_layout, '{}'::jsonb)) e
  where exists (
    select 1
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) v
    where v.nickname = e.key
  );

  -- 공대마다 정원까지, 10인 레이드는 A · B 파티마다 5명까지
  if exists (
    select 1
    from jsonb_each_text(clean_layout) e
    where e.value <> 'W'
    group by left(e.value, 1)
    having count(*) > full_size
  ) or (full_size > 5 and exists (
    select 1
    from jsonb_each_text(clean_layout) e
    where e.value <> 'W'
    group by e.value
    having count(*) > 5
  )) then
    return jsonb_build_object('error', 'party_full');
  end if;

  insert into public.raid_slot_layouts (week_start, day, time, raid_name, difficulty, mode, layout, updated_by, updated_at)
  values (p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode, clean_layout, nickname_value, now())
  on conflict (week_start, day, time, raid_name, difficulty, mode) do update
  set layout = excluded.layout,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  returning * into layout_row;

  return jsonb_build_object('layout', to_jsonb(layout_row));
end;
$$;

revoke execute on function public.member_save_slot_layout(text, text, date, text, text, text, text, text, jsonb) from public;
grant execute on function public.member_save_slot_layout(text, text, date, text, text, text, text, text, jsonb) to anon, authenticated;

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
-- select day, time, raid_name, difficulty, mode, party,
--        rally_called_by, rally_checkins, gathered_at is not null as 전원준비,
--        cleared, cleared_by,
--        rally_notify_count as 확인알림횟수,
--        gathered_notified_at is not null as 준비알림,
--        cleared_notified_at is not null as 클리어알림
-- from public.raid_runs
-- where week_start = (current_date - ((extract(isodow from current_date)::int + 4) % 7))
-- order by array_position(array['수', '목', '금', '토', '일', '월', '화'], day), time, party;

-- [5] 테스트로 누른 시간대 기록 지우기
--     기록과 알림 여부가 함께 초기화되므로, 다시 호출하면 알림이 또 간다.
-- delete from public.raid_runs
-- where week_start = (current_date - ((extract(isodow from current_date)::int + 4) % 7))
--   and day = '수' and time = '21:00'
--   and raid_name = '무스펠' and difficulty = '보통' and mode = '트라이'
--   and party = 1;

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

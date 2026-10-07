-- 시간대별 레이드 준비 / 클리어 기록과 디스코드 알림
-- supabase_member_password.sql을 먼저 실행한 뒤, Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다.
-- 여러 번 실행해도 안전하다.
--
-- 동작
--   - 요일별 신청 현황의 시간 줄마다 준비 상태와 클리어 O/X를 기록한다. (한 주 단위, 수요일 시작)
--   - 그 시간대에 투표한 사람만 로그인해서 바꿀 수 있고, 누가 바꿨는지 함께 남긴다.
--   - 준비: 한 명이 "준비 확인"을 누르면 디스코드로 알림이 가고, 투표한 사람이 각자 "준비 완료"를 누른다.
--     투표한 사람이 모두 준비 완료를 누르면 전원 준비가 되고 디스코드로 완료 알림이 간다.
--     전원 준비 뒤에는 준비 완료를 풀 수 없다. 준비 확인을 취소하면 준비 완료 · 전원 준비 · 클리어 기록을 모두 비운다.
--   - 클리어는 전원 준비 뒤에만 정할 수 있다.
--   - 준비 확인 알림은 시간대마다 두 번까지 보낸다. (인원이 늘었을 때 "다시 알림"으로 한 번 더,
--     또는 취소했다가 다시 호출할 때) 전원 준비 / 클리어 알림은 시간대마다 한 번씩만 보낸다.
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

alter table public.raid_runs enable row level security;

drop policy if exists "Anyone can read raid runs" on public.raid_runs;
create policy "Anyone can read raid runs"
on public.raid_runs
for select
using (true);

-- 실시간 반영 (다른 사람이 바꾼 준비/클리어 표시가 바로 보이도록)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'raid_runs'
     ) then
    alter publication supabase_realtime add table public.raid_runs;
  end if;
end;
$$;

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

-- 준비 확인을 시작했고, 그 시간대에 투표한 사람이 모두 체크했는지
create or replace function public._raid_run_all_gathered(p_run public.raid_runs)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_run.rally_called_at is not null
    and exists (
      select 1 from public._raid_slot_voters(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode)
    )
    and not exists (
      select 1
      from public._raid_slot_voters(p_run.week_start, p_run.day, p_run.time, p_run.raid_name, p_run.difficulty, p_run.mode) v
      where not (v.nickname = any(p_run.rally_checkins))
    );
$$;

revoke execute on function public._raid_run_all_gathered(public.raid_runs) from public, anon, authenticated;

-- 알림에 넣는 일정 문구: "10월 8일 (수) 21:00"
create or replace function public._raid_run_schedule_text(p_run public.raid_runs)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select format('%s월 %s일 (%s) %s', extract(month from d), extract(day from d), p_run.day, p_run.time)
  from (
    select p_run.week_start + (array_position(array['수', '목', '금', '토', '일', '월', '화'], p_run.day) - 1) as d
  ) t;
$$;

revoke execute on function public._raid_run_schedule_text(public.raid_runs) from public, anon, authenticated;

-- 3. 클리어 표시
--    p_field: 'cleared' (예전 'departed'는 준비로 바뀌어 받지 않는다), p_value: 'O' | 'X' | null(표시 지우기)
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant' | 'not_gathered' }
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

  previous_value := run_row.cleared;

  update public.raid_runs
  set cleared = p_value,
      cleared_by = case when p_value is null then null else nickname_value end,
      cleared_at = case when p_value is null then null else now() end,
      updated_at = now()
  where id = run_row.id
  returning * into run_row;

  -- O로 바뀌는 순간, 그 시간대에 아직 클리어 알림을 보낸 적이 없을 때만 알린다.
  if p_value = 'O' and previous_value is distinct from 'O' and run_row.cleared_notified_at is null then
    select string_agg(s.nickname || case when s.lead_ready = 'O' then '★' else '' end, ', ' order by (s.lead_ready = 'O') desc, s.nickname)
    into members_text
    from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) s;

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

-- 4. 준비 확인 / 준비 완료
--    p_action: 'call'(호출, 호출한 사람은 자동 체크) | 'check' | 'uncheck' | 'cancel'(호출 취소)
--              | 'remind'(준비 확인 중에 디스코드로 한 번 더 알림)
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant'
--                            | 'already_called' | 'not_called' | 'already_gathered' | 'notify_limit' }
create or replace function public.member_raid_rally(
  p_nickname text,
  p_password text,
  p_week_start date,
  p_day text,
  p_time text,
  p_raid_name text,
  p_difficulty text,
  p_mode text,
  p_action text
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
  members_text text;
  leaders_text text;
  waiting_text text;
  just_gathered boolean := false;
  notified boolean := false;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  if p_action not in ('call', 'check', 'uncheck', 'cancel', 'remind')
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
        -- 준비 확인이 없던 일이 되면 클리어 기록도 의미가 없으므로 비운다.
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

  -- 투표한 사람이 모두 체크했으면 전원 준비
  if run_row.gathered_at is null and public._raid_run_all_gathered(run_row) then
    update public.raid_runs set gathered_at = now() where id = run_row.id returning * into run_row;
    just_gathered := true;
  end if;

  -- 이 시간대에 투표한 인원 (리딩 가능자 먼저, ★ 표시)
  select
    count(*),
    string_agg(s.nickname || case when s.lead_ready = 'O' then '★' else '' end, ', ' order by (s.lead_ready = 'O') desc, s.nickname),
    string_agg(s.nickname, ', ' order by s.nickname) filter (where s.lead_ready = 'O'),
    string_agg(s.nickname, ', ' order by s.nickname) filter (where not (s.nickname = any(run_row.rally_checkins)))
  into member_count, members_text, leaders_text, waiting_text
  from public._raid_slot_voters(p_week_start, p_day, p_time, p_raid_name, p_difficulty, p_mode) s;

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
        'title', '✅ 전원 준비 | ' || run_title,
        'color', 5693610,
        'description', format(
          E'📅 %s\n⏱ 확인 시작 %s → 전원 준비 %s (%s분)',
          public._raid_run_schedule_text(run_row),
          to_char(run_row.rally_called_at at time zone 'Asia/Seoul', 'HH24:MI'),
          to_char(run_row.gathered_at at time zone 'Asia/Seoul', 'HH24:MI'),
          floor(extract(epoch from run_row.gathered_at - run_row.rally_called_at) / 60)::integer
        ),
        'fields', jsonb_build_array(
          jsonb_build_object('name', '👥 인원', 'value', member_count || '명 모두 준비됐어요', 'inline', true),
          jsonb_build_object('name', '★ 리딩', 'value', coalesce(leaders_text, '없음'), 'inline', true),
          jsonb_build_object('name', '참여 인원', 'value', left(coalesce(members_text, '없음'), 1000))
        ),
        'footer', jsonb_build_object('text', '준비 확인: ' || coalesce(run_row.rally_called_by, '-'))
      ))
    )) then
      notified := true;
      update public.raid_runs set gathered_notified_at = now() where id = run_row.id returning * into run_row;
    end if;
  end if;

  return jsonb_build_object('run', to_jsonb(run_row), 'notified', notified);
end;
$$;

revoke execute on function public.member_raid_rally(text, text, date, text, text, text, text, text, text) from public;
grant execute on function public.member_raid_rally(text, text, date, text, text, text, text, text, text) to anon, authenticated;

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

-- [6] 디스코드 전송 결과 확인 (알림이 안 올 때)
--     status_code 204 = 성공, 다른 값이면 error_msg를 본다.
-- select created, status_code, error_msg
-- from net._http_response
-- order by created desc
-- limit 5;

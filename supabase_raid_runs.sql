-- 시간대별 레이드 출발 / 클리어 기록과 디스코드 알림
-- supabase_member_password.sql을 먼저 실행한 뒤, Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다.
-- 여러 번 실행해도 안전하다.
--
-- 동작
--   - 요일별 신청 현황의 시간 줄마다 출발 O/X, 클리어 O/X를 기록한다. (한 주 단위, 수요일 시작)
--   - 그 시간대에 투표한 사람만 로그인해서 바꿀 수 있고, 누가 바꿨는지 함께 남긴다.
--   - 출발을 O가 아닌 값으로 바꾸면 클리어 기록도 비운다. 클리어는 출발이 O일 때만 정할 수 있다.
--   - O로 바뀌는 순간 디스코드 웹후크로 알림을 보낸다. 출발 / 클리어 알림은 시간대마다 한 번씩만 보낸다.
--     (O를 지웠다가 다시 O로 해도 다시 보내지 않는다) 웹후크 주소가 비어 있으면 보내지 않는다.
--
-- 디스코드 웹후크 연결 / 변경 (주소는 이 DB 안에만 두고 앱 코드에는 넣지 않는다)
--   update public.app_settings set value = 'https://discord.com/api/webhooks/...' where key = 'discord_webhook_url';
-- 알림 끄기
--   update public.app_settings set value = '' where key = 'discord_webhook_url';

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

alter table public.raid_runs enable row level security;

drop policy if exists "Anyone can read raid runs" on public.raid_runs;
create policy "Anyone can read raid runs"
on public.raid_runs
for select
using (true);

-- 실시간 반영 (다른 사람이 바꾼 출발/클리어 표시가 바로 보이도록)
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

-- 그 시간대(요일 · 시간 · 레이드 조합)에 참여로 투표한 스케줄
create or replace function public._raid_slot_voters(
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
    and (
      coalesce(s.day_time_selection -> p_day, '[]'::jsonb) ? p_time
      -- 요일별 시간이 없는 예전 기록은 days × times 조합으로 본다.
      or (coalesce(s.day_time_selection, '{}'::jsonb) = '{}'::jsonb and p_day = any(s.days) and p_time = any(s.times))
    );
$$;

revoke execute on function public._raid_slot_voters(text, text, text, text, text) from public, anon, authenticated;

-- 3. 출발 / 클리어 표시
--    p_field: 'departed' | 'cleared', p_value: 'O' | 'X' | null(표시 지우기)
--    반환값: { "run": {...}, "notified": true|false }
--            또는 { "error": 'invalid' | 'locked' | 'bad_request' | 'not_participant' | 'not_departed' }
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
  run_date date;
  schedule_text text;
  member_count integer;
  members_text text;
  leaders_text text;
  payload jsonb;
  notified boolean := false;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  if p_field not in ('departed', 'cleared')
     or (p_value is not null and p_value not in ('O', 'X'))
     or array_position(array['수', '목', '금', '토', '일', '월', '화'], p_day) is null then
    return jsonb_build_object('error', 'bad_request');
  end if;

  -- 그 시간대에 투표한 사람만 바꿀 수 있다.
  if not exists (
    select 1
    from public._raid_slot_voters(p_day, p_time, p_raid_name, p_difficulty, p_mode) v
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

  if p_field = 'departed' then
    previous_value := run_row.departed;

    update public.raid_runs
    set departed = p_value,
        departed_by = case when p_value is null then null else nickname_value end,
        departed_at = case when p_value is null then null else now() end,
        -- 출발하지 않았으면 클리어 기록도 의미가 없으므로 비운다.
        cleared = case when p_value = 'O' then cleared end,
        cleared_by = case when p_value = 'O' then cleared_by end,
        cleared_at = case when p_value = 'O' then cleared_at end,
        updated_at = now()
    where id = run_row.id
    returning * into run_row;
  else
    if run_row.departed is distinct from 'O' then
      return jsonb_build_object('error', 'not_departed');
    end if;

    previous_value := run_row.cleared;

    update public.raid_runs
    set cleared = p_value,
        cleared_by = case when p_value is null then null else nickname_value end,
        cleared_at = case when p_value is null then null else now() end,
        updated_at = now()
    where id = run_row.id
    returning * into run_row;
  end if;

  -- O로 바뀌는 순간, 그 시간대에 아직 같은 알림을 보낸 적이 없을 때만 알린다.
  if p_value = 'O'
     and previous_value is distinct from 'O'
     and (case when p_field = 'departed' then run_row.departed_notified_at else run_row.cleared_notified_at end) is null then
    run_date := p_week_start + (array_position(array['수', '목', '금', '토', '일', '월', '화'], p_day) - 1);
    schedule_text := format('%s월 %s일 (%s) %s', extract(month from run_date), extract(day from run_date), p_day, p_time);

    -- 이 시간대에 투표한 인원 (리딩 가능자 먼저, ★ 표시)
    select
      count(*),
      string_agg(s.nickname || case when s.lead_ready = 'O' then '★' else '' end, ', ' order by (s.lead_ready = 'O') desc, s.nickname),
      string_agg(s.nickname, ', ' order by s.nickname) filter (where s.lead_ready = 'O')
    into member_count, members_text, leaders_text
    from public._raid_slot_voters(p_day, p_time, p_raid_name, p_difficulty, p_mode) s;

    if p_field = 'departed' then
      payload := jsonb_build_object(
        'username', '레이드 캘린더',
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', '🟢 레이드 출발 | ' || run_title,
          'color', 5693610,
          'fields', jsonb_build_array(
            jsonb_build_object('name', '📅 일정', 'value', schedule_text, 'inline', true),
            jsonb_build_object('name', '👥 인원', 'value', member_count || '명', 'inline', true),
            jsonb_build_object('name', '★ 리딩', 'value', coalesce(leaders_text, '없음'), 'inline', true),
            jsonb_build_object('name', '참여 인원', 'value', left(coalesce(members_text, '없음'), 1000))
          ),
          'footer', jsonb_build_object('text', '출발 표시: ' || nickname_value)
        ))
      );
    else
      payload := jsonb_build_object(
        'username', '레이드 캘린더',
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', '🏆 클리어! | ' || run_title,
          'color', 16766720,
          'description', format(
            '📅 %s%s',
            schedule_text,
            case
              when run_row.departed_at is null then ''
              else format(
                E'\n⏱ %s → %s (%s분)',
                to_char(run_row.departed_at at time zone 'Asia/Seoul', 'HH24:MI'),
                to_char(run_row.cleared_at at time zone 'Asia/Seoul', 'HH24:MI'),
                floor(extract(epoch from run_row.cleared_at - run_row.departed_at) / 60)::integer
              )
            end
          ),
          'fields', jsonb_build_array(
            jsonb_build_object('name', '참여 인원', 'value', left(coalesce(members_text, '없음'), 1000))
          ),
          'footer', jsonb_build_object('text', '클리어 표시: ' || nickname_value)
        ))
      );
    end if;

    notified := public._send_discord(payload);

    -- 실제로 보냈을 때만 기록한다. (웹후크를 연결하기 전에 누른 O는 나중에 다시 알릴 수 있다)
    if notified then
      update public.raid_runs
      set departed_notified_at = case when p_field = 'departed' then now() else departed_notified_at end,
          cleared_notified_at = case when p_field = 'cleared' then now() else cleared_notified_at end
      where id = run_row.id
      returning * into run_row;
    end if;
  end if;

  return jsonb_build_object('run', to_jsonb(run_row), 'notified', notified);
end;
$$;

revoke execute on function public.member_set_raid_run_status(text, text, date, text, text, text, text, text, text, text) from public;
grant execute on function public.member_set_raid_run_status(text, text, date, text, text, text, text, text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

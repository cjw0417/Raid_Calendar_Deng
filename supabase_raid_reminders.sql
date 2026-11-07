-- 레이드 시작 전 자동 디스코드 알림
-- supabase_raid_runs.sql을 먼저 실행한 뒤, Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다.
-- 여러 번 실행해도 안전하다. 실행하지 않아도 앱은 그대로 동작하고, 자동 알림만 가지 않는다.
--
-- 동작
--   - 5분마다 시작 30분 안쪽으로 남은 시간대를 찾아 디스코드로 한 번 알린다.
--   - 신청 인원이 기준(app_settings.reminder_min_members, 기본 10명) 이상인 시간대만 알린다.
--   - 이미 누군가 준비 확인을 시작한 시간대는 알리지 않는다.
--
-- 기준 인원 바꾸기:
--   update public.app_settings set value = '8' where key = 'reminder_min_members';
-- 자동 알림 끄기:
--   select cron.unschedule('raid-reminders');

alter table public.raid_runs add column if not exists reminder_notified_at timestamptz;

insert into public.app_settings (key, value)
values ('reminder_min_members', '10')
on conflict (key) do nothing;

-- 시각을 받는 것은 테스트에서 시각을 바꿔 보기 위해서다. 평소에는 지금 시각으로 돈다. 보낸 건수를 돌려준다.
create or replace function public._send_raid_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  week_start_value date := (date_trunc('week', (p_now at time zone 'Asia/Seoul') - interval '2 days') + interval '2 days')::date;
  week_start_time timestamptz := week_start_value::timestamp at time zone 'Asia/Seoul';
  min_members integer;
  slot record;
  run_row public.raid_runs;
  member_count integer;
  members_text text;
  leaders_text text;
  sent_count integer := 0;
begin
  select coalesce(nullif(btrim(value), '')::integer, 10) into min_members
  from public.app_settings
  where key = 'reminder_min_members';

  min_members := coalesce(min_members, 10);

  for slot in
    select distinct
      s.raid_name,
      s.difficulty,
      s.mode,
      d.key as slot_day,
      t.value as slot_time,
      ((week_start_value + (array_position(array['수', '목', '금', '토', '일', '월', '화'], d.key) - 1)
        + case when t.value = '00:00' then 1 else 0 end + t.value::time) at time zone 'Asia/Seoul') as slot_start
    from public.raid_schedules s
    cross join lateral jsonb_each(case when jsonb_typeof(s.day_time_selection) = 'object' then s.day_time_selection else '{}'::jsonb end) d
    cross join lateral jsonb_array_elements_text(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) t
    where s.attendance = '참'
      and s.updated_at >= week_start_time
      and array_position(array['수', '목', '금', '토', '일', '월', '화'], d.key) is not null
  loop
    if slot.slot_start <= p_now or slot.slot_start > p_now + interval '30 minutes' then
      continue;
    end if;

    select
      count(*),
      string_agg(r.nickname || case when r.lead_ready = 'O' then '★' else '' end, ', ' order by (r.lead_ready = 'O') desc, r.nickname),
      string_agg(r.nickname, ', ' order by r.nickname) filter (where r.lead_ready = 'O')
    into member_count, members_text, leaders_text
    from public._raid_slot_roster(week_start_value, slot.slot_day, slot.slot_time, slot.raid_name, slot.difficulty, slot.mode) r;

    if member_count < min_members then
      continue;
    end if;

    insert into public.raid_runs (week_start, day, time, raid_name, difficulty, mode)
    values (week_start_value, slot.slot_day, slot.slot_time, slot.raid_name, slot.difficulty, slot.mode)
    on conflict (week_start, day, time, raid_name, difficulty, mode) do nothing;

    select * into run_row
    from public.raid_runs
    where week_start = week_start_value and day = slot.slot_day and time = slot.slot_time
      and raid_name = slot.raid_name and difficulty = slot.difficulty and mode = slot.mode
    for update;

    if run_row.reminder_notified_at is not null or run_row.rally_called_at is not null then
      continue;
    end if;

    if public._send_discord(jsonb_build_object(
      'username', '레이드 캘린더',
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', format('⏰ 곧 시작 | %s · %s · %s', slot.raid_name, slot.difficulty, slot.mode),
        'description', '레이드 캘린더에서 준비 확인을 시작해 주세요.',
        'color', 16763904,
        'fields', jsonb_build_array(
          jsonb_build_object('name', '📅 일정', 'value', public._raid_run_schedule_text(run_row), 'inline', true),
          jsonb_build_object('name', '👥 인원', 'value', member_count || '명', 'inline', true),
          jsonb_build_object('name', '★ 리딩', 'value', coalesce(leaders_text, '없음'), 'inline', true),
          jsonb_build_object('name', '참여 인원', 'value', left(coalesce(members_text, '없음'), 1000))
        )
      ))
    )) then
      update public.raid_runs set reminder_notified_at = now() where id = run_row.id;
      sent_count := sent_count + 1;
    end if;
  end loop;

  return sent_count;
end;
$$;

revoke execute on function public._send_raid_reminders(timestamptz) from public, anon, authenticated;

-- [예약 작업] 여기부터는 Supabase의 pg_cron을 쓴다.
create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid) from cron.job where jobname = 'raid-reminders';
select cron.schedule('raid-reminders', '*/5 * * * *', $job$select public._send_raid_reminders()$job$);

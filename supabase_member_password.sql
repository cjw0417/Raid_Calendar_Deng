-- 닉네임별 개인 비밀번호 설정
-- Supabase SQL Editor에서 이 파일 전체를 한 번 실행한다. 여러 번 실행해도 안전하다.
--
-- 동작
--   - 처음 쓰는 닉네임은 초기 비밀번호(app_settings.initial_password)로 로그인한 뒤 개인 비밀번호를 정한다.
--   - 개인 비밀번호를 정한 닉네임은 그 비밀번호로만 로그인·저장·삭제할 수 있다.
--   - 개인 비밀번호를 정할 때 비밀번호 찾기 질문과 답도 정하고, 비밀번호를 잊으면 답을 맞혀 새로 정한다.
--   - 비밀번호·찾기 답을 합쳐 10번 연속으로 틀리면 5분 동안 잠긴다.
--   - 스케줄 읽기는 지금처럼 누구나 할 수 있고, 쓰기는 아래 함수를 통해서만 가능하다.
--
-- 찾기 답까지 잊은 사람이 있으면 아래를 실행해 초기화한다. (다시 초기 비밀번호로 로그인해 새로 정한다)
--   delete from public.member_credentials where nickname = '닉네임';
--
-- 초기 비밀번호를 바꾸려면:
--   update public.app_settings set value = '새초기비밀번호' where key = 'initial_password';

create extension if not exists pgcrypto with schema extensions;

-- 1. 설정 / 비밀번호 테이블 (외부에서 직접 읽기·쓰기 불가: RLS만 켜고 정책은 두지 않는다)
create table if not exists public.app_settings (
  key text primary key,
  value text not null
);

insert into public.app_settings (key, value)
values ('initial_password', '0801')
on conflict (key) do nothing;

create table if not exists public.member_credentials (
  nickname text primary key,
  password_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

-- 비밀번호 찾기 질문 / 답(해시)
alter table public.member_credentials add column if not exists hint_question text;
alter table public.member_credentials add column if not exists hint_answer_hash text;

alter table public.app_settings enable row level security;
alter table public.member_credentials enable row level security;
revoke all on public.app_settings from anon, authenticated;
revoke all on public.member_credentials from anon, authenticated;

-- 2. 내부용 함수
-- 비밀번호·찾기 답을 틀렸을 때 실패 횟수를 늘리고, 10번째면 5분 동안 잠근다.
create or replace function public._record_failed_attempt(p_nickname text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  update public.member_credentials
  set failed_attempts = case when failed_attempts + 1 >= 10 then 0 else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= 10 then now() + interval '5 minutes' else locked_until end
  where nickname = p_nickname;
end;
$$;

-- 찾기 답 비교용: 앞뒤·중간 공백을 없애고 소문자로 맞춘다.
create or replace function public._normalize_hint_answer(p_answer text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(coalesce(p_answer, ''), '\s+', '', 'g'));
$$;

-- 비밀번호 확인
--    반환값: 'ok' 개인 비밀번호 일치 / 'initial' 개인 비밀번호가 없고 초기 비밀번호 일치
--            'invalid' 불일치 / 'locked' 잠김
create or replace function public._verify_member_password(p_nickname text, p_password text, p_allow_initial boolean)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  cred public.member_credentials;
  initial_password text;
begin
  select * into cred from public.member_credentials where nickname = p_nickname for update;

  if not found then
    select value into initial_password from public.app_settings where key = 'initial_password';

    if p_allow_initial and p_password = initial_password then
      return 'initial';
    end if;

    return 'invalid';
  end if;

  if cred.locked_until is not null and cred.locked_until > now() then
    return 'locked';
  end if;

  if cred.password_hash = extensions.crypt(p_password, cred.password_hash) then
    update public.member_credentials
    set failed_attempts = 0, locked_until = null
    where nickname = p_nickname;

    return 'ok';
  end if;

  perform public._record_failed_attempt(p_nickname);
  return 'invalid';
end;
$$;

revoke execute on function public._record_failed_attempt(text) from public, anon, authenticated;
revoke execute on function public._normalize_hint_answer(text) from public, anon, authenticated;
revoke execute on function public._verify_member_password(text, text, boolean) from public, anon, authenticated;

-- 3. 로그인
--    반환값: 'ok' / 'must_change'(초기 비밀번호로 들어옴 → 개인 비밀번호 설정 필요) / 'invalid' / 'locked'
create or replace function public.member_login(p_nickname text, p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  result text;
begin
  result := public._verify_member_password(btrim(p_nickname), p_password, true);
  return case when result = 'initial' then 'must_change' else result end;
end;
$$;

-- 4. 개인 비밀번호 설정 / 변경 / 찾기
-- 새 비밀번호 규칙 확인. 문제가 없으면 null.
create or replace function public._check_new_password(p_new_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  initial_password text;
begin
  if p_new_password is null or p_new_password !~ '^[0-9]{4,}$' then
    return 'weak';
  end if;

  select value into initial_password from public.app_settings where key = 'initial_password';

  if p_new_password = initial_password then
    return 'same_as_initial';
  end if;

  return null;
end;
$$;

revoke execute on function public._check_new_password(text) from public, anon, authenticated;

-- 처음 설정: 초기 비밀번호로 들어온 닉네임이 개인 비밀번호와 찾기 질문·답을 정한다.
--    반환값: 'ok' / 'invalid' / 'locked' / 'weak' / 'same_as_initial' / 'hint_required'
create or replace function public.member_setup_password(
  p_nickname text,
  p_initial_password text,
  p_new_password text,
  p_hint_question text,
  p_hint_answer text
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
  password_problem text;
begin
  verify_result := public._verify_member_password(nickname_value, p_initial_password, true);

  if verify_result <> 'initial' then
    return case when verify_result = 'ok' then 'invalid' else verify_result end;
  end if;

  password_problem := public._check_new_password(p_new_password);

  if password_problem is not null then
    return password_problem;
  end if;

  if btrim(coalesce(p_hint_question, '')) = '' or length(public._normalize_hint_answer(p_hint_answer)) < 2 then
    return 'hint_required';
  end if;

  -- 그사이 다른 사람이 먼저 설정했다면 덮어쓰지 않는다.
  insert into public.member_credentials (nickname, password_hash, hint_question, hint_answer_hash)
  values (
    nickname_value,
    extensions.crypt(p_new_password, extensions.gen_salt('bf')),
    btrim(p_hint_question),
    extensions.crypt(public._normalize_hint_answer(p_hint_answer), extensions.gen_salt('bf'))
  )
  on conflict (nickname) do nothing;

  if not found then
    return 'invalid';
  end if;

  return 'ok';
end;
$$;

-- 변경: 지금 비밀번호를 알고 있을 때 새 비밀번호로 바꾼다.
--    반환값: 'ok' / 'invalid' / 'locked' / 'weak' / 'same_as_initial'
create or replace function public.member_set_password(p_nickname text, p_current_password text, p_new_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
  password_problem text;
begin
  verify_result := public._verify_member_password(nickname_value, p_current_password, false);

  if verify_result <> 'ok' then
    return verify_result;
  end if;

  password_problem := public._check_new_password(p_new_password);

  if password_problem is not null then
    return password_problem;
  end if;

  update public.member_credentials
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  where nickname = nickname_value;

  return 'ok';
end;
$$;

-- 찾기 질문 조회.
--    반환값: { "status": "ok", "question": "..." }
--            { "status": "no_password" } 아직 개인 비밀번호를 정하지 않음 (초기 비밀번호로 로그인하면 된다)
--            { "status": "no_hint" }     비밀번호는 있지만 찾기 질문이 없음 (관리자 초기화 필요)
-- 반환 형식이 예전(text)과 달라서 먼저 지운다.
drop function if exists public.member_get_hint_question(text);

create function public.member_get_hint_question(p_nickname text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  cred public.member_credentials;
begin
  select * into cred from public.member_credentials where nickname = btrim(p_nickname);

  if not found then
    return jsonb_build_object('status', 'no_password');
  end if;

  if cred.hint_question is null or cred.hint_answer_hash is null then
    return jsonb_build_object('status', 'no_hint');
  end if;

  return jsonb_build_object('status', 'ok', 'question', cred.hint_question);
end;
$$;

-- 찾기: 질문의 답을 맞히면 새 비밀번호로 바꾼다. 틀리면 비밀번호를 틀린 것과 똑같이 센다.
--    반환값: 'ok' / 'invalid' / 'locked' / 'no_hint' / 'weak' / 'same_as_initial'
create or replace function public.member_reset_password(p_nickname text, p_hint_answer text, p_new_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  cred public.member_credentials;
  password_problem text;
begin
  select * into cred from public.member_credentials where nickname = nickname_value for update;

  if not found or cred.hint_answer_hash is null then
    return 'no_hint';
  end if;

  if cred.locked_until is not null and cred.locked_until > now() then
    return 'locked';
  end if;

  -- 새 비밀번호 형식은 답을 확인하기 전에 봐서, 형식 실수로 실패 횟수가 늘지 않게 한다.
  password_problem := public._check_new_password(p_new_password);

  if password_problem is not null then
    return password_problem;
  end if;

  if cred.hint_answer_hash <> extensions.crypt(public._normalize_hint_answer(p_hint_answer), cred.hint_answer_hash) then
    perform public._record_failed_attempt(nickname_value);
    return 'invalid';
  end if;

  update public.member_credentials
  set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      failed_attempts = 0,
      locked_until = null,
      updated_at = now()
  where nickname = nickname_value;

  return 'ok';
end;
$$;

-- 5. 스케줄 저장 (members 개인 정보 + raid_schedules 한 건)
--    반환값: { "member": {...}, "schedule": {...} } 또는 { "error": 'invalid' | 'locked' }
create or replace function public.member_save_schedule(p_nickname text, p_password text, p_member jsonb, p_schedule jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
  member_row public.members;
  schedule_row public.raid_schedules;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  insert into public.members (nickname, attendance, class_name, power, lead_ready)
  values (
    nickname_value,
    p_member->>'attendance',
    p_member->>'class_name',
    p_member->>'power',
    p_member->>'lead_ready'
  )
  on conflict (nickname) do update
  set attendance = excluded.attendance,
      class_name = excluded.class_name,
      power = excluded.power,
      lead_ready = excluded.lead_ready
  returning * into member_row;

  insert into public.raid_schedules (
    nickname, raid_name, difficulty, mode, days, times, day_time_selection,
    attendance, class_name, power, lead_ready, updated_at
  )
  values (
    nickname_value,
    p_schedule->>'raid_name',
    p_schedule->>'difficulty',
    p_schedule->>'mode',
    array(select jsonb_array_elements_text(coalesce(p_schedule->'days', '[]'::jsonb))),
    array(select jsonb_array_elements_text(coalesce(p_schedule->'times', '[]'::jsonb))),
    coalesce(p_schedule->'day_time_selection', '{}'::jsonb),
    p_schedule->>'attendance',
    p_schedule->>'class_name',
    p_schedule->>'power',
    p_schedule->>'lead_ready',
    now()
  )
  on conflict (nickname, raid_name, difficulty, mode) do update
  set days = excluded.days,
      times = excluded.times,
      day_time_selection = excluded.day_time_selection,
      attendance = excluded.attendance,
      class_name = excluded.class_name,
      power = excluded.power,
      lead_ready = excluded.lead_ready,
      updated_at = now()
  returning * into schedule_row;

  return jsonb_build_object('member', to_jsonb(member_row), 'schedule', to_jsonb(schedule_row));
end;
$$;

-- 6. 스케줄 한 건 삭제
create or replace function public.member_delete_schedule(p_nickname text, p_password text, p_raid_name text, p_difficulty text, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  delete from public.raid_schedules
  where nickname = nickname_value
    and raid_name = p_raid_name
    and difficulty = p_difficulty
    and mode = p_mode;

  -- 예전 방식으로 members에 남아 있는 같은 스케줄도 비운다.
  update public.members
  set days = '{}', times = '{}'
  where nickname = nickname_value
    and raid_focus = p_raid_name
    and difficulty = p_difficulty
    and mode = p_mode;

  return jsonb_build_object('ok', true);
end;
$$;

-- 7. 내 스케줄 전체 삭제
create or replace function public.member_delete_all_schedules(p_nickname text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  nickname_value text := btrim(p_nickname);
  verify_result text;
begin
  verify_result := public._verify_member_password(nickname_value, p_password, false);

  if verify_result <> 'ok' then
    return jsonb_build_object('error', verify_result);
  end if;

  delete from public.raid_schedules where nickname = nickname_value;
  update public.members set days = '{}', times = '{}' where nickname = nickname_value;

  return jsonb_build_object('ok', true);
end;
$$;

-- 8. 앱에서 호출할 수 있는 함수만 공개
revoke execute on function public.member_login(text, text) from public;
revoke execute on function public.member_setup_password(text, text, text, text, text) from public;
revoke execute on function public.member_set_password(text, text, text) from public;
revoke execute on function public.member_get_hint_question(text) from public;
revoke execute on function public.member_reset_password(text, text, text) from public;
revoke execute on function public.member_save_schedule(text, text, jsonb, jsonb) from public;
revoke execute on function public.member_delete_schedule(text, text, text, text, text) from public;
revoke execute on function public.member_delete_all_schedules(text, text) from public;

grant execute on function public.member_login(text, text) to anon, authenticated;
grant execute on function public.member_setup_password(text, text, text, text, text) to anon, authenticated;
grant execute on function public.member_set_password(text, text, text) to anon, authenticated;
grant execute on function public.member_get_hint_question(text) to anon, authenticated;
grant execute on function public.member_reset_password(text, text, text) to anon, authenticated;
grant execute on function public.member_save_schedule(text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.member_delete_schedule(text, text, text, text, text) to anon, authenticated;
grant execute on function public.member_delete_all_schedules(text, text) to anon, authenticated;

-- 9. 테이블 직접 쓰기 막기 (읽기 정책 "Anyone can read ..."는 그대로 둔다)
drop policy if exists "Anyone can insert members" on public.members;
drop policy if exists "Anyone can update members" on public.members;
drop policy if exists "Anyone can delete members" on public.members;
drop policy if exists "Anyone can insert raid schedules" on public.raid_schedules;
drop policy if exists "Anyone can update raid schedules" on public.raid_schedules;
drop policy if exists "Anyone can delete raid schedules" on public.raid_schedules;

notify pgrst, 'reload schema';

// 임시 인메모리 PostgreSQL(PGlite)에서 프로젝트 SQL 파일을 실제로 실행해 신청 순서 · 정원 · 시작 · 알림 동작을 확인한다.
// 운영 DB에는 접속하지 않는다. 실행: npm run test:sql
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8')
const db = new PGlite({ extensions: { pgcrypto } })
let failures = 0

const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `\n  실제: ${JSON.stringify(actual)}\n  기대: ${JSON.stringify(expected)}`}`)
}
const rows = async (sql, params) => (await db.query(sql, params)).rows

// Supabase 환경 흉내: 역할, 확장 스키마, pg_net(전송 내용을 표에 남기는 대역), 실시간 publication
await db.exec(`
  create role anon; create role authenticated;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create schema net;
  create table net.sent (id serial primary key, body jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as $$ insert into net.sent(body) values (body) returning id::bigint $$;
  create publication supabase_realtime;
`)

const stripExtension = (sql) => sql.replace(/create extension if not exists pg_net[^;]*;/, '')
await db.exec(read('supabase_schema.sql'))
// 예전 중복 확인 함수(5개 인자)가 있는 운영 DB에 다시 실행하는 경우도 함께 본다.
await db.exec(`create function public._schedule_time_conflict(text, text, text, text, jsonb) returns jsonb language sql as $$ select null::jsonb $$`)
await db.exec(read('supabase_member_password.sql'))
await db.exec(read('supabase_member_password.sql'))
await db.exec(read('supabase_schedule_archive.sql'))
// 여러 번 실행해도 안전한지 보려고 두 번 실행한다.
await db.exec(stripExtension(read('supabase_raid_runs.sql')))
await db.exec(stripExtension(read('supabase_raid_runs.sql')))
console.log('PASS SQL 파일 전체 실행 (raid_runs 2회)')

check('새 설치의 초기 비밀번호는 임의 숫자 8자리', /^\d{8}$/.test((await rows(`select value from public.app_settings where key='initial_password'`))[0].value), true)

await db.exec(`insert into public.members (nickname, days, times) values ('옛방식', '{금}', '{21:00}')`)
await db.exec(stripExtension(read('supabase_raid_runs.sql')))
check('members의 옛 시간 값 정리', (await rows(`select days, times from public.members where nickname='옛방식'`))[0], { days: [], times: [] })

const beforeCron = read('supabase_raid_reminders.sql').split('-- [예약 작업]')[0]
await db.exec(beforeCron)
await db.exec(beforeCron)
console.log('PASS 자동 알림 SQL 실행 (예약 작업 부분 제외, 2회)')

check('실시간 대상 3개 등록', (await rows(`select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1`)).map((r) => r.tablename), ['members', 'raid_runs', 'raid_schedules'])

await db.exec(`update public.app_settings set value='https://discord.example/webhook' where key='discord_webhook_url'`)

// 테스트 계정: 비밀번호 검증 함수만 대역으로 바꾼다. (비밀번호 로직은 이번 수정 범위 밖)
await db.exec(`
  create or replace function public._verify_member_password(p_nickname text, p_password text, p_allow_initial boolean)
  returns text language sql as $$ select 'ok'::text $$;
`)

const selection = (...slots) => {
  const out = {}
  for (const [day, time] of slots) (out[day] ??= []).push(time)
  return out
}
const save = async (nick, sel, { lead = 'X', power = '600~700k', cls = '검성', raid = '무스펠', difficulty = '보통' } = {}) => {
  const res = await rows(`select public.member_save_schedule($1,'pw',$2::jsonb,$3::jsonb) r`, [
    nick,
    JSON.stringify({ attendance: '참', class_name: cls, power, lead_ready: lead }),
    JSON.stringify({ nickname: nick, raid_name: raid, difficulty, mode: '트라이', days: Object.keys(sel), times: [...new Set(Object.values(sel).flat())], day_time_selection: sel, attendance: '참', class_name: cls, power, lead_ready: lead }),
  ])
  if (res[0].r.error) throw new Error(`${nick} 저장 실패: ${JSON.stringify(res[0].r)}`)
  return res[0].r
}
const weekStart = (await rows(`select (public._current_week_start() at time zone 'Asia/Seoul')::date::text d`))[0].d
const rally = async (nick, action, day = '금', time = '21:00') => (await rows(
  `select public.member_raid_rally($1,'pw',$2::date,$3,$4,'무스펠','보통','트라이',$5) r`,
  [nick, weekStart, day, time, action],
))[0].r
const roster = async (day = '금', time = '21:00') => (await rows(
  `select nickname from public._raid_slot_roster($1::date,$2,$3,'무스펠','보통','트라이')`, [weekStart, day, time],
)).map((r) => r.nickname)

// 1. 먼저 신청한 사람이 정원에 들어가고, 다시 저장해도 순서가 그대로인지
const names = Array.from({ length: 12 }, (_, i) => `유저${String(i + 1).padStart(2, '0')}`)
for (const nick of names) {
  await db.exec(`select pg_sleep(0.002)`)
  await save(nick, selection(['금', '21:00']))
}
check('신청 순서대로 앞 10명이 정원', await roster(), names.slice(0, 10))

const before = (await rows(`select slot_signed_at from public.raid_schedules where nickname='유저01'`))[0].slot_signed_at['금|21:00']
await db.exec(`select pg_sleep(0.01)`)
const resaved = await save('유저01', selection(['금', '21:00'], ['토', '20:00']))
const after = resaved.schedule.slot_signed_at
check('다시 저장해도 기존 시간대 신청 시각 유지', after['금|21:00'], before)
check('새로 넣은 시간대는 새 시각', after['토|20:00'] !== before && Boolean(after['토|20:00']), true)
check('다시 저장해도 정원 순서 유지', await roster(), names.slice(0, 10))

const removed = await save('유저01', selection(['토', '20:00']))
check('뺀 시간대는 신청 시각에서도 빠짐', Object.keys(removed.schedule.slot_signed_at), ['토|20:00'])
check('1번이 빠지면 대기 1번이 정원으로', await roster(), names.slice(1, 11))
await save('유저01', selection(['금', '21:00'], ['토', '20:00']))
check('뺐다가 1분 안에 다시 넣으면 원래 순서', await roster(), names.slice(0, 10))

await save('유저01', selection(['토', '20:00']))
await db.exec(`update public.raid_slot_removed set removed_at = now() - interval '2 minutes'`)
await save('유저01', selection(['금', '21:00'], ['토', '20:00']))
check('1분이 지나 다시 넣으면 맨 뒤로', (await rows(
  `select nickname from public._raid_slot_voters($1::date,'금','21:00','무스펠','보통','트라이') v
   order by date_trunc('milliseconds', coalesce((v.slot_signed_at->>'금|21:00')::timestamptz, v.updated_at)) desc limit 1`, [weekStart],
))[0].nickname, '유저01')

await rows(`select public.member_delete_schedule('유저02','pw','무스펠','보통','트라이')`)
check('삭제하면 정원에서 빠짐', (await roster()).includes('유저02'), false)
await save('유저02', selection(['금', '21:00']))
check('삭제를 되돌리면 원래 순서', (await roster())[0], '유저02')

// 대기 → 정원 알림: 지난 시간은 알리지 않으므로 이번 주 마지막 날 밤 시간대로 확인한다.
const promoteNames = Array.from({ length: 12 }, (_, i) => `승격${String(i + 1).padStart(2, '0')}`)
const isLastHour = (await rows(`select (select public._current_week_start()) + interval '6 days 23 hours' <= now() as v`))[0].v
if (isLastHour) {
  console.log('SKIP 대기 → 정원 알림: 화요일 23시 이후에는 미래 시간대가 없어 건너뜀')
} else {
  const sentCount = async () => (await rows(`select count(*)::int c from net.sent`))[0].c
  const lastSent = async () => (await rows(`select body from net.sent order by id desc limit 1`))[0].body
  for (const nick of promoteNames) {
    await db.exec(`select pg_sleep(0.002)`)
    await save(nick, selection(['화', '23:00']))
  }
  let sent = await sentCount()
  await save('승격12', selection(['화', '22:00']))
  check('대기자가 빠지면 알림 없음', await sentCount(), sent)
  await save('승격12', selection(['화', '23:00']))

  sent = await sentCount()
  await rows(`select public.member_delete_schedule('승격03','pw','무스펠','보통','트라이')`)
  check('정원이 빠지면 알림 1건', await sentCount(), sent + 1)
  const promotedMessage = await lastSent()
  check('알림 제목', promotedMessage.embeds[0].title, '🎟 대기에서 정원으로')
  check('올라온 사람이 알림에 있음', promotedMessage.embeds[0].description.endsWith('승격11'), true)
  check('알림의 시간대', promotedMessage.embeds[0].description.includes('(화) 23:00 · 무스펠 · 보통 · 트라이'), true)

  await rows(`select public.member_delete_schedule('승격10','pw','무스펠','보통','트라이')`)
  await rows(`select public.member_delete_schedule('승격11','pw','무스펠','보통','트라이')`)
  await rows(`select public.member_delete_schedule('승격12','pw','무스펠','보통','트라이')`)
  const afterDrop = await sentCount()
  await rows(`select public.member_delete_schedule('승격01','pw','무스펠','보통','트라이')`)
  check('대기자가 없으면 알림 없음', await sentCount(), afterDrop)
}

// 2. 지난주 행을 다시 저장하면 새 신청이 되는지
await db.exec(`alter table public.raid_schedules disable trigger user`)
await db.exec(`update public.raid_schedules set updated_at = public._current_week_start() - interval '3 days', slot_signed_at='{"금|21:00":"2020-01-01T00:00:00+00:00"}' where nickname='유저12'`)
await db.exec(`alter table public.raid_schedules enable trigger user`)
const newWeek = await save('유저12', selection(['금', '21:00']))
check('지난주 행을 다시 저장하면 이번 주 시각으로', newWeek.schedule.slot_signed_at['금|21:00'].startsWith('2020'), false)
check('지난주 행은 보관 테이블에 남음', (await rows(`select count(*)::int c from public.raid_schedule_archive where nickname='유저12'`))[0].c, 1)

// 3. 컬럼 추가 전 기존 행(시각 기록 없음)의 처리
await db.exec(`alter table public.raid_schedules disable trigger user`)
await db.exec(`update public.raid_schedules set slot_signed_at='{}' where nickname='유저11'`)
await db.exec(`alter table public.raid_schedules enable trigger user`)
const oldUpdated = (await rows(`select updated_at from public.raid_schedules where nickname='유저11'`))[0].updated_at
const legacy = await save('유저11', selection(['금', '21:00']))
check('기록 없던 기존 행은 마지막 저장 시각을 신청 시각으로', new Date(legacy.schedule.slot_signed_at['금|21:00']).getTime(), new Date(oldUpdated).getTime())

// 4. 준비 확인은 정원만 센다
const current = await roster()
const overflow = names.concat().filter((n) => !current.includes(n))
check('대기 인원 있음', overflow.length > 0, true)
let result = await rally(current[0], 'call')
check('호출 성공', result.error ?? 'ok', 'ok')
for (const nick of current.slice(1, 9)) await rally(nick, 'check')
result = await rally(current[9], 'check').then(() => rows(`select gathered_at is not null g from public.raid_runs where day='금' and time='21:00'`))
check('정원 10명이 다 누르면 대기 인원 없이도 전원 준비', result[0].g, true)

const gatheredMsg = (await rows(`select body from net.sent order by id desc limit 1`))[0].body
check('전원 준비 알림 제목', gatheredMsg.embeds[0].title.startsWith('✅ 전원 준비'), true)
check('전원 준비 알림 인원 문구', gatheredMsg.embeds[0].fields[0].value, '10명 모두 준비됐어요')

result = await rows(`select public.member_set_raid_run_status($1,'pw',$2::date,'금','21:00','무스펠','보통','트라이','cleared','O') r`, [current[0], weekStart])
check('전원 준비 뒤 클리어 표시', result[0].r.error ?? 'ok', 'ok')

// 5. 이 인원으로 시작
const sat = selection(['토', '21:00'])
for (const nick of ['가', '나', '다']) await save(nick, sat)
result = await rally('가', 'start', '토', '21:00')
check('호출 전에는 시작 불가', result.error, 'not_called')
await rally('가', 'call', '토', '21:00')
check('한 명이 안 눌러 아직 전원 준비 아님', (await rows(`select gathered_at is null n from public.raid_runs where day='토' and time='21:00'`))[0].n, true)
result = await rows(`select public.member_set_raid_run_status('가','pw',$1::date,'토','21:00','무스펠','보통','트라이','cleared','O') r`, [weekStart])
check('시작 전에는 클리어 불가', result[0].r.error, 'not_gathered')
await rally('나', 'check', '토', '21:00')
result = await rally('다', 'start', '토', '21:00')
check('이 인원으로 시작 성공', result.error ?? 'ok', 'ok')
check('시작하면 전원 준비 상태', Boolean(result.run.gathered_at), true)
const startMsg = (await rows(`select body from net.sent order by id desc limit 1`))[0].body
check('시작 알림 제목', startMsg.embeds[0].title.startsWith('▶️ 이 인원으로 시작'), true)
check('시작 알림 인원 문구', startMsg.embeds[0].fields[0].value, '2/3명 출발')
check('시작 알림에는 출발하는 사람만', startMsg.embeds[0].fields.find((f) => f.name === '참여 인원')?.value, '가, 나')
check('시작 알림에 함께 출발하지 않는 사람', startMsg.embeds[0].fields.find((f) => f.name.includes('출발 안 함'))?.value, '다')
result = await rally('다', 'start', '토', '21:00')
check('이미 시작했으면 다시 시작 불가', result.error, 'already_gathered')
result = await rows(`select public.member_set_raid_run_status('가','pw',$1::date,'토','21:00','무스펠','보통','트라이','cleared','O') r`, [weekStart])
check('시작 뒤에는 클리어 가능', result[0].r.error ?? 'ok', 'ok')
result = await rally('외부인', 'start', '토', '21:00')
check('신청 안 한 사람은 시작 불가', result.error, 'not_participant')

// 6. 24:00 표기와 대기 필드
await save('심야', selection(['수', '00:00']))
await rally('심야', 'call', '수', '00:00')
const nightMsg = (await rows(`select body from net.sent order by id desc limit 1`))[0].body
check('알림의 00:00은 24:00으로', nightMsg.embeds[0].description.includes('24:00'), true)

await db.exec(`delete from public.raid_runs`)
const callMsgBefore = (await rows(`select count(*)::int c from net.sent`))[0].c
await rally(current[0], 'call')
const overflowMsg = (await rows(`select body from net.sent order by id desc limit 1`))[0].body
check('호출 알림 전송', (await rows(`select count(*)::int c from net.sent`))[0].c, callMsgBefore + 1)
check('호출 알림에 대기 인원 표시', Boolean(overflowMsg.embeds[0].fields.find((f) => f.name.includes('대기'))), true)
check('호출 알림 인원은 정원 기준', overflowMsg.embeds[0].fields.find((f) => f.name.includes('인원') && f.inline)?.value, '10명')

// 7. 자동 알림
const reminderNames = Array.from({ length: 10 }, (_, i) => `알림${i + 1}`)
for (const nick of reminderNames) await save(nick, selection(['일', '21:00']))
for (const nick of reminderNames.slice(0, 9)) await save(`${nick}적음`, selection(['일', '20:00']))
const atKst = (clock, addDays = 4) => `(select ($1::date + ${addDays} + time '${clock}') at time zone 'Asia/Seoul')`
const remind = async (clock) => (await rows(`select public._send_raid_reminders(${atKst(clock)}) c`, [weekStart]))[0].c
const remind2 = async (clock, addDays) => (await rows(`select public._send_raid_reminders(${atKst(clock, addDays)}) c`, [weekStart]))[0].c
const reminderSentCount = async () => (await rows(`select count(*)::int c from net.sent`))[0].c

check('시작 30분 넘게 남으면 알림 없음', await remind('20:20'), 0)
check('시작 30분 안쪽이면 알림', await remind('20:40'), 1)
const reminderMsg = (await rows(`select body from net.sent order by id desc limit 1`))[0].body
check('자동 알림 제목', reminderMsg.embeds[0].title, '⏰ 곧 시작 | 무스펠 · 보통 · 트라이')
check('자동 알림 인원', reminderMsg.embeds[0].fields.find((f) => f.name.includes('인원') && f.inline)?.value, '10명')
check('같은 시간대는 한 번만 알림', await remind('20:45'), 0)
check('기준 인원보다 적으면 알림 없음', await remind('19:40'), 0)

await db.exec(`update public.app_settings set value='9' where key='reminder_min_members'`)
check('기준 인원을 낮추면 알림', await remind('19:40'), 1)

await save('호출됨', selection(['일', '23:00']))
await rally('호출됨', 'call', '일', '23:00')
await db.exec(`update public.app_settings set value='1' where key='reminder_min_members'`)
const beforeCalled = await reminderSentCount()
check('이미 준비 확인을 시작했으면 알림 없음', await remind('22:40'), 0)
check('자동 알림 추가 전송 없음', await reminderSentCount(), beforeCalled)

// 8. 초월(에라쿠스 유적)은 5인 1파티라 정원이 5명
check('레이드별 정원', (await rows(`select public._raid_full_size('에라쿠스 유적') a, public._raid_full_size('무스펠') b`))[0], { a: 5, b: 10 })
const erakusNames = Array.from({ length: 7 }, (_, i) => `초월${i + 1}`)
for (const nick of erakusNames) {
  await db.exec(`select pg_sleep(0.002)`)
  await save(nick, selection(['화', '22:00']), { raid: '에라쿠스 유적', difficulty: '1단계' })
}
const erakusRoster = async () => (await rows(
  `select nickname from public._raid_slot_roster($1::date,'화','22:00','에라쿠스 유적','1단계','트라이')`, [weekStart],
)).map((r) => r.nickname)
check('초월은 먼저 신청한 5명이 정원', await erakusRoster(), erakusNames.slice(0, 5))

// 대기 → 정원 알림은 지난 시간대에는 가지 않으므로, 화요일 22시가 지났으면 건너뛴다.
const isPastErakusSlot = (await rows(`select (select public._current_week_start()) + interval '6 days 22 hours' <= now() as v`))[0].v
if (isPastErakusSlot) {
  console.log('SKIP 초월 대기 → 정원 알림: 화요일 22시 이후라 건너뜀')
} else {
  const sentBefore = await reminderSentCount()
  await rows(`select public.member_delete_schedule('초월2','pw','에라쿠스 유적','1단계','트라이')`)
  check('초월 정원이 빠지면 대기 1번(6번째)이 정원으로', await erakusRoster(), ['초월1', '초월3', '초월4', '초월5', '초월6'])
  check('초월 승격 알림 1건', await reminderSentCount(), sentBefore + 1)
  check('초월 승격 알림에 6번째', (await rows(`select body from net.sent order by id desc limit 1`))[0].body.embeds[0].description.endsWith('초월6'), true)
}

// 자동 알림 기준(10명)이 정원보다 크면 정원(5명)이 차도 알린다.
await db.exec(`update public.app_settings set value='10' where key='reminder_min_members'`)
const erakusAlarm = Array.from({ length: 5 }, (_, i) => `알림초월${i + 1}`)
for (const nick of erakusAlarm) await save(nick, selection(['월', '21:00']), { raid: '에라쿠스 유적', difficulty: '2단계' })
check('초월은 5명이면 자동 알림', await remind2('20:40', 5), 1)
check('초월 자동 알림 인원', (await rows(`select body from net.sent order by id desc limit 1`))[0].body.embeds[0].fields.find((f) => f.name.includes('인원') && f.inline)?.value, '5명')

// ---------- 같은 시간 다른 레이드는 허용, 본캐 · 부캐의 같은 레이드는 막음 ----------
const trySave = async (nick, sel, options) => save(nick, sel, options).then(() => 'ok', (error) => (error.message.includes('time_conflict') ? 'time_conflict' : error.message))
const link = async (owner, alt) => (await rows(`select public.member_link_alt($1,'pw',$2,'pw') r`, [owner, alt]))[0].r
const fri20 = selection(['금', '20:00'])
check('옛 5개 인자 함수는 남지 않음', (await rows(`select count(*)::int c from pg_proc where proname='_schedule_time_conflict'`))[0].c, 1)
check('중복 확인 함수는 외부에서 못 부름', (await rows(`select has_function_privilege('anon', 'public._schedule_time_conflict(text,text,text,text,jsonb,text)', 'execute') ok`))[0].ok, false)
check('본캐: 금 20:00 무스펠 어려움', await trySave('겹본캐', fri20, { difficulty: '어려움' }), 'ok')
check('같은 캐릭터: 같은 시간 다른 난이도', await trySave('겹본캐', fri20, { difficulty: '보통' }), 'ok')
check('같은 캐릭터: 같은 시간 다른 레이드', await trySave('겹본캐', fri20, { raid: '에라쿠스 유적', difficulty: '1단계' }), 'ok')
check('같은 캐릭터: 같은 신청을 다시 저장', await trySave('겹본캐', fri20, { difficulty: '어려움' }), 'ok')

check('부캐 연결', await link('겹본캐', '겹부캐'), 'ok')
check('부캐: 본캐와 같은 레이드 같은 시간은 막음', await trySave('겹부캐', fri20, { difficulty: '어려움' }), 'time_conflict')
check('부캐: 같은 시간 다른 레이드는 됨', await trySave('겹부캐', fri20, { raid: '비탄의 설원' }), 'ok')
check('본캐: 부캐와 같은 레이드 같은 시간은 막음', await trySave('겹본캐', fri20, { raid: '비탄의 설원' }), 'time_conflict')
check('부캐: 같은 레이드 다른 시간은 됨', await trySave('겹부캐', selection(['금', '22:00']), { difficulty: '어려움' }), 'ok')

await trySave('겹부캐2', fri20, { raid: '비탄의 설원' })
check('연결: 다른 부캐와 같은 레이드 같은 시간이면 막음', await link('겹본캐', '겹부캐2'), 'alt_time_conflict')
await trySave('겹부캐3', fri20, { difficulty: '어려움' })
check('연결: 본캐와 같은 레이드 같은 시간이면 막음', await link('겹본캐', '겹부캐3'), 'alt_time_conflict')
await trySave('겹부캐4', fri20, { raid: '에라쿠스 유적', difficulty: '2단계' })
check('연결: 같은 시간이어도 다른 레이드면 됨', await link('겹본캐', '겹부캐4'), 'ok')
check('같은 시간 두 레이드의 정원은 따로', [
  (await rows(`select nickname from public._raid_slot_roster($1::date,'금','20:00','무스펠','어려움','트라이')`, [weekStart])).map((r) => r.nickname).includes('겹본캐'),
  (await rows(`select nickname from public._raid_slot_roster($1::date,'금','20:00','에라쿠스 유적','1단계','트라이')`, [weekStart])).map((r) => r.nickname),
], [true, ['겹본캐']])

// ---------- 횟수 제한 레이드 쓴 횟수 조정 (supabase_raid_entries.sql) ----------
await db.exec(read('supabase_raid_entries.sql'))
await db.exec(read('supabase_raid_entries.sql'))
console.log('PASS 횟수 조정 SQL 실행 (2회)')
check('횟수 조정 표도 실시간 대상', (await rows(`select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='raid_entry_adjustments'`)).length, 1)

const adjust = async (nick, delta, raid = '에라쿠스 유적') => (await rows(`select public.member_adjust_raid_entries($1,'pw',$2,$3) r`, [nick, raid, delta]))[0].r
check('쓴 횟수 +1', await adjust('조정캐', 1), { nickname: '조정캐', raidName: '에라쿠스 유적', weekStart, adjustment: 1 })
check('한 번 더 +1', (await adjust('조정캐', 1)).adjustment, 2)
check('-1', (await adjust('조정캐', -1)).adjustment, 1)
check('다른 캐릭터는 따로', (await adjust('다른캐', -1)).adjustment, -1)
check('1 · -1 말고는 거절', await adjust('조정캐', 3), { error: 'invalid_request' })
check('레이드 이름 없으면 거절', await adjust('조정캐', 1, ' '), { error: 'invalid_request' })
for (let i = 0; i < 15; i += 1) await adjust('많이누름', 1)
check('조정 값은 10까지', (await adjust('많이누름', 1)).adjustment, 10)
check('이번 주로 저장', (await rows(`select week_start::text w from public.raid_entry_adjustments where nickname='조정캐'`))[0].w, weekStart)
check('누구나 읽기 가능', (await rows(`select has_table_privilege('anon', 'public.raid_entry_adjustments', 'select') ok`))[0].ok, true)
check('표에 직접 쓰기 불가', (await rows(`select has_table_privilege('anon', 'public.raid_entry_adjustments', 'insert') ok`))[0].ok, false)

// ---------- 에라쿠스: 한 번 출발해 여러 번 클리어, 출발한 사람만 차감, 0회가 될 때만 디스코드 ----------
const ER = ['목', '22:00', '에라쿠스 유적', '3단계', '트라이']
const erRally = async (nick, action) => (await rows(`select public.member_raid_rally($1,'pw',$2::date,$3,$4,$5,$6,$7,$8) r`, [nick, weekStart, ...ER, action]))[0].r
const erDepart = async (nick, action, members) => (await rows(`select public.member_raid_rally($1,'pw',$2::date,$3,$4,$5,$6,$7,$8,$9::text[]) r`, [nick, weekStart, ...ER, action, members]))[0].r
const erClear = async (nick, action, expected) => (await rows(`select public.member_raid_clear_count($1,'pw',$2::date,$3,$4,$5,$6,$7,$8,$9) r`, [nick, weekStart, ...ER, action, expected]))[0].r
const erStatus = async (nick, value) => (await rows(`select public.member_set_raid_run_status($1,'pw',$2::date,$3,$4,$5,$6,$7,'cleared',$8) r`, [nick, weekStart, ...ER, value]))[0].r
const left = async (nick) => (await rows(`select public._raid_entries_left($1::date,'에라쿠스 유적',$2) l`, [weekStart, nick]))[0].l
const lefts = async (...nicks) => Promise.all(nicks.map(left))
const sentTotal = async () => (await rows(`select count(*)::int c from net.sent`))[0].c
const lastEmbed = async () => (await rows(`select body from net.sent order by id desc limit 1`))[0].body.embeds[0]
const crew = ['원정1', '원정2', '원정3', '원정4', '원정5', '원정6']
for (const nick of crew) {
  await db.exec(`select pg_sleep(0.002)`)
  await save(nick, selection([ER[0], ER[1]]), { raid: ER[2], difficulty: ER[3] })
}
check('앱의 주간 제한과 같은 값', (await rows(`select public._raid_weekly_limit('에라쿠스 유적') a, public._raid_weekly_limit('무스펠') b`))[0], { a: 5, b: 0 })
check('시작 전에는 클리어 불가', (await erClear('원정1', 'add', 0)).error, 'not_gathered')
await erRally('원정1', 'call')
for (const nick of ['원정2', '원정3', '원정4']) await erRally(nick, 'check')
check('전원 준비 전에는 클리어 불가', (await erClear('원정1', 'add', 0)).error, 'not_gathered')
await erRally('원정1', 'start')

let sentBase = await sentTotal()
let cleared = await erClear('원정1', 'add', 0)
check('출발한 사람만 차감 (준비 안 한 원정5 · 대기 원정6 제외)', cleared.run.clear_log.map((e) => e.members), [['원정1', '원정2', '원정3', '원정4']])
check('첫 클리어로 4/5', await lefts('원정1', '원정4', '원정5', '원정6'), [4, 4, 5, 5])
check('횟수가 남은 클리어는 디스코드 알림 없음', [await sentTotal(), cleared.notified], [sentBase, false])
check('동시에 누르면 한 번만', [(await erClear('원정2', 'add', 0)).error, (await left('원정1'))], ['clear_changed', 4])
check('같은 출발에서 두 번째 클리어', (await erClear('원정2', 'add', 1)).run.clear_log.length, 2)
check('두 번째 클리어로 3/5', await lefts('원정1', '원정5'), [3, 5])
await erRally('원정5', 'check')
await erClear('원정3', 'add', 2)
check('늦게 준비한 사람은 그 뒤부터 차감', await lefts('원정1', '원정5'), [2, 4])
const undone = await erClear('원정3', 'undo', 3)
check('되돌리면 횟수도 돌아옴', [undone.run.clear_log.length, undone.run.cleared, ...(await lefts('원정1', '원정5'))], [2, 'O', 3, 5])
check('신청 안 한 사람은 불가', (await erClear('외부인', 'add', 2)).error, 'not_participant')
check('횟수 제한이 없는 레이드는 불가', (await rows(`select public.member_raid_clear_count('가','pw',$1::date,'토','21:00','무스펠','보통','트라이','add',0) r`, [weekStart]))[0].r.error, 'bad_request')

// 원정1은 밖에서 2회 더 써서 남은 1회
await adjust('원정1', 1)
await adjust('원정1', 1)
check('직접 조정도 반영해 남은 1회', await left('원정1'), 1)
sentBase = await sentTotal()
cleared = await erClear('원정2', 'add', 2)
check('1/5에서 클리어하면 디스코드 1건', [await sentTotal(), cleared.notified], [sentBase + 1, true])
let embed = await lastEmbed()
check('알림 제목', embed.title, '🏆 이번 주 5회 완료! | 에라쿠스 유적 · 3단계 · 트라이')
check('알림 일정 · 이번 출발 클리어 횟수', [embed.description.includes('(목) 22:00'), embed.description.includes('클리어 3회')], [true, true])
check('알림에 다 쓴 사람', embed.fields[0].value, '원정1')
check('알림에 참여 인원과 남은 횟수', embed.fields[1].value, '원정1 0/5, 원정2 2/5, 원정3 2/5, 원정4 2/5, 원정5 4/5')
await erClear('원정2', 'undo', 3)
cleared = await erClear('원정2', 'add', 2)
check('되돌렸다 다시 눌러도 같은 사람은 다시 알리지 않음', [await sentTotal(), cleared.notified], [sentBase + 1, false])
cleared = await erClear('원정2', 'add', 3)
check('0회인 사람은 더 차감하지 않음', [cleared.run.clear_log.at(-1).members.includes('원정1'), await left('원정1')], [false, 0])
check('0회인 사람 말고 나머지는 차감', await lefts('원정2', '원정5'), [1, 3])
cleared = await erClear('원정2', 'add', 4)
check('여러 명이 함께 0/5가 되면 한 번에 알림', [await sentTotal(), (await lastEmbed()).fields[0].value], [sentBase + 2, '원정2, 원정3, 원정4'])
await rows(`select public.member_delete_schedule('원정2','pw','에라쿠스 유적','3단계','트라이')`)
check('클리어한 뒤 신청을 지워도 차감 유지', await lefts('원정2', '원정6'), [0, 5])
await erClear('원정5', 'add', 5)
await erClear('원정5', 'add', 6)
check('마지막 사람까지 0/5', await left('원정5'), 0)
check('모두 0회면 더 셀 수 없음', (await erClear('원정5', 'add', 7)).error, 'no_entries_left')
check('예전 화면에서 여러 번 센 클리어를 한꺼번에 못 지움', (await erStatus('원정5', null)).error, 'clear_count_only')
await erRally('원정1', 'cancel')
check('준비 확인을 취소하면 차감도 되돌아감', await lefts('원정1', '원정2', '원정5'), [3, 5, 5])

// 출발 인원 고르기: 대기자를 대신 넣거나 시작한 뒤에 고친다. (원정2는 신청을 지워 원정6이 정원. 새로 대기자 추가)
await save('원정7', selection([ER[0], ER[1]]), { raid: ER[2], difficulty: ER[3] })
await erRally('원정1', 'call')
check('시작 전에는 출발 인원을 못 고침', (await erDepart('원정1', 'members', ['원정1'])).error, 'not_gathered')
check('아무도 안 고르면 시작 불가', (await erDepart('원정1', 'start', [])).error, 'no_members')
check('신청하지 않은 사람만 고르면 시작 불가', (await erDepart('원정1', 'start', ['외부인'])).error, 'no_members')
check('정원보다 많이 고르면 시작 불가', (await erDepart('원정1', 'start', ['원정1', '원정3', '원정4', '원정5', '원정6', '원정7'])).error, 'too_many_members')
check('신청 안 한 사람은 출발 인원을 못 고름', (await erDepart('외부인', 'start', ['원정1'])).error, 'not_participant')
const departRun = await erDepart('원정1', 'start', ['원정3', '원정7', '외부인'])
check('고른 사람으로 시작 (신청자만, 대기자 포함)', [departRun.run.rally_checkins, Boolean(departRun.run.gathered_at)], [['원정3', '원정7'], true])
check('고른 사람만 차감 (대기자 원정7 포함, 호출한 원정1 제외)', (await erClear('원정1', 'add', 0)).run.clear_log[0].members, ['원정3', '원정7'])
check('시작한 뒤 출발 인원 고치기', (await erDepart('원정3', 'members', ['원정3', '원정4'])).run.rally_checkins, ['원정3', '원정4'])
check('고친 뒤의 클리어는 새 인원으로, 앞 기록은 그대로', (await erClear('원정1', 'add', 1)).run.clear_log.map((e) => e.members), [['원정3', '원정7'], ['원정3', '원정4']])
check('인원 고치기는 알림 없음', (await erDepart('원정3', 'members', ['원정3'])).notified, false)
check('옛 9개 인자 함수는 남지 않음', (await rows(`select count(*)::int c from pg_proc where proname='member_raid_rally'`))[0].c, 1)
await erRally('원정1', 'cancel')

// 예전 화면(O/X)과의 호환
await erRally('원정1', 'call')
await erRally('원정1', 'start')
check('예전 화면의 O는 1회로 기록', (await erStatus('원정1', 'O')).run.clear_log.map((e) => e.members), [['원정1']])
check('예전 화면의 O를 다시 보내도 1회', (await erStatus('원정1', 'O')).run.clear_log.length, 1)
check('표시를 지우면 차감도 되돌아감', [(await erStatus('원정1', null)).run.clear_log, await left('원정1')], [[], 3])
check('실패(X)는 차감 없음', [(await erStatus('원정1', 'X')).run.cleared, await left('원정1')], ['X', 3])

// 이 기능 전에 클리어 O로 표시한 기록 옮기기
await db.exec(`update public.raid_runs set cleared='O', cleared_by='원정1', cleared_at=now(), clear_log='[]' where day='목' and time='22:00'`)
await db.exec(stripExtension(read('supabase_raid_runs.sql')))
await db.exec(stripExtension(read('supabase_raid_runs.sql')))
check('예전 O 기록은 정원 전원 1회로 한 번만 옮김', (await rows(`select clear_log from public.raid_runs where day='목' and time='22:00'`))[0].clear_log.map((e) => e.members.length), [5])

// 다른 레이드는 O/X 그대로, 명단만 남김
await save('무스1', selection(['목', '23:00']))
await save('무스2', selection(['목', '23:00']))
await rally('무스1', 'call', '목', '23:00')
await rally('무스1', 'start', '목', '23:00')
sentBase = await sentTotal()
const muspelClear = await rows(`select public.member_set_raid_run_status('무스1','pw',$1::date,'목','23:00','무스펠','보통','트라이','cleared','O') r`, [weekStart])
check('다른 레이드: 준비한 사람을 클리어 명단에', muspelClear[0].r.run.clear_log.map((e) => e.members), [['무스1']])
check('다른 레이드: 클리어 알림은 그대로 1건', [await sentTotal(), (await lastEmbed()).title], [sentBase + 1, '🏆 클리어! | 무스펠 · 보통 · 트라이'])
check('클리어 내부 함수는 외부에서 못 부름', (await rows(`select has_function_privilege('anon','public._raid_clear_add(uuid,text)','execute') a, has_function_privilege('anon','public._raid_entries_left(date,text,text)','execute') b, has_function_privilege('anon','public.member_raid_clear_count(text,text,date,text,text,text,text,text,text,integer)','execute') c`))[0], { a: false, b: false, c: true })

await db.exec(`
  create or replace function public._verify_member_password(p_nickname text, p_password text, p_allow_initial boolean)
  returns text language sql as $$ select 'invalid'::text $$;
`)
check('비밀번호가 틀리면 클리어도 거절', (await erClear('원정1', 'add', 1)).error, 'invalid')
check('비밀번호가 틀리면 거절', await adjust('조정캐', 1), { error: 'invalid' })
check('거절되면 값 그대로', (await rows(`select adjustment from public.raid_entry_adjustments where nickname='조정캐'`))[0].adjustment, 1)

console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과')
process.exit(failures ? 1 : 0)

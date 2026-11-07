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
const save = async (nick, sel, { lead = 'X', power = '600~700k', cls = '검성' } = {}) => {
  const res = await rows(`select public.member_save_schedule($1,'pw',$2::jsonb,$3::jsonb) r`, [
    nick,
    JSON.stringify({ attendance: '참', class_name: cls, power, lead_ready: lead }),
    JSON.stringify({ nickname: nick, raid_name: '무스펠', difficulty: '보통', mode: '트라이', days: Object.keys(sel), times: [...new Set(Object.values(sel).flat())], day_time_selection: sel, attendance: '참', class_name: cls, power, lead_ready: lead }),
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
check('시작 알림 인원 문구', startMsg.embeds[0].fields[0].value, '2/3명 준비')
check('시작 알림에 준비 안 한 사람', startMsg.embeds[0].fields.find((f) => f.name.includes('준비 안 함'))?.value, '다')
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

console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과')
process.exit(failures ? 1 : 0)

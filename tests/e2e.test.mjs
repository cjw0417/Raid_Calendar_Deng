// 화면 동작 검증. 로컬 모드와 가짜 Supabase 모드로 앱을 띄워 실제 브라우저(설치된 Chrome)에서 확인한다.
// 외부 요청은 모두 막으므로 운영 DB에는 접속하지 않는다. 실행: npm run test:e2e
import { chromium } from 'playwright-core'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'tests', '.output')
mkdirSync(out, { recursive: true })
const LOCAL = 'http://localhost:5199/'
const REMOTE = 'http://localhost:5198/'
const FAKE_SUPABASE = 'http://fake-supabase.test'
const NICK = '테스트본캐'
const PW = '1234'
const classes = ['수호성', '검성', '권성', '궁성', '정령성', '마도성', '살성', '호법성']
const powers = ['600~700k', '700~800k', '800~900k', '500~600k']
const emptySel = () => ({ 수: [], 목: [], 금: [], 토: [], 일: [], 월: [], 화: [] })
let failures = 0

const check = (label, actual, expected = true) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : `\n  실제: ${JSON.stringify(actual)}\n  기대: ${JSON.stringify(expected)}`}`)
}

// 2026-12-23(수) 20:30 KST: 이번 주 금요일 12/25가 평일 공휴일
const NOW = '2026-12-23T20:30:00+09:00'
const THIS_WEEK = '2026-12-23T10:00:00+09:00'

const sched = (nickname, i, sel, extra = {}) => ({
  id: `s-${nickname}`,
  nickname,
  raidName: '무스펠',
  difficulty: '보통',
  mode: '트라이',
  dayTimeSelection: { ...emptySel(), ...sel },
  days: Object.entries(sel).filter(([, t]) => t.length).map(([d]) => d),
  times: [...new Set(Object.values(sel).flat())],
  attendance: '참',
  className: classes[i % classes.length],
  power: powers[i % powers.length],
  leadReady: i % 5 === 0 ? 'O' : 'X',
  updatedAt: THIS_WEEK,
  ...extra,
})

// 금 21:00에 12명: 신청 순서는 레기온원1이 가장 먼저. 목록 순서는 일부러 뒤집어 둔다.
const crowd = Array.from({ length: 12 }, (_, i) => sched(i === 0 ? '일곱글자닉네임' : `레기온원${i + 1}`, i, { 금: ['21:00'] }, {
  slotSignedAt: { '금|21:00': `2026-12-23T1${Math.floor(i / 10)}:${String(i).padStart(2, '0')}:00+09:00` },
  updatedAt: `2026-12-23T19:${String(59 - i).padStart(2, '0')}:00+09:00`,
})).reverse()

const credentials = { [NICK]: { passwordHash: createHash('sha256').update(`${NICK}:${PW}`).digest('hex'), hintQuestion: '어릴 적 별명은?', hintAnswerHash: 'x' } }
const memberRow = { nickname: NICK, id: 'm1', days: [], times: [], dayTimeSelection: emptySel(), attendance: '불참', className: '수호성', power: '700~800k', leadReady: 'O', raidFocus: '무스펠', difficulty: '보통', mode: '트라이', updatedAt: THIS_WEEK }

// 테스트용 개발 서버 두 개를 띄운다. 환경 변수가 .env보다 우선하므로 운영 DB 주소를 쓰지 않는다.
const servers = [
  [5199, { VITE_SUPABASE_URL: '', VITE_SUPABASE_ANON_KEY: '' }],
  [5198, { VITE_SUPABASE_URL: FAKE_SUPABASE, VITE_SUPABASE_ANON_KEY: 'fake-key' }],
].map(([port, env]) => spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), '--port', String(port), '--strictPort'], {
  cwd: root,
  env: { ...process.env, ...env },
  stdio: 'ignore',
}))
process.on('exit', () => servers.forEach((server) => server.kill()))

for (const url of [LOCAL, REMOTE]) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await fetch(url).then((response) => response.ok, () => false)) break
    await new Promise((done) => setTimeout(done, 500))
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })

async function open(url, { schedules = [], members = [memberRow], extraStorage = {}, viewport = { width: 1440, height: 900 }, hasTouch = false, isMobile = false, now = NOW, routes = null, showGuide = false } = {}) {
  const context = await browser.newContext({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', viewport, hasTouch, isMobile })
  await context.route('**/*', (route) => {
    const requestUrl = route.request().url()
    return requestUrl.startsWith('http://localhost:') ? route.continue() : route.abort()
  })
  if (routes) await routes(context)
  await context.addInitScript(({ schedules, members, credentials, extraStorage, showGuide }) => {
    if (sessionStorage.getItem('seeded')) return
    sessionStorage.setItem('seeded', '1')
    if (!showGuide) localStorage.setItem('raid-calendar-mobile-guide-v1', '1')
    localStorage.setItem('raid-calendar-raid-schedules-v1', JSON.stringify(schedules))
    localStorage.setItem('raid-calendar-members-v1', JSON.stringify(members))
    localStorage.setItem('raid-calendar-credentials-v1', JSON.stringify(credentials))
    Object.entries(extraStorage).forEach(([key, value]) => localStorage.setItem(key, value))
  }, { schedules, members, credentials, extraStorage, showGuide })
  const page = await context.newPage()
  page.on('pageerror', (error) => { failures += 1; console.log('FAIL 페이지 오류:', error.message) })
  await page.clock.setFixedTime(new Date(now))
  await page.goto(url)
  return { page, context }
}

const login = async (page) => {
  await page.fill('#loginNickname', NICK)
  await page.fill('#loginPassword', PW)
  await page.click('.login-button')
  await page.waitForSelector('.app-shell')
}

const pickTarget = async (page, raid = '무스펠', difficulty = '보통', mode = '트라이') => {
  await page.locator('[aria-label="레이드"] button', { hasText: raid }).click()
  await page.locator('[aria-label="난이도"] button', { hasText: difficulty }).click()
  await page.locator('[aria-label="공략 방식"] button', { hasText: mode }).click()
}

const toastText = (page) => page.locator('.toast').allInnerTexts().then((texts) => texts.join(' | '))

// ---------- 6. 자동 로그인 ----------
{
  const { page, context } = await open(LOCAL, { extraStorage: { 'raid-calendar-login-v1': NICK, 'raid-calendar-saved-password-v1': PW } })
  await page.waitForSelector('.app-shell', { timeout: 5000 }).catch(() => {})
  check('#6 저장된 비밀번호로 자동 로그인', await page.locator('.app-shell').count(), 1)
  await context.close()

  const wrong = await open(LOCAL, { extraStorage: { 'raid-calendar-login-v1': NICK, 'raid-calendar-saved-password-v1': '9999' } })
  await wrong.page.waitForSelector('.login-error', { timeout: 5000 }).catch(() => {})
  check('#6 틀린 저장 비밀번호면 로그인 화면과 안내', (await wrong.page.locator('.login-error').innerText()).includes('저장된 비밀번호'))
  check('#6 틀린 저장 비밀번호는 지움', await wrong.page.evaluate(() => localStorage.getItem('raid-calendar-saved-password-v1')), null)
  await wrong.context.close()
}

// ---------- 3, 4, 5, 13, 14, 12, 17 폼 ----------
{
  const pastSel = { 화: ['00:00', '23:00'] }
  const { page, context } = await open(LOCAL, { schedules: [sched(NICK, 0, pastSel, { raidName: '비탄의 설원', id: 'other' })] })
  await login(page)
  await page.screenshot({ path: join(out, 'pc-first.png'), fullPage: false })

  // 5. 불참 제거
  check('#5 참여 여부 선택이 없음', await page.locator('[aria-label="참여 여부"]').count(), 0)

  // 11. 캐릭터 한 줄
  check('#11 다 채운 내 캐릭터는 한 줄', await page.locator('.character-summary').count(), 1)
  await page.locator('.character-summary button').click()
  check('#11 정보 수정을 누르면 펼침', await page.locator('#className').count(), 1)
  await page.locator('.character-collapse-button').click()
  check('#11 다시 접힘', await page.locator('.character-summary').count(), 1)

  await pickTarget(page)

  // 4. 화요일 00:00
  check('#4 화요일 24:00 칸 없음', await page.locator('[aria-label="화요일 24:00"]').count(), 0)
  check('#4 월요일 24:00 칸 있음', await page.locator('[aria-label="월요일 24:00"]').count(), 1)
  check('#4 캘린더에도 화요일 00:00 칸 없음', await page.locator('[id="calendar-slot-화-00:00"]').count(), 0)
  check('#4 저장돼 있던 화요일 00:00은 목록에서 빠짐', (await page.locator('.saved-slot-chip-time').allInnerTexts()).includes('24:00'), false)

  // 17. 00:00 표기
  check('#17 시간표 머리가 24:00', (await page.locator('.time-pick-head.is-row').allInnerTexts()).includes('24:00'))
  check('#17 00:00 표기 없음', (await page.locator('.time-pick-head.is-row').allInnerTexts()).includes('00:00'), false)

  // 3. 평일 공휴일 낮시간
  await page.locator('button', { hasText: '주말 · 공휴일 낮시간 보기' }).click()
  check('#3 공휴일(금) 12:00 칸이 눌림', await page.locator('[aria-label="금요일 12:00"]').count(), 1)
  check('#3 평일(목) 12:00 칸은 없음', await page.locator('[aria-label="목요일 12:00"]').count(), 0)
  await page.locator('[aria-label="금요일 12:00"]').click()
  check('#3 공휴일 낮시간 선택됨', await page.locator('[aria-label="금요일 12:00"]').getAttribute('aria-pressed'), 'true')

  // 13/14. 지난 시간은 막히고 이유를 알려 줌 (오늘 수요일 20:30 기준 수 19:00은 지남)
  await page.locator('[aria-label="수요일 19:00"]').click({ force: true })
  check('#13 지난 시간은 안 골라짐', await page.locator('[aria-label="수요일 19:00"]').getAttribute('aria-pressed'), 'false')
  check('#14 지난 시간을 누르면 이유 표시', (await toastText(page)).includes('이미 지난 시간'))
  await page.locator('[aria-label="화요일 23:00"]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.locator('[aria-label="화요일 23:00"]').click({ force: true })
  check('#14 이미 신청한 시간을 누르면 이유 표시', (await toastText(page)).includes('이미 신청한 시간'))
  check('#13 머리 눌러 줄 전체를 골라도 지난 칸은 제외', await (async () => {
    await page.locator('.time-pick-head', { hasText: /^수$/ }).first().click()
    return page.locator('[aria-label="수요일 19:00"]').getAttribute('aria-pressed')
  })(), 'false')
  check('#13 같은 줄의 안 지난 칸은 골라짐', await page.locator('[aria-label="수요일 22:00"]').getAttribute('aria-pressed'), 'true')

  // 12. 변경 취소
  check('#12 변경 취소 버튼 표시', await page.locator('button', { hasText: '변경 취소' }).count(), 1)
  await page.locator('button', { hasText: '변경 취소' }).click()
  check('#12 변경 취소 후 선택 해제', await page.locator('[aria-label="금요일 12:00"]').getAttribute('aria-pressed'), 'false')
  await page.locator('.toast-action', { hasText: '되돌리기' }).click()
  check('#12 변경 취소 되돌리기', await page.locator('[aria-label="금요일 12:00"]').getAttribute('aria-pressed'), 'true')

  // 5/저장: 불참이었던 회원도 참여로 저장되어 캘린더에 나옴
  await page.locator('.member-actions .primary-button').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes('저장했어요')))
  check('#5 불참 기록이 있어도 참여로 저장', await page.evaluate(() => JSON.parse(localStorage.getItem('raid-calendar-raid-schedules-v1')).find((e) => e.raidName === '무스펠').attendance), '참')

  // 12. 시간을 모두 빼면 삭제 버튼
  await page.locator('.time-pick-cell.is-selected').first().waitFor()
  while (await page.locator('.time-pick-cell.is-selected').count()) await page.locator('.time-pick-cell.is-selected').first().click()
  check('#12 시간을 모두 빼면 버튼이 삭제로', await page.locator('.member-actions .primary-button').innerText(), '이 신청 삭제')
  await page.locator('.member-actions .primary-button').click()
  await page.waitForFunction(() => document.querySelector('.toast-message')?.innerText.includes('삭제했어요') || [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('삭제했어요')))
  check('#12 삭제 후 저장 목록에서 빠짐', await page.evaluate(() => JSON.parse(localStorage.getItem('raid-calendar-raid-schedules-v1')).some((e) => e.raidName === '무스펠' && e.nickname === '테스트본캐')), false)

  // 17. 캘린더 머리
  check('#17 캘린더 머리에 오늘 표시', (await page.locator('.day-header.is-today').innerText()).includes('오늘'))
  check('#17 캘린더 머리에 공휴일 표시', (await page.locator('.day-header.is-holiday').innerText()).includes('공휴일'))

  // 17. Esc
  await page.locator('.saved-schedule-clear').click()
  check('#17 전체 삭제 팝업 열림', await page.locator('.save-confirm-modal').count(), 1)
  await page.keyboard.press('Escape')
  check('#17 Esc로 팝업 닫힘', await page.locator('.save-confirm-modal').count(), 0)
  await context.close()
}

// ---------- 1, 7, 8, 9, 15, 16, 17 현황 ----------
{
  const healers = [sched('치유A', 3, { 토: ['21:00'] }, { className: '치유성', slotSignedAt: { '토|21:00': THIS_WEEK } }), sched('치유B', 4, { 토: ['21:00'] }, { className: '치유성', slotSignedAt: { '토|21:00': THIS_WEEK } })]
  const leaderOne = sched('혼자리더', 0, { 일: ['21:00'] }, { leadReady: 'O' })
  const nineNoLeader = Array.from({ length: 9 }, (_, i) => sched(`무리더${i + 1}`, 1, { 일: ['22:00'] }, { leadReady: 'X' }))
  // 시작까지 40분 남은 내 신청과, 하루 남은 내 신청
  const mine = sched(NICK, 0, { 수: ['21:00'], 목: ['21:00'] }, { id: 'mine', raidName: '무스펠', updatedAt: THIS_WEEK })
  const partners = [sched('파트너1', 1, { 수: ['21:00'] }), sched('파트너2', 2, { 수: ['21:00'] })]
  const schedules = [...crowd, ...healers, leaderOne, ...nineNoLeader, mine, ...partners]
  const { page, context } = await open(LOCAL, { schedules })
  await login(page)

  // 1. 정원/대기
  const waitingText = await page.locator('[id="calendar-slot-금-21:00"] .party-waiting').innerText()
  check('#1 늦게 신청한 사람이 대기', waitingText, '대기 2명: 레기온원11, 레기온원12')

  // 17. 치유성 분산
  const satColumns = await page.locator('[id="calendar-slot-토-21:00"] .party-column').evaluateAll((columns) => columns.map((c) => c.querySelectorAll('img.nickname-icon[alt="치유성"]').length))
  check('#17 치유성이 양쪽 파티로 나뉨', satColumns, [1, 1])

  // 9. 이름 잘림 측정
  const clipped = await page.locator('[id="calendar-slot-금-21:00"] .time-member-pill .member-name-wrap > span:first-child').evaluateAll((names) => names.filter((n) => n.scrollWidth > n.clientWidth).length)
  console.log('INFO 이름 폭', JSON.stringify(await page.locator('[id="calendar-slot-금-21:00"] .time-member-pill .member-name-wrap > span:first-child').evaluateAll((names) => names.map((n) => [n.innerText, n.scrollWidth, n.clientWidth]))))
  check('#9 1440px에서 잘린 이름 0명', clipped, 0)
  await page.locator('[id="calendar-slot-금-21:00"]').scrollIntoViewIfNeeded()
  await page.locator('[id="calendar-slot-금-21:00"]').screenshot({ path: join(out, 'pc-slot.png') })

  // 16. 추천 정렬
  const recommend = await page.locator('.recommend-card').evaluateAll((cards) => cards.map((c) => c.querySelector('.recommend-time').innerText + ' / ' + c.querySelector('.recommend-status').innerText))
  check('#16 정원 찬 시간이 1위, 출발 가능 표시', recommend[0], '금요일 21:00 / 출발 가능')
  check('#16 9명 시간이 리더 있는 소수 시간보다 위', recommend[1].startsWith('일요일 22:00'))
  check('#16 정원 초과는 10/10 +대기 수로', (await page.locator('.recommend-meta').first().innerText()).startsWith('10/10 +2 · 리딩'))
  check('표기 통일: 캘린더 칸', await page.locator('[id="calendar-slot-금-21:00"] .slot-count').innerText(), '10/10 +2')

  // 15. 내 다음 레이드
  const small = await page.locator('.next-raid-card small').first().innerText()
  check('#15 내 파티 표시', /[AB]파티/.test(small))
  check('#15 시작 1시간 안이면 준비 확인 버튼', await page.locator('.next-raid-card .day-raid-rally-button').count(), 1)

  // 15. 요일별 현황의 시간 제한: 목요일(하루 뒤) 줄에는 버튼 대신 안내
  check('#15 먼 시간은 준비 확인 대신 안내', (await page.locator('.day-raid-rally-hint').count()) >= 1)

  // 7. 나도 참여 (금 21:00 정원 초과 → 대기 신청, 토 21:00 → 참여)
  const satJoin = page.locator('[id="calendar-slot-토-21:00"] .join-slot-button')
  check('#7 캘린더 칸에 나도 참여 버튼', await satJoin.innerText(), '+ 나도 참여')
  check('#7 정원이 찬 칸은 대기 신청', await page.locator('[id="calendar-slot-금-21:00"] .join-slot-button').innerText(), '+ 대기 신청')
  check('#7 내가 이미 신청한 칸에는 버튼 없음', await page.locator('[id="calendar-slot-수-21:00"] .join-slot-button').count(), 0)
  check('#7 추천 카드에 버튼', (await page.locator('.recommend-item .join-slot-button').count()) >= 1)
  await satJoin.click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('신청했어요')))
  check('#7 누르면 그 칸이 내 시간으로', await page.locator('[id="calendar-slot-토-21:00"] .my-slot-badge').count(), 1)
  check('#7 신청 뒤 그 칸 버튼 사라짐', await page.locator('[id="calendar-slot-토-21:00"] .join-slot-button').count(), 0)
  await page.locator('.toast-action', { hasText: '취소' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('신청을 취소')))
  check('#7 취소하면 원래대로', await page.locator('[id="calendar-slot-토-21:00"] .my-slot-badge').count(), 0)

  // 8. 이 인원으로 시작 (수 21:00: 나 + 파트너 2명)
  await page.locator('.next-raid-card .day-raid-rally-button').click()
  await page.locator('.save-confirm-modal .primary-button').click()
  await page.locator('.next-raid-status').waitFor()
  check('#8 호출 뒤 준비 1/3', await page.locator('.next-raid-status').innerText(), '준비 1/3')
  check('#8 클리어는 아직 없음', await page.locator('[aria-label="21:00 클리어 O"]').count(), 0)
  const startButton = page.locator('.day-raid-rally-button', { hasText: '이 인원으로 시작' })
  check('#8 이 인원으로 시작 버튼', await startButton.count(), 1)
  await page.locator('.day-raid-summary-panel').screenshot({ path: join(out, 'pc-day.png') })
  console.log('INFO 시작버튼/카드', JSON.stringify(await startButton.evaluate((b) => { const r = b.getBoundingClientRect(); const c = b.closest('.day-raid-card').getBoundingClientRect(); const row = b.closest('.day-raid-run-row').getBoundingClientRect(); return { btn: [r.left, r.right, r.top, r.bottom].map(Math.round), card: [c.left, c.right].map(Math.round), row: [row.left, row.right].map(Math.round) } })))
  await page.locator('.toast').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((el) => el.click()))
  await startButton.click()
  check('#8 시작 확인 팝업', await page.locator('.save-confirm-modal h3').innerText(), '이 인원으로 시작할까요?')
  await page.locator('.save-confirm-modal .primary-button').click()
  await page.locator('[aria-label="21:00 클리어 O"]').first().waitFor()
  check('#8 시작하면 클리어 표시 가능', await page.locator('[aria-label="21:00 클리어 O"]').count(), 1)

  // 8. 대기 인원은 준비 집계에서 빠짐: 금 21:00 줄의 숫자
  const fridayRow = page.locator('[id="day-raid-row-금-무스펠 / 보통 / 트라이-21:00"]')
  check('#1 요일별 현황 인원 표기', await fridayRow.locator('.day-raid-time-count').innerText(), '10/10 +2')
  await fridayRow.locator('.day-raid-time-toggle').click()
  check('#1 펼치면 대기 구분', await fridayRow.locator('.day-raid-overflow-label').count(), 1)

  await page.screenshot({ path: join(out, 'pc-full.png'), fullPage: true })
  await context.close()
}

// ---------- 15. 대기 인원의 카드 ----------
{
  const me = sched(NICK, 0, { 수: ['21:00'] }, { id: 'mine', slotSignedAt: { '수|21:00': '2026-12-23T20:00:00+09:00' } })
  const others = Array.from({ length: 10 }, (_, i) => sched(`선착${i + 1}`, i, { 수: ['21:00'] }, { slotSignedAt: { '수|21:00': `2026-12-23T1${i}:00:00+09:00` } }))
  const { page, context } = await open(LOCAL, { schedules: [me, ...others] })
  await login(page)
  check('#15 내가 대기면 대기 번호 표시', (await page.locator('.next-raid-card small').first().innerText()).includes('대기 1번'))
  await context.close()
}

// ---------- 11. 모바일 ----------
{
  const mine = sched(NICK, 0, { 금: ['21:00'], 토: ['21:00'], 일: ['21:00'] }, { id: 'mine' })
  const { page, context } = await open(LOCAL, { schedules: [...crowd, mine], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await login(page)
  check('모바일: 첫 화면은 내 신청이 있는 요일', await page.locator('.day-raid-summary-panel .mobile-day-tab.active span').first().innerText(), '금')
  check('모바일: 이번 주 화면은 하루만 표시', await page.locator('.day-raid-card:visible').count(), 1)
  await page.locator('.mobile-tab', { hasText: '파티' }).tap()
  await page.waitForTimeout(200)
  const firstRow = await page.locator('.calendar-grid .time-label:visible').first().boundingBox()
  console.log(`INFO 모바일 주간 슬롯 첫 시간 줄 y=${Math.round(firstRow.y)} (수정 전 약 700)`)
  await page.screenshot({ path: join(out, 'm-calendar.png') })
  await page.locator('.mobile-tab', { hasText: '신청' }).tap()
  await page.waitForTimeout(200)
  const grid = await page.locator('.mobile-time-list').boundingBox()
  console.log(`INFO 모바일 시간표 시작 y=${Math.round(grid.y)} (수정 전 1273)`)
  check('#11 시간표가 수정 전(1273)보다 위', grid.y < 1100)
  await page.screenshot({ path: join(out, 'm-form.png') })

  // 14. 터치: 막힌 칸을 탭하면 이유 표시
  await pickTarget(page, '비탄의 설원', '보통', '트라이')
  await page.locator('.form-panel .mobile-day-tab', { hasText: '토' }).tap()
  const taken = page.locator('[aria-label="토요일 21:00"]')
  await taken.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await taken.tap({ force: true })
  check('#14 터치로 막힌 칸을 눌러도 이유 표시', (await toastText(page)).includes('이미 신청한 시간'))

  // 17. 터치 영역
  const chip = await page.locator('.saved-slot-chip').first().boundingBox()
  check('#17 터치 칩 높이 36px 이상', chip.height >= 36)
  await context.close()
}

// ---------- 모바일: 처음 쓰는 사람의 신청 흐름 ----------
{
  const blankMember = { ...memberRow, className: '', power: '', leadReady: '', attendance: '참' }
  const { page, context } = await open(LOCAL, { schedules: crowd, members: [blankMember], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, showGuide: true })
  await login(page)

  // 첫 사용 안내
  check('모바일: 첫 로그인에 사용법 표시', await page.locator('.mobile-guide').count(), 1)
  await page.locator('.mobile-guide .primary-button').tap()
  check('모바일: 사용법 닫힘', await page.locator('.mobile-guide').count(), 0)
  check('모바일: 사용법을 봤다고 기억', await page.evaluate(() => localStorage.getItem('raid-calendar-mobile-guide-v1')), '1')
  await page.locator('.mobile-menu-button').tap()
  await page.locator('.mobile-nav-actions button', { hasText: '사용법' }).tap()
  check('모바일: 메뉴에서 사용법 다시 보기', await page.locator('.mobile-guide').count(), 1)
  await page.locator('.mobile-guide .primary-button').tap()
  await page.reload()
  await login(page)
  check('모바일: 다음 로그인에는 사용법 안 나옴', await page.locator('.mobile-guide').count(), 0)

  // 탭 이름
  check('모바일: 탭 이름', await page.locator('.mobile-tab span').allInnerTexts(), ['신청', '이번 주', '파티', '인원'])
  check('모바일: 신청이 없으면 빈 카드 숨김', await page.locator('.next-raid-card:visible').count(), 0)
  check('모바일: 고칠 수 없는 닉네임 칸 없음', await page.locator('#nickname').count(), 0)
  check('모바일: 8열 시간표 대신 시간 버튼', [await page.locator('.time-pick-grid').count(), (await page.locator('.mobile-time-button').count()) > 0], [0, true])

  // 레이드를 고르기 전에 시간을 누르면 안내
  await page.locator('.form-panel .mobile-day-tab', { hasText: '금' }).tap()
  await page.locator('[aria-label="금요일 21:00"]').tap()
  check('모바일: 레이드 전에 시간을 누르면 안내', (await toastText(page)).includes('먼저 골라'))
  check('모바일: 그때는 선택되지 않음', await page.locator('[aria-label="금요일 21:00"]').getAttribute('aria-pressed'), 'false')

  await page.selectOption('#className', '검성')
  await page.selectOption('#power', '700~800k')
  await page.locator('[aria-label="리딩 여부"] button').first().tap()
  check('모바일: 1단계 완료 표시', await page.locator('.form-step-number').first().innerText(), '✓')
  await pickTarget(page)
  check('모바일: 2단계 완료 표시', await page.locator('.form-step-number').nth(1).innerText(), '✓')

  // 시간 고르기
  check('모바일: 그 시간 신청 인원 표시', await page.locator('[aria-label="금요일 21:00"] small').innerText(), '12명 신청')
  await page.locator('[aria-label="금요일 21:00"]').tap()
  await page.locator('[aria-label="금요일 22:00"]').tap()
  check('모바일: 요일 탭에 고른 개수', await page.locator('.form-panel .mobile-day-tab.active .mobile-day-tab-count').innerText(), '2')
  check('모바일: 고른 시간 요약', (await page.locator('.mobile-time-summary').innerText()).includes('금 21:00, 22:00'))
  check('모바일: 저장 버튼에 개수', await page.locator('.member-actions .primary-button').innerText(), '시간 2개 저장하기')

  // 지난 시간 (수요일 20:30 기준 19:00은 지남)
  await page.locator('.form-panel .mobile-day-tab', { hasText: '수' }).tap()
  check('모바일: 지난 시간 표시', await page.locator('[aria-label="수요일 19:00"] small').innerText(), '지남')
  await page.locator('[aria-label="수요일 19:00"]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.locator('[aria-label="수요일 19:00"]').tap({ force: true })
  check('모바일: 지난 시간은 안 골라짐', await page.locator('[aria-label="수요일 19:00"]').getAttribute('aria-pressed'), 'false')

  // 평일에는 낮시간 버튼이 없고, 공휴일에는 있다
  check('모바일: 평일에는 낮시간 버튼 없음', await page.locator('button', { hasText: '낮시간 보기' }).count(), 0)
  await page.locator('.form-panel .mobile-day-tab', { hasText: '금' }).tap()
  await page.locator('button', { hasText: '낮시간 보기' }).tap()
  check('모바일: 공휴일 낮시간 표시', await page.locator('[aria-label="금요일 12:00"]').count(), 1)

  // 저장 뒤 현황으로 이동
  await page.locator('.member-actions .primary-button').tap()
  await page.locator('.toast-action', { hasText: '현황 보기' }).tap()
  check('모바일: 저장 뒤 이번 주 화면으로', await page.locator('.mobile-tab.active span').innerText(), '이번 주')
  check('모바일: 내 시간 표시', await page.locator('[id="day-raid-row-금-무스펠 / 보통 / 트라이-22:00"] .my-slot-badge').count(), 1)
  await page.locator('[id="day-raid-row-금-무스펠 / 보통 / 트라이-21:00"] .day-raid-time-toggle').tap()
  check('모바일: 인원 펼치기', await page.locator('[id="day-raid-row-금-무스펠 / 보통 / 트라이-21:00"] .day-raid-members').count(), 1)

  // 파티 화면: 고르기 칸과 빈 시간 신청
  await page.locator('.mobile-tab', { hasText: '파티' }).tap()
  check('모바일: 탭 묶음 대신 고르기 칸', [await page.locator('.raid-tab-group').count(), await page.locator('.mobile-raid-select select').count()], [0, 2])
  await page.locator('.mobile-day-tabs[data-section="calendar"] .mobile-day-tab', { hasText: '토' }).tap()
  const vacantJoin = page.locator('[id="calendar-slot-토-19:00"] .join-slot-button')
  check('모바일: 빈 시간 신청 버튼', await vacantJoin.innerText(), '+ 신청')
  await vacantJoin.tap()
  await page.locator('[id="calendar-slot-토-19:00"] .my-slot-badge').waitFor()
  check('모바일: 빈 시간에 바로 신청', await page.locator('[id="calendar-slot-토-19:00"] .my-slot-badge').count(), 1)
  await page.selectOption('.mobile-raid-select select >> nth=0', '비탄의 설원 보통')
  check('모바일: 레이드를 바꾸면 그 레이드 시간표', await page.locator('[id="calendar-slot-토-19:00"] .my-slot-badge').count(), 0)

  const overflowing = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  check('모바일: 가로 스크롤 없음', overflowing, false)
  await context.close()
}

// ---------- 모바일: 뒤로 가기, 저장됨, 추천 접기, 터치 크기, 같은 시간 복사 ----------
{
  const mine = sched(NICK, 0, { 금: ['21:00'], 토: ['22:00'] }, { id: 'mine', power: '700~800k' })
  const rallyRun = { weekStart: '2026-12-23', day: '금', time: '21:00', raidName: '무스펠', difficulty: '보통', mode: '트라이', rallyCalledBy: '레기온원2', rallyCalledAt: THIS_WEEK, rallyCheckins: ['레기온원2'], gatheredAt: null, cleared: null, clearedBy: null }
  const { page, context } = await open(LOCAL, {
    schedules: [...crowd, mine],
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify([rallyRun]) },
  })
  await login(page)
  const activeTab = () => page.locator('.mobile-tab.active span').innerText()

  // 뒤로 가기
  check('뒤로 가기: 시작 탭', await activeTab(), '이번 주')
  await page.locator('.mobile-tab', { hasText: '파티' }).tap()
  await page.locator('.mobile-tab', { hasText: '인원' }).tap()
  await page.goBack()
  check('뒤로 가기: 이전 탭으로', await activeTab(), '파티')
  await page.goBack()
  check('뒤로 가기: 그 이전 탭으로', await activeTab(), '이번 주')
  check('뒤로 가기: 앱을 벗어나지 않음', await page.locator('.app-shell').count(), 1)

  await page.locator('.mobile-menu-button').tap()
  check('뒤로 가기: 메뉴 열림', await page.locator('.mobile-nav-drawer').count(), 1)
  await page.goBack()
  check('뒤로 가기: 메뉴가 닫힘', await page.locator('.mobile-nav-drawer').count(), 0)
  check('뒤로 가기: 메뉴를 닫아도 탭 유지', await activeTab(), '이번 주')

  await page.locator('.mobile-tab', { hasText: '파티' }).tap()
  await page.locator('.mobile-menu-button').tap()
  await page.locator('.mobile-nav-close').tap()
  await page.waitForTimeout(100)
  check('뒤로 가기: 버튼으로 닫으면 탭 유지', await activeTab(), '파티')
  await page.goBack()
  check('뒤로 가기: 버튼으로 닫은 뒤 한 번에 이전 탭으로', await activeTab(), '이번 주')

  await page.locator('.mobile-menu-button').tap()
  await page.locator('.mobile-nav-actions button', { hasText: '사용법' }).tap()
  check('뒤로 가기: 메뉴에서 연 사용법 표시', await page.locator('.mobile-guide').count(), 1)
  await page.goBack()
  check('뒤로 가기: 사용법이 닫힘', await page.locator('.mobile-guide').count(), 0)

  // 추천 접기
  check('추천: 기본은 접힘', await page.locator('.recommend-list').count(), 0)
  check('추천: 접혀도 1순위 표시', (await page.locator('.recommend-toggle-preview').innerText()).startsWith('금 21:00'))
  await page.locator('.recommend-toggle').tap()
  check('추천: 누르면 펼침', await page.locator('.recommend-list').count(), 1)
  await page.locator('.recommend-toggle').tap()
  check('추천: 다시 접힘', await page.locator('.recommend-list').count(), 0)

  // 터치 크기와 입력칸 글자 크기를 네 탭에서 모두 잰다.
  await page.locator('.mobile-tab', { hasText: '신청' }).tap()
  await page.locator('.mobile-day-tabs[data-section="form"] .mobile-day-tab', { hasText: '금' }).tap()
  for (const name of ['신청', '이번 주', '파티', '인원']) {
    await page.locator('.mobile-tab', { hasText: name }).tap()
    await page.waitForTimeout(100)
    const small = await page.evaluate(() => {
      const found = new Set()
      document.querySelectorAll('button, select, a, [role="button"]').forEach((el) => {
        const rect = el.getBoundingClientRect()
        if (rect.width && rect.height && rect.height < 40) found.add(`${String(el.className || el.tagName).split(' ')[0]}:${Math.round(rect.height)}`)
      })
      return [...found]
    })
    check(`터치 크기 40px 이상: ${name}`, small, [])
    const smallInputs = await page.evaluate(() => [...document.querySelectorAll('input, select, textarea')]
      .filter((el) => el.offsetParent !== null && parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => el.id || el.tagName))
    check(`입력칸 글자 16px 이상: ${name}`, smallInputs, [])
  }

  // 저장됨 표시
  await page.locator('.mobile-tab', { hasText: '신청' }).tap()
  const saveButton = page.locator('.member-actions .primary-button')
  check('저장: 변경이 없으면 저장됨', await saveButton.innerText(), '✓ 저장됨')
  check('저장: 저장됨이면 누를 수 없음', await saveButton.isDisabled(), true)

  // 같은 시간 다른 요일에도 넣기 (금 21:00을 복사. 토 21:00 등 남은 요일로)
  await page.locator('.mobile-day-tabs[data-section="form"] .mobile-day-tab', { hasText: '금' }).tap()
  await page.locator('.mobile-copy-times').tap()
  check('복사: 안내', (await toastText(page)).includes('개 요일에 같은 시간을 넣었어요'))
  check('복사: 평일에 들어감', (await page.locator('.mobile-time-summary').innerText()).includes('목 21:00'))
  check('복사: 지났거나 없는 요일 제외 후 버튼이 저장으로', (await saveButton.innerText()).endsWith('저장하기'))
  await page.locator('.toast-action', { hasText: '되돌리기' }).tap()
  check('복사: 되돌리기', await saveButton.innerText(), '✓ 저장됨')
  await page.locator('[aria-label="금요일 22:00"]').tap()
  check('저장: 시간을 바꾸면 다시 저장 버튼', await saveButton.innerText(), '시간 3개 저장하기')
  await context.close()
}

// ---------- 페이지 기본 설정 ----------
{
  const { page, context } = await open(LOCAL)
  check('언어 설정', await page.locator('html').getAttribute('lang'), 'ko')
  check('제목', await page.title(), '그루 레기온 설원 스케줄')
  check('테마 색', Boolean(await page.locator('meta[name="theme-color"]').getAttribute('content')), true)
  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]')
    const data = await (await fetch(link.href)).json()
    const icons = await Promise.all(data.icons.map(async (icon) => (await fetch(icon.src)).ok))
    return { name: data.short_name, icons }
  })
  check('홈 화면 이름', manifest.name, '설원 스케줄')
  check('홈 화면 아이콘 파일', manifest.icons, [true, true])
  await context.close()
}

// ---------- PC는 기존 방식 유지 ----------
{
  const { page, context } = await open(LOCAL, { schedules: crowd, showGuide: true })
  await login(page)
  check('PC: 사용법 팝업 없음', await page.locator('.mobile-guide').count(), 0)
  const pcHistory = await page.evaluate(() => history.length)
  await page.locator('.saved-schedule-clear').count()
  check('PC: 추천 목록은 항상 펼침', [await page.locator('.recommend-list').count(), await page.locator('.recommend-toggle').count()], [1, 0])
  check('PC: 뒤로 가기 기록을 건드리지 않음', await page.evaluate(() => history.length), pcHistory)
  check('PC: 칸 시간표 유지', [await page.locator('.time-pick-grid').count(), await page.locator('.mobile-time-list').count()], [1, 0])
  check('PC: 레이드 탭 유지', [await page.locator('.raid-tab-group').count(), await page.locator('.mobile-raid-select').count()], [1, 0])
  check('PC: 빈 칸에는 신청 버튼 없음', await page.locator('[id="calendar-slot-토-19:00"] .join-slot-button').count(), 0)
  check('PC: 요일 7개 카드 표시', await page.locator('.day-raid-card:visible').count(), 7)
  await context.close()
}

// ---------- 2, 10, SQL 실행 전 호환 (가짜 Supabase) ----------
{
  const toRow = (e) => ({ id: e.id, nickname: e.nickname, raid_name: e.raidName, difficulty: e.difficulty, mode: e.mode, days: e.days, times: e.times, day_time_selection: e.dayTimeSelection, attendance: e.attendance, class_name: e.className, power: e.power, lead_ready: e.leadReady, updated_at: e.updatedAt, ...(e.slotSignedAt ? { slot_signed_at: e.slotSignedAt } : {}) })
  const state = { failing: true, rows: crowd.map((e) => { const { slotSignedAt: _ignored, ...rest } = e; return toRow(rest) }) }
  let socketRoute = null
  const topics = {}

  const routes = async (context) => {
    await context.route(`${FAKE_SUPABASE}/**`, async (route) => {
      const url = route.request().url()
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
      if (url.includes('/rpc/member_login')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: '"ok"' })
      if (state.failing && url.includes('/rest/v1/raid_schedules')) return route.fulfill({ status: 500, headers: cors, contentType: 'application/json', body: '{"message":"down"}' })
      if (url.includes('/rest/v1/raid_schedules')) return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify(state.rows) })
      return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: url.includes('member_alts') ? '[]' : url.includes('nickname=eq') ? 'null' : '[]' })
    })
    await context.routeWebSocket(/fake-supabase\.test\/realtime/, (ws) => {
      socketRoute = ws
      ws.onMessage((raw) => {
        const message = JSON.parse(raw)
        const [joinRef, ref, topic, event, payload] = Array.isArray(message) ? message : [message.join_ref, message.ref, message.topic, message.event, message.payload]
        const reply = (body) => ws.send(Array.isArray(message) ? JSON.stringify([joinRef, ref, topic, 'phx_reply', body]) : JSON.stringify({ topic, event: 'phx_reply', ref, payload: body }))
        if (event === 'phx_join') {
          const bindings = (payload.config?.postgres_changes ?? []).map((binding, index) => ({ ...binding, id: index + 1 }))
          topics[topic] = { bindings, array: Array.isArray(message), joinRef }
          reply({ status: 'ok', response: { postgres_changes: bindings } })
        } else {
          reply({ status: 'ok', response: {} })
        }
      })
    })
  }

  const { page, context } = await open(REMOTE, { routes, members: [], extraStorage: { 'raid-calendar-login-v1': NICK, 'raid-calendar-saved-password-v1': PW } })
  await page.waitForSelector('.app-shell')
  await page.waitForSelector('.data-load-banner', { timeout: 5000 }).catch(() => {})
  check('#10 불러오기 실패 배너', await page.locator('.data-load-banner').count(), 1)
  const emptyTexts = await page.locator('.day-raid-card .empty-role').allInnerTexts()
  check('#10 실패 시 신청 없음으로 보이지 않음', emptyTexts.includes('신청 인원 없음'), false)
  check('#10 실패 문구', emptyTexts.includes('불러오지 못했어요'))

  state.failing = false
  await page.locator('.data-load-banner button').click()
  await page.waitForSelector('[id="calendar-slot-금-21:00"] .party-waiting')
  check('#10 다시 불러오면 배너 사라짐', await page.locator('.data-load-banner').count(), 0)
  // slot_signed_at 컬럼이 없는 응답: 먼저 저장한(updated_at이 이른) 사람이 앞. crowd는 번호가 클수록 먼저 저장.
  check('SQL 실행 전에도 동작 (마지막 저장 순)', await page.locator('[id="calendar-slot-금-21:00"] .party-waiting').innerText(), '대기 2명: 레기온원2, 일곱글자닉네임')

  // 2. 실시간 삭제 이벤트: new={} old={id}
  await page.waitForTimeout(300)
  const topic = Object.keys(topics).find((name) => name.includes('raid-schedules-live'))
  check('#2 실시간 채널 구독', Boolean(topic))
  const info = topics[topic]
  const data = { type: 'DELETE', schema: 'public', table: 'raid_schedules', commit_timestamp: new Date().toISOString(), errors: null, columns: [{ name: 'id', type: 'uuid' }], old_record: { id: crowd[0].id }, record: {} }
  const payload = { ids: info.bindings.map((binding) => binding.id), data }
  const beforeCount = await page.locator('[id="calendar-slot-금-21:00"] .slot-count').innerText()
  socketRoute.send(info.array ? JSON.stringify([info.joinRef, null, topic, 'postgres_changes', payload]) : JSON.stringify({ topic, event: 'postgres_changes', ref: null, payload }))
  await page.waitForFunction(() => document.querySelector('[id="calendar-slot-금-21:00"] .slot-count')?.innerText === '10/10 +1', null, { timeout: 3000 }).catch(() => {})
  check('#2 다른 사람의 삭제가 바로 반영', [beforeCount, await page.locator('[id="calendar-slot-금-21:00"] .slot-count').innerText()], ['10/10 +2', '10/10 +1'])

  // 10. 돌아왔을 때 다시 불러오기 (30초 제한을 넘긴 뒤 focus)
  state.rows = state.rows.slice(0, 5)
  await page.clock.setFixedTime(new Date(new Date(NOW).getTime() + 60000))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => document.querySelector('[id="calendar-slot-금-21:00"] .slot-count')?.innerText === '5/10', null, { timeout: 3000 }).catch(() => {})
  check('#10 앱으로 돌아오면 최신 현황', await page.locator('[id="calendar-slot-금-21:00"] .slot-count').innerText(), '5/10')

  // 대기에서 정원으로 올라오면 앱에서 바로 알림
  const promoteRows = [
    ...Array.from({ length: 10 }, (_, i) => toRow(sched(`선착${i + 1}`, i, { 금: ['21:00'] }, { id: `p-${i}`, slotSignedAt: { '금|21:00': `2026-12-23T10:0${i}:00+09:00` } }))),
    toRow(sched(NICK, 1, { 금: ['21:00'] }, { id: 'p-me', slotSignedAt: { '금|21:00': '2026-12-23T11:00:00+09:00' } })),
  ]
  state.rows = promoteRows
  await page.clock.setFixedTime(new Date(new Date(NOW).getTime() + 120000))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => document.querySelector('.next-raid-card small')?.innerText.includes('대기 1번'), null, { timeout: 3000 }).catch(() => {})
  check('내가 대기 1번', (await page.locator('.next-raid-card small').first().innerText()).includes('대기 1번'))
  const promoteData = { ...data, old_record: { id: 'p-0' }, commit_timestamp: new Date().toISOString() }
  const promotePayload = { ids: info.bindings.map((binding) => binding.id), data: promoteData }
  socketRoute.send(info.array ? JSON.stringify([info.joinRef, null, topic, 'postgres_changes', promotePayload]) : JSON.stringify({ topic, event: 'postgres_changes', ref: null, payload: promotePayload }))
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('정원으로 올라왔어요')), null, { timeout: 3000 }).catch(() => {})
  check('대기에서 정원으로 올라오면 앱 알림', (await toastText(page)).includes('정원으로 올라왔어요'))
  await context.close()
}

// ---------- 준비 확인 멈춤 해소 ----------
{
  const mine = sched(NICK, 0, { 수: ['21:00'] }, { id: 'mine' })
  const partner = sched('파트너1', 1, { 수: ['21:00'] })
  const run = { weekStart: '2026-12-23', day: '수', time: '21:00', raidName: '무스펠', difficulty: '보통', mode: '트라이', rallyCalledBy: NICK, rallyCalledAt: THIS_WEEK, rallyCheckins: [NICK, '파트너1'], gatheredAt: null, cleared: null, clearedBy: null }
  const { page, context } = await open(LOCAL, { schedules: [mine, partner], extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify([run]) } })
  await login(page)
  check('미준비자가 신청을 지워 2/2인데 전원 준비가 아닌 상태', await page.locator('.next-raid-status').innerText(), '준비 2/2')
  const startButton = page.locator('.day-raid-rally-button', { hasText: '이 인원으로 시작' })
  check('이 상태에서도 시작 버튼 표시', await startButton.count(), 1)
  await startButton.click()
  await page.locator('.save-confirm-modal .primary-button').click()
  await page.locator('[aria-label="21:00 클리어 O"]').first().waitFor()
  check('시작하면 클리어 표시 가능', await page.locator('[aria-label="21:00 클리어 O"]').count(), 1)
  await context.close()
}

// ---------- 심야 ----------
{
  const lateRaid = sched(NICK, 0, { 수: ['21:00'], 목: ['23:00'] }, { id: 'mine' })
  const night = await open(LOCAL, { schedules: [lateRaid], now: '2026-12-25T00:30:00+09:00' })
  await login(night.page)
  const cardClass = (page, label) => page.locator('.day-raid-card', { hasText: label }).getAttribute('class')
  check('자정 뒤 새벽에는 전날 카드를 접지 않음', (await cardClass(night.page, '목요일')).includes('is-collapsed'), false)
  check('그 전날 카드는 접힘', (await cardClass(night.page, '수요일')).includes('is-collapsed'))
  check('오늘 표시는 실제 오늘', (await night.page.locator('.day-raid-card.is-today').innerText()).startsWith('금요일'))
  await night.context.close()

  const morning = await open(LOCAL, { schedules: [lateRaid], now: '2026-12-25T07:00:00+09:00' })
  await login(morning.page)
  check('오전 6시가 지나면 전날 카드도 접힘', (await cardClass(morning.page, '목요일')).includes('is-collapsed'))
  await morning.context.close()

  // 리셋 뒤 지난주 화요일 레이드 마무리
  const tuesdayRuns = [
    sched(NICK, 0, { 화: ['23:00'] }, { id: 'tue-a' }),
    sched(NICK, 0, { 화: ['22:00'] }, { id: 'tue-b', raidName: '비탄의 설원' }),
    sched(NICK, 0, { 화: ['20:00'] }, { id: 'tue-c', mode: '반숙이상' }),
  ]
  const baseRun = { weekStart: '2026-12-23', day: '화', difficulty: '보통', mode: '트라이', rallyCalledBy: NICK, rallyCalledAt: THIS_WEEK, rallyCheckins: [NICK], cleared: null, clearedBy: null }
  const runs = [
    { ...baseRun, time: '23:00', raidName: '무스펠', gatheredAt: THIS_WEEK },
    { ...baseRun, time: '22:00', raidName: '비탄의 설원', gatheredAt: null },
  ]
  const resetNight = await open(LOCAL, { schedules: tuesdayRuns, now: '2026-12-30T00:30:00+09:00', extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify(runs) } })
  await login(resetNight.page)
  check('리셋 뒤 지난주 화요일 레이드 표시', await resetNight.page.locator('.last-week-raids li').count(), 2)
  await resetNight.page.locator('[aria-label="지난주 화요일 23:00 클리어 O"]').click()
  await resetNight.page.locator('.save-confirm-modal .primary-button').click()
  await resetNight.page.waitForFunction(() => document.querySelector('[aria-label="지난주 화요일 23:00 클리어 O"]')?.getAttribute('aria-pressed') === 'true')
  const storedRuns = await resetNight.page.evaluate(() => JSON.parse(localStorage.getItem('raid-calendar-raid-runs-v1')))
  check('지난주 레이드에 클리어 저장', storedRuns.find((r) => r.time === '23:00').cleared, 'O')
  await resetNight.page.locator('.last-week-raids .day-raid-rally-button').click()
  await resetNight.page.locator('.save-confirm-modal .primary-button').click()
  await resetNight.page.locator('[aria-label="지난주 화요일 22:00 클리어 O"]').waitFor()
  check('전원 준비 전이던 지난주 레이드도 시작 후 클리어 가능', await resetNight.page.locator('[aria-label="지난주 화요일 22:00 클리어 O"]').count(), 1)
  await resetNight.context.close()

  const afterGrace = await open(LOCAL, { schedules: tuesdayRuns, now: '2026-12-30T06:30:00+09:00', extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify(runs) } })
  await login(afterGrace.page)
  check('오전 6시가 지나면 지난주 표시 사라짐', await afterGrace.page.locator('.last-week-raids').count(), 0)
  await afterGrace.context.close()
}

// ---------- 삭제 되돌리기 순서 유지, 유령 신청 ----------
{
  const first = sched(NICK, 0, { 금: ['21:00'] }, { id: 'mine', slotSignedAt: { '금|21:00': '2026-12-23T09:00:00+09:00' } })
  const { page, context } = await open(LOCAL, { schedules: [first, ...crowd] })
  await login(page)
  const waiting = () => page.locator('[id="calendar-slot-금-21:00"] .party-waiting').innerText()
  check('삭제 전 대기 3명', await waiting(), '대기 3명: 레기온원10, 레기온원11, 레기온원12')
  await page.locator('.saved-schedule-delete').click()
  await page.locator('.toast-action', { hasText: '되돌리기' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('되돌렸어요')))
  check('삭제를 되돌리면 원래 순서', await waiting(), '대기 3명: 레기온원10, 레기온원11, 레기온원12')
  await context.close()

  const ghost = { ...memberRow, id: 'ghost', nickname: '유령', days: ['토'], times: ['20:00'], attendance: '참', updatedAt: THIS_WEEK }
  const ghostPage = await open(LOCAL, { members: [memberRow, ghost] })
  await login(ghostPage.page)
  check('members의 옛 시간은 신청으로 안 나옴', await ghostPage.page.locator('[id="calendar-slot-토-20:00"] .slot-count').count(), 0)
  await ghostPage.context.close()
}

await browser.close()
console.log(failures ? `\n실패 ${failures}건` : '\n모두 통과')
process.exit(failures ? 1 : 0)

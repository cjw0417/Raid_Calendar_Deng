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

// 금 21:00에 22명: 신청 순서는 레기온원1이 가장 먼저. 목록 순서는 일부러 뒤집어 둔다.
// 앞의 10명이 1공대, 그다음 10명이 2공대, 21 · 22번째는 대기다.
const crowd = Array.from({ length: 22 },(_, i) => sched(i === 0 ? '일곱글자닉네임' : `레기온원${i + 1}`, i, { 금: ['21:00'] }, {
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
  // 모바일에서 이미 골라 접혀 있으면 먼저 펼친다.
  if (await page.locator('.target-summary').count()) await page.locator('.target-summary button').click()
  await page.locator('[aria-label="레이드"] button', { hasText: raid }).click()
  await page.locator('[aria-label="난이도"] button', { hasText: difficulty }).click()
  await page.locator('[aria-label="공략 방식"] button', { hasText: mode }).click()
}

// PC 오른쪽 영역의 탭을 바꾼다.
// PC는 파티 표가 '이번 주' 탭 아래에 있어서 '파티'는 이번 주 탭으로 간다.
const pcTab = (page, name) => page.locator('.pc-tab', { hasText: name === '파티' ? '이번 주' : name }).click()

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
  // 화면 아래 '저장 안 됨' 안내에 가리지 않게 가운데로 옮긴 뒤 누른다.
  await page.locator('[aria-label="수요일 19:00"]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.locator('[aria-label="수요일 19:00"]').click({ force: true })
  check('#13 지난 시간은 안 골라짐', await page.locator('[aria-label="수요일 19:00"]').getAttribute('aria-pressed'), 'false')
  check('#14 지난 시간을 누르면 이유 표시', (await toastText(page)).includes('이미 지난 시간'))
  await page.locator('[aria-label="화요일 23:00"]').evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await page.locator('[aria-label="화요일 23:00"]').click({ force: true })
  check('같은 시간 다른 레이드도 고를 수 있음', await page.locator('[aria-label="화요일 23:00"]').getAttribute('aria-pressed'), 'true')
  check('같은 시간 다른 레이드는 점과 설명으로 표시', [
    await page.locator('.time-pick-cell.has-other-raid').count(),
    (await page.locator('[aria-label="화요일 23:00"]').getAttribute('title')).includes('비탄의 설원 보통 트라이'),
  ], [1, true])
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

  check('PC 탭: 처음에는 이번 주 (아래에 파티 표까지)', [
    await page.locator('.pc-tab.active').innerText(),
    await page.locator('.day-raid-summary-panel').isVisible(),
    await page.locator('.calendar-grid').isVisible(),
    await page.locator('.member-day-summary:visible').count(),
  ], ['이번 주', true, true, 0])
  check('PC 탭: 파티 탭은 따로 없음', await page.locator('.pc-tab').allInnerTexts(), ['이번 주', '클리어', '인원'])
  const [summaryBox, partyHeaderBox] = [await page.locator('.day-raid-summary-panel').boundingBox(), await page.locator('.calendar-panel > .panel-header').boundingBox()]
  check('PC 탭: 파티 표는 요일 카드 아래', partyHeaderBox.y >= summaryBox.y + summaryBox.height)
  await pcTab(page, '클리어')
  check('PC 탭: 다른 탭에서는 파티 표 숨김', await page.locator('.calendar-grid').isVisible(), false)
  await pcTab(page, '파티')

  // 1. 정원/2공대/대기
  const fridayCell = page.locator('[id="calendar-slot-금-21:00"]')
  check('#1 정원을 넘으면 2공대를 따로 보여 줌', await fridayCell.locator('.party-block-label').allInnerTexts(), ['1공대', '2공대'])
  check('#1 공대마다 A/B 5명씩', await fridayCell.locator('.party-column').evaluateAll((cols) => cols.map((c) => c.querySelectorAll('.time-member-pill').length)), [5, 5, 5, 5])
  const secondPartyNames = await fridayCell.locator('.party-block').nth(1).locator('.member-name-wrap > span:first-child').allInnerTexts()
  check('#1 11~20번째가 2공대', secondPartyNames.sort(), Array.from({ length: 10 }, (_, i) => `레기온원${i + 11}`).sort())
  const waitingText = await fridayCell.locator('.party-waiting').innerText()
  check('#1 2공대까지 차면 늦게 신청한 사람이 대기', waitingText, '대기 2명: 레기온원21, 레기온원22')
  check('#1 정원을 안 넘으면 공대 이름 없음', await page.locator('[id="calendar-slot-토-21:00"] .party-block-label').count(), 0)

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
  await pcTab(page, '이번 주')
  check('#16 PC 추천은 세 곳을 한 줄에', [
    await page.locator('.recommend-card').count(),
    new Set(await page.locator('.recommend-card').evaluateAll((cards) => cards.map((card) => Math.round(card.getBoundingClientRect().top)))).size,
    await page.locator('.recommend-row').evaluate((el) => el.getBoundingClientRect().height <= 80),
  ], [3, 1, true])
  const recommend = await page.locator('.recommend-card').evaluateAll((cards) => cards.map((c) => c.querySelector('.recommend-time').innerText + ' / ' + c.querySelector('.recommend-status').innerText))
  check('#16 정원 찬 시간이 1위, 출발 가능 표시', recommend[0], '금요일 21:00 / 출발 가능')
  check('#16 9명 시간이 리더 있는 소수 시간보다 위', recommend[1].startsWith('일요일 22:00'))
  check('#16 2공대까지 넘으면 20/20 +대기 수로', (await page.locator('.recommend-meta').first().innerText()).startsWith('20/20 +2 · 리딩'))
  // 추천을 누르면 아래 파티 표의 그 칸으로 간다. (PC는 파티 표가 이번 주 탭 아래에 있다)
  await page.locator('.recommend-card').first().click()
  check('#16 추천을 누르면 파티 표의 그 칸으로', [await page.locator('.pc-tab.active').innerText(), await page.locator('[id="calendar-slot-금-21:00"]').isVisible()], ['이번 주', true])
  check('표기 통일: 캘린더 칸', await page.locator('[id="calendar-slot-금-21:00"] .slot-count').innerText(), '20/20 +2')

  // 15. 내 다음 레이드
  const small = await page.locator('.next-raid-card small').first().innerText()
  check('#15 내 파티 표시', /[AB]파티/.test(small))
  check('#15 시작 1시간 안이면 준비 확인 버튼', await page.locator('.next-raid-card .day-raid-rally-button').count(), 1)

  // 15. 요일별 현황의 시간 제한: 목요일(하루 뒤) 줄은 접혀 있으면 버튼이 없고, 펼치면 안내
  await pcTab(page, '이번 주')
  const thursdayRow = page.locator('[id="day-raid-row-목-무스펠 / 보통 / 트라이-21:00"]')
  check('#15 먼 시간은 접힌 줄에 버튼 없음', await thursdayRow.locator('.day-raid-run-row').count(), 0)
  await thursdayRow.locator('.day-raid-time-toggle').click()
  check('#15 먼 시간은 펼치면 준비 확인 대신 안내', await thursdayRow.locator('.day-raid-rally-hint').count(), 1)
  await thursdayRow.locator('.day-raid-time-toggle').click()
  // 한 줄 시간 줄: 내 시간 표시, 직업 아이콘, 참여(+) · 대기 버튼
  check('시간 줄: 내 시간은 색 띠와 글자', [await thursdayRow.evaluate((el) => el.classList.contains('is-mine')), await thursdayRow.locator('.my-slot-badge').innerText()], [true, '내 시간'])
  check('시간 줄: 펼치기 화살표 표시', await thursdayRow.locator('.day-raid-toggle-arrow').isVisible())
  check('시간 줄: 직업 아이콘 유지', await thursdayRow.locator('.day-raid-stack-icon').count(), 1)
  const sundayRow = page.locator('[id="day-raid-row-일-무스펠 / 보통 / 트라이-22:00"]')
  check('시간 줄: 리더 없음 글자', await sundayRow.locator('.slot-warn').innerText(), '리더 없음')
  check('시간 줄: 참여, 정원이 차면 대기', [
    await sundayRow.locator('.join-slot-button').innerText(),
    await page.locator('[id="day-raid-row-금-무스펠 / 보통 / 트라이-21:00"] .join-slot-button').innerText(),
    await thursdayRow.locator('.join-slot-button').count(),
  ], ['+ 참여', '+ 대기', 0])
  await pcTab(page, '파티')

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
  await pcTab(page, '이번 주')
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
  check('#1 요일별 현황 인원 표기', await fridayRow.locator('.day-raid-time-count').innerText(), '20/20 +2')
  await fridayRow.locator('.day-raid-time-toggle').click()
  check('#1 펼치면 1공대 · 2공대 · 대기 구분', await fridayRow.locator('.day-raid-overflow-label').allInnerTexts(), ['1공대 (10/10)', '2공대 (10/10)', '대기 (신청 순)'])
  check('#1 2공대 사람은 1공대 다음에', (await fridayRow.locator('.day-raid-member .member-name-wrap > span:first-child').allInnerTexts()).slice(10, 20).sort(), Array.from({ length: 10 }, (_, i) => `레기온원${i + 11}`).sort())

  await page.screenshot({ path: join(out, 'pc-full.png'), fullPage: true })
  await context.close()
}

// ---------- 15. 대기 인원의 카드 ----------
{
  const me = sched(NICK, 0, { 수: ['21:00'] }, { id: 'mine', slotSignedAt: { '수|21:00': '2026-12-23T20:00:00+09:00' } })
  // 나보다 먼저 20명(1공대 + 2공대)이 신청했다.
  const others = Array.from({ length: 20 }, (_, i) => sched(`선착${i + 1}`, i, { 수: ['21:00'] }, { slotSignedAt: { '수|21:00': `2026-12-23T10:${String(i).padStart(2, '0')}:00+09:00` } }))
  const { page, context } = await open(LOCAL, { schedules: [me, ...others] })
  await login(page)
  check('#15 내가 대기면 대기 번호 표시', (await page.locator('.next-raid-card small').first().innerText()).includes('대기 1번'))
  await context.close()

  // 11번째로 신청했으면 2공대: 카드에 2공대 · A/B 파티를 함께 보여 주고, 준비 확인은 2공대 인원만 센다.
  const second = await open(LOCAL, { schedules: [me, ...others.slice(0, 10)] })
  await login(second.page)
  const secondSmall = await second.page.locator('.next-raid-card small').first().innerText()
  check('#15 2공대면 카드에 2공대 표시', /2공대 [AB]파티/.test(secondSmall))
  check('#15 2공대 인원 표기', secondSmall.includes('11/20'))
  // 요일별 현황: 1공대 줄은 내가 다룰 수 없어 숨기고, 내 공대(2공대) 줄에만 준비 확인 버튼
  const row = second.page.locator('[id="day-raid-row-수-무스펠 / 보통 / 트라이-21:00"]')
  check('#15 요일별 현황: 내 공대 줄만', [await row.locator('.day-raid-party-tag').allInnerTexts(), await row.locator('.day-raid-party-tag.is-mine').count()], [['2공대'], 1])
  check('#15 요일별 현황: 시간 줄에 내 공대', await row.locator('.my-slot-badge').innerText(), '내 시간 · 2공대')
  await second.page.locator('.next-raid-card .day-raid-rally-button').click()
  check('#15 2공대 준비 확인 팝업에 2공대', (await second.page.locator('.save-confirm-modal .save-confirm-nickname').innerText()).includes('2공대'))
  await second.page.locator('.save-confirm-modal .primary-button').click()
  await second.page.locator('.next-raid-status').waitFor()
  check('#15 2공대 준비는 2공대 인원만 (나 혼자라 바로 출발)', await second.page.locator('.next-raid-status').innerText(), '전원 준비 1/1')
  const firstPartyRun = await second.page.evaluate(() => JSON.parse(localStorage.getItem('raid-calendar-raid-runs-v1')).map((run) => [run.party, run.rallyCheckins]))
  check('#15 2공대 기록은 따로 저장', firstPartyRun, [[2, [NICK]]])
  check('#15 접힌 줄 진행 표시 대신 내 공대 줄', await row.locator('.day-raid-run-label').first().innerText(), '전원 준비 1/1')
  await row.locator('.day-raid-time-toggle').click()
  await row.screenshot({ path: join(out, 'pc-two-party-row.png') })
  await second.context.close()
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

  // 터치: 같은 시간 다른 레이드도 고를 수 있고, 점과 설명으로 알려 준다.
  await pickTarget(page, '비탄의 설원', '보통', '트라이')
  await page.locator('.form-panel .mobile-day-tab', { hasText: '토' }).tap()
  const sameTime = page.locator('[aria-label="토요일 21:00"]')
  await sameTime.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  check('모바일: 같은 시간 다른 레이드 표시', [await page.locator('.mobile-time-button.has-other-raid').count(), await page.locator('.mobile-other-raid-hint').count()], [1, 1])
  await sameTime.tap({ force: true })
  check('모바일: 같은 시간 다른 레이드도 고를 수 있음', await sameTime.getAttribute('aria-pressed'), 'true')
  await page.screenshot({ path: join(out, 'm-same-time.png') })
  await sameTime.tap({ force: true })
  check('모바일: 다시 누르면 빠짐', await sameTime.getAttribute('aria-pressed'), 'false')

  // 내 신청 목록은 보기 전용: 스크롤하다 잘못 눌러 지워지지 않는다.
  check('모바일: 목록의 시간은 버튼이 아님', [await page.locator('.saved-slot-chip').count(), await page.locator('.saved-slot-day-label').count()], [0, 0])
  check('모바일: 목록에 시간 표시', (await page.locator('.saved-slot-tag').allInnerTexts()).includes('21:00'))
  const savedBefore = await page.evaluate(() => JSON.parse(localStorage.getItem('raid-calendar-raid-schedules-v1')).find((e) => e.nickname === '테스트본캐').dayTimeSelection)
  await page.locator('.saved-slot-tag').first().tap()
  await page.locator('.saved-slot-day-tag').first().tap()
  check('모바일: 목록을 눌러도 안 지워짐', await page.evaluate(() => JSON.parse(localStorage.getItem('raid-calendar-raid-schedules-v1')).find((e) => e.nickname === '테스트본캐').dayTimeSelection), savedBefore)
  check('모바일: 목록 안내 문구', (await page.locator('.saved-schedule-hint').innerText()).includes('수정'))

  // 수정을 누르면 그 신청의 요일과 시간 버튼으로 간다.
  await page.locator('.mobile-day-tabs[data-section="form"] .mobile-day-tab', { hasText: '월' }).tap()
  await page.locator('.saved-schedule-edit').first().tap()
  check('모바일: 수정을 누르면 그 레이드로', (await page.locator('.target-summary strong').count()) + (await page.locator('[aria-label="레이드"] .chip.active').count()) >= 1)
  check('모바일: 수정을 누르면 신청이 있는 요일로', await page.locator('.mobile-day-tabs[data-section="form"] .mobile-day-tab.active span').first().innerText(), '금')
  await page.waitForTimeout(600)
  const pickerBox = await page.locator('#schedule-day-field').boundingBox()
  check('모바일: 수정을 누르면 시간 고르는 곳이 화면에 보임', pickerBox.y >= 0 && pickerBox.y < 300)
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
  // 전투력은 직접 입력한다. 범위 밖이면 안내, 1000 이상은 숫자 뒤에 M을 붙인다.
  await page.fill('#power', '12')
  await page.locator('#power').blur()
  check('모바일: 전투력 범위 밖이면 안내', await page.locator('.field-error').count(), 1)
  check('모바일: 잘못 쓴 전투력은 지우지 않음', await page.inputValue('#power'), '12')
  await page.fill('#power', '1,250')
  await page.locator('#power').blur()
  check('모바일: 1000 이상은 숫자 그대로 M을 붙임', [await page.inputValue('#power'), await page.locator('.field-error').count()], ['1250M', 0])
  await page.fill('#power', '1200')
  await page.locator('#power').blur()
  check('모바일: 끝자리 0도 그대로', await page.inputValue('#power'), '1200M')
  await page.fill('#power', '750')
  await page.locator('#power').blur()
  check('모바일: 1000k 미만은 k로', await page.inputValue('#power'), '750k')
  await page.locator('[aria-label="리딩 여부"] button').first().tap()
  check('모바일: 1단계 완료 표시', await page.locator('.form-step-number').first().innerText(), '✓')
  // 무스펠 · 비탄의 설원 · 에라쿠스 유적 + 오픈 예정 2개
  check('모바일: 레이드를 다 고르기 전에는 펼침', await page.locator('[aria-label="레이드"] button').count(), 5)
  const beforeCollapse = await page.locator('.mobile-time-list').evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
  await pickTarget(page)
  check('모바일: 2단계 완료 표시', await page.locator('.form-step-number').nth(1).innerText(), '✓')
  check('모바일: 다 고르면 한 줄로 접힘', await page.locator('.target-summary strong').innerText(), '무스펠 · 보통 · 트라이')
  const afterCollapse = await page.locator('.mobile-time-list').evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
  console.log(`INFO 모바일 2단계 접기로 시간 버튼 이동 ${Math.round(beforeCollapse - afterCollapse)}px`)
  check('모바일: 접으면 시간 버튼이 위로', afterCollapse < beforeCollapse - 80)
  await page.locator('.target-summary button').tap()
  check('모바일: 변경을 누르면 펼침', await page.locator('[aria-label="난이도"] button').count(), 2)
  await page.locator('[aria-label="공략 방식"] button', { hasText: '반숙이상' }).tap()
  check('모바일: 고치는 중에는 접히지 않음', await page.locator('[aria-label="공략 방식"] button').count(), 2)
  await page.locator('[aria-label="공략 방식"] button', { hasText: '트라이' }).tap()
  await page.locator('#schedule-target-field .character-collapse-button').tap()
  check('모바일: 한 줄로 접기', await page.locator('.target-summary').count(), 1)

  // 시간 고르기
  check('모바일: 그 시간 신청 인원 표시', await page.locator('[aria-label="금요일 21:00"] small').innerText(), '22명 신청')
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
  await page.selectOption('.mobile-raid-select select >> nth=0', 'upcoming:rudra-challenge')
  check('모바일: 오픈 예정 레이드는 팝업만 띄우고 선택 유지', [
    await page.locator('.upcoming-raid-modal p').innerText(),
    await page.locator('.mobile-raid-select select >> nth=0').inputValue(),
  ], ['12/2일 오픈 예정입니다.', '비탄의 설원 보통'])
  await page.locator('.upcoming-raid-modal button', { hasText: '확인' }).tap()
  check('모바일: 확인을 누르면 팝업 닫힘', await page.locator('.upcoming-raid-modal').count(), 0)

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

// ---------- 모바일 로그인 화면 ----------
{
  const { page, context } = await open(LOCAL, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  check('로그인: 비밀번호 저장 권장', (await page.locator('.remember-hint').innerText()).includes('비밀번호 저장'))
  check('로그인: 기본은 꺼짐', await page.locator('#savePassword').isChecked(), false)
  await page.locator('#savePassword').check()
  check('로그인: 켜면 주의 문구로', (await page.locator('.remember-hint').innerText()).includes('개인 기기'))
  const subtitle = await page.locator('.login-subtitle').boundingBox()
  check('로그인: 설명이 두 줄 이하', subtitle.height <= 56)
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
  check('홈 화면 이름', manifest.name, '그루 성역스케줄')
  check('홈 화면 아이콘 파일', manifest.icons, [true, true])
  await context.close()
}

// ---------- 횟수 제한 레이드 (에라쿠스 유적 주 5회) ----------
{
  // 클리어 O 3번(1단계 2번 · 2단계 1번) + 클리어 X 1번(세지 않음) → 남은 2/5
  const erakus = (difficulty, sel, id) => sched(NICK, 0, sel, { id, raidName: '에라쿠스 유적', difficulty })
  // 클리어 명단(clearLog)을 남겨 둔다. 0/5가 되어 신청이 빠져도 차감한 횟수는 그대로여야 한다.
  const run = (difficulty, day, time, cleared) => ({
    weekStart: '2026-12-23', day, time, raidName: '에라쿠스 유적', difficulty, mode: '트라이', gatheredAt: THIS_WEEK, cleared,
    clearLog: cleared === 'O' ? [{ at: THIS_WEEK, by: NICK, members: [NICK] }] : [],
  })
  const runs = [
    run('1단계', '수', '19:00', 'O'),
    run('1단계', '목', '19:00', 'O'),
    run('2단계', '목', '21:00', 'O'),
    run('1단계', '금', '19:00', 'X'),
  ]
  const { page, context } = await open(LOCAL, {
    schedules: [
      erakus('1단계', { 수: ['19:00'], 목: ['19:00'], 금: ['19:00'] }, 'e1'),
      erakus('2단계', { 목: ['21:00'] }, 'e2'),
    ],
    extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify(runs) },
  })
  await login(page)
  await pickTarget(page, '에라쿠스 유적', '1단계', '트라이')
  const panelText = () => page.locator('.entries-left-panel').innerText()
  check('횟수: 클리어 O만 1~3단계 합산', [(await panelText()).includes('2/5'), (await panelText()).includes('클리어 차감 3회')], [true, true])
  check('횟수: 레이드별 인원에도 남은 횟수', await page.locator('.member-day-summary:not(.clear-summary) .member-tag .entries-left-badge').allInnerTexts(), ['2/5', '2/5'])
  await page.locator('.day-raid-time-toggle').first().click()
  check('횟수: 펼친 파티 명단에도 남은 횟수', await page.locator('.day-raid-member .entries-left-badge').first().innerText(), '2/5')
  check('횟수: 파티 보기에도 남은 횟수', (await page.locator('.time-member-pill > .entries-left-badge').allInnerTexts()).includes('2/5'))

  // 버튼은 남은 횟수 기준: −1은 남은 횟수를 줄이고, +1은 되돌린다.
  await page.locator('.entries-adjust button', { hasText: '−1' }).click()
  // 0회가 되면 아직 시작하지 않은 신청(1단계 목 · 금 19:00, 2단계 목 21:00)이 빠지므로 한 번 확인한다. (지금: 수 20:30)
  let dropConfirm = ''
  page.once('dialog', (dialog) => {
    dropConfirm = dialog.message()
    dialog.accept()
  })
  await page.locator('.entries-adjust button', { hasText: '−1' }).click()
  check('횟수: 0이 되기 전에 신청이 빠진다고 확인', dropConfirm.includes('신청 3개가 일정표에서 자동으로 빠져요'))
  check('횟수: −1 두 번이면 0/5', [(await panelText()).includes('0/5'), (await panelText()).includes('직접 차감 2회')], [true, true])
  check('횟수: 0이면 −1 막힘', await page.locator('.entries-adjust button', { hasText: '−1' }).isDisabled(), true)
  const savedErakus = await page.evaluate(() => JSON.parse(localStorage.getItem('raid-calendar-raid-schedules-v1') ?? '[]')
    .filter((entry) => entry.raidName === '에라쿠스 유적')
    .map((entry) => [entry.difficulty, entry.dayTimeSelection]))
  check('횟수: 0/5면 이미 시작한 시간만 남기고 신청을 뺌', savedErakus, [['1단계', { 수: ['19:00'], 목: [], 금: [], 토: [], 일: [], 월: [], 화: [] }]])
  await page.locator('#schedule-target-field').screenshot({ path: join(out, 'pc-erakus-entries.png') })
  check('횟수: 신청 목록에 소진 표시', await page.locator('.saved-schedule-tag.tag-exhausted').count(), 1)
  const cell = page.locator('[aria-label="토요일 21:00"]')
  await cell.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await cell.click({ force: true })
  check('횟수: 다 쓰면 새 시간 막힘', [await cell.getAttribute('aria-pressed'), (await toastText(page)).includes('횟수(5회)를 다 써서')], ['false', true])
  check('횟수: 다 쓰면 바로 신청 버튼 숨김', await page.locator('.join-slot-button').count(), 0)

  await page.locator('.entries-adjust button', { hasText: '+1' }).click()
  check('횟수: +1이면 1/5로 복구', (await panelText()).includes('1/5'))
  await cell.click({ force: true })
  check('횟수: 남으면 다시 고를 수 있음', await cell.getAttribute('aria-pressed'), 'true')

  await page.reload()
  await login(page)
  await pickTarget(page, '에라쿠스 유적', '1단계', '트라이')
  check('횟수: 조정은 새로고침해도 유지', (await panelText()).includes('1/5'))

  await pickTarget(page, '무스펠', '보통', '트라이')
  check('횟수: 성역 레이드는 남은 횟수 칸 없음', await page.locator('.entries-left-panel').count(), 0)
  await context.close()
}

// ---------- 직접 배치: 리딩 가능자가 끌어서(모바일은 눌러서) 공대 · A/B · 대기를 옮긴다 ----------
{
  // 토 21:00에 12명: 나(리딩 가능)가 가장 먼저. 1공대는 나 + 배치원2~10, 2공대는 배치원11 · 12
  const crew = [
    sched(NICK, 0, { 토: ['21:00'] }, { id: 'mine', leadReady: 'O', slotSignedAt: { '토|21:00': '2026-12-23T09:00:00+09:00' } }),
    ...Array.from({ length: 11 }, (_, i) => sched(`배치원${i + 2}`, i + 1, { 토: ['21:00'] }, { id: `b${i}`, leadReady: 'X', slotSignedAt: { '토|21:00': `2026-12-23T10:${String(i).padStart(2, '0')}:00+09:00` } })),
  ]
  const others = Array.from({ length: 3 }, (_, i) => sched(`남의칸${i + 1}`, i, { 일: ['21:00'] }, { id: `o${i}`, leadReady: 'O' }))
  const { page, context } = await open(LOCAL, { schedules: [...crew, ...others] })
  await login(page)
  const slot = page.locator('[id="calendar-slot-토-21:00"]')
  const blockNames = (index) => slot.locator('.party-block').nth(index).locator('.member-name-wrap > span:first-child').allInnerTexts().then((list) => list.sort())
  const pill = (name) => slot.locator('.time-member-pill', { hasText: name })

  // 이번 주 화면: 내가 리딩 가능으로 신청한 시간대 카드 오른쪽 위에 '배치'
  const weekRow = page.locator('[id="day-raid-row-토-무스펠 / 보통 / 트라이-21:00"]')
  const weekButton = weekRow.locator('.day-raid-arrange-button')
  check('직접 배치: 이번 주 카드에 배치 버튼 (남의 칸에는 없음)', [await weekButton.count(), await page.locator('[id="day-raid-row-일-무스펠 / 보통 / 트라이-21:00"] .day-raid-arrange-button').count()], [1, 0])
  const [headBox, buttonBox] = [await weekRow.locator('.day-raid-time-head').boundingBox(), await weekButton.boundingBox()]
  check('직접 배치: 배치 버튼은 카드 오른쪽 위', [Math.abs(headBox.x + headBox.width - (buttonBox.x + buttonBox.width)) <= 2, Math.abs(headBox.y - buttonBox.y) <= 2], [true, true])
  await weekButton.click()
  check('직접 배치: 누르면 아래 파티 표 그 칸에서 바로 배치 바꾸기', [
    await page.locator('.pc-tab.active').innerText(),
    await slot.evaluate((el) => el.classList.contains('is-arranging')),
    await slot.locator('.party-waiting.is-drop-target').count(),
  ], ['이번 주', true, 1])
  check('직접 배치: 파티 칸에도 배치 버튼 (남의 칸에는 없음)', await page.locator('[id="calendar-slot-일-21:00"] .slot-arrange-button').count(), 0)

  // 끌어서 다른 사람 위에 놓으면 서로 자리가 바뀐다.
  await pill('배치원11').dragTo(pill('배치원2'))
  await page.waitForFunction(() => [...document.querySelectorAll('[id="calendar-slot-토-21:00"] .party-block')][0]?.innerText.includes('배치원11'))
  check('직접 배치: 끌어서 놓으면 서로 자리 바꿈', [(await blockNames(0)).includes('배치원11'), (await blockNames(1)).includes('배치원2')], [true, true])
  // 꽉 찬 파티 열에 놓으면 안내만 한다.
  await pill('배치원12').dragTo(slot.locator('.party-block').nth(0).locator('.party-column').nth(0).locator('.party-label'))
  check('직접 배치: 꽉 찬 자리는 안내', (await toastText(page)).includes('꽉 찼어요'))
  // 눌러서 고른 뒤 대기를 누르면 대기로 간다.
  await pill('배치원12').click()
  check('직접 배치: 누르면 고른 표시', await pill('배치원12').getAttribute('aria-pressed'), 'true')
  await slot.locator('.party-waiting.is-drop-target').click()
  await page.waitForFunction(() => document.querySelector('[id="calendar-slot-토-21:00"] .party-waiting')?.innerText.includes('배치원12'))
  check('직접 배치: 고른 뒤 대기를 누르면 대기로', [(await blockNames(1)).includes('배치원12'), await slot.locator('.party-waiting').innerText().then((t) => t.includes('배치원12'))], [false, true])
  await slot.locator('.slot-arrange-button', { hasText: '완료' }).click()
  check('직접 배치: 완료하면 직접 배치 표시', [await slot.locator('.slot-manual-badge').innerText(), await slot.locator('.party-waiting').innerText()], ['직접 배치', '대기 1명: 배치원12'])
  check('직접 배치: 대기로 옮긴 사람은 인원 표기에서 +로', await slot.locator('.slot-count').innerText(), '11/20 +1')
  await slot.screenshot({ path: join(out, 'pc-arranged-slot.png') })

  // 새로고침해도 유지되고, 이번 주 화면 · 준비 확인 인원도 같은 배치를 따른다.
  await page.reload()
  await login(page)
  await pcTab(page, '파티')
  check('직접 배치: 새로고침해도 유지', [(await blockNames(0)).includes('배치원11'), (await blockNames(1)).sort(), await slot.locator('.party-waiting').innerText()], [true, ['배치원2'], '대기 1명: 배치원12'])
  await pcTab(page, '이번 주')
  const row = page.locator('[id="day-raid-row-토-무스펠 / 보통 / 트라이-21:00"]')
  await row.locator('.day-raid-time-toggle').click()
  check('직접 배치: 이번 주 화면도 같은 배치', await row.locator('.day-raid-overflow-label').allInnerTexts(), ['1공대 (10/10)', '2공대 (1/10)', '대기 (신청 순)'])

  // 자동 배치로 돌리면 신청순
  await pcTab(page, '파티')
  await slot.locator('.slot-arrange-button').click()
  await slot.locator('.slot-arrange-button', { hasText: '자동 배치로' }).click()
  await slot.locator('.slot-arrange-button', { hasText: '완료' }).click()
  await page.waitForFunction(() => !document.querySelector('[id="calendar-slot-토-21:00"] .party-waiting'))
  check('직접 배치: 자동 배치로 돌리면 신청순', [(await blockNames(1)).sort(), await slot.locator('.slot-manual-badge').count()], [['배치원11', '배치원12'], 0])
  await context.close()
}

// ---------- 모바일 직접 배치: 이번 주 카드 안에서 바로 눌러서 옮긴다 ----------
{
  const crew = [
    sched(NICK, 0, { 토: ['21:00'] }, { id: 'mine', leadReady: 'O', slotSignedAt: { '토|21:00': '2026-12-23T09:00:00+09:00' } }),
    ...Array.from({ length: 11 }, (_, i) => sched(`배치원${i + 2}`, i + 1, { 토: ['21:00'] }, { id: `b${i}`, leadReady: 'X', slotSignedAt: { '토|21:00': `2026-12-23T10:${String(i).padStart(2, '0')}:00+09:00` } })),
  ]
  const { page, context } = await open(LOCAL, { schedules: crew, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await login(page)
  await page.locator('.mobile-tab', { hasText: '이번 주' }).tap()
  await page.locator('.day-raid-summary-panel .mobile-day-tab', { hasText: '토' }).first().tap()
  const row = page.locator('[id="day-raid-row-토-무스펠 / 보통 / 트라이-21:00"]')
  await row.locator('.day-raid-arrange-button').tap()
  check('모바일 배치: 탭을 바꾸지 않고 카드 안에 보드', [
    await page.locator('.mobile-tab.active span').innerText(),
    await row.locator('.day-raid-arrange-board .party-block-label').allInnerTexts(),
    await row.locator('.day-raid-arrange-board .party-column').count(),
  ], ['이번 주', ['1공대', '2공대'], 4])
  check('모바일 배치: 카드 안에서는 이름이 잘리지 않음', await row.locator('.day-raid-arrange-board .member-name-wrap > span:first-child').evaluateAll((names) => names.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.innerText)), [])
  const boardPill = (name) => row.locator('.day-raid-arrange-board .time-member-pill', { hasText: name })
  await boardPill('배치원12').tap()
  check('모바일 배치: 고르면 놓을 곳 강조', [await boardPill('배치원12').getAttribute('aria-pressed'), await row.locator('.is-drop-target.is-ready').count()], ['true', 5])
  await row.locator('.day-raid-arrange-board .party-waiting.is-drop-target').tap()
  await page.waitForFunction(() => document.querySelector('[id="day-raid-row-토-무스펠 / 보통 / 트라이-21:00"] .party-waiting')?.innerText.includes('배치원12'))
  check('모바일 배치: 대기 칸 이름표와 사람이 줄을 나눔', (await row.locator('.day-raid-arrange-board .party-waiting').innerText()).split('\n')[0], '대기')
  const bar = await row.locator('.slot-arrange-bar').boundingBox()
  const tabbar = await page.locator('.mobile-tabbar').boundingBox()
  check('모바일 배치: 완료 버튼 줄은 하단 탭 위에 보임', bar.y + bar.height <= tabbar.y + 1 && bar.y >= 0)
  await page.screenshot({ path: join(out, 'm-arrange-in-card.png') })
  await row.locator('.slot-arrange-button', { hasText: '완료' }).tap()
  check('모바일 배치: 완료하면 보드를 닫고 배치는 유지', [await row.locator('.day-raid-arrange-board').count(), await row.locator('.day-raid-time-count').innerText()], [0, '11/20 +1'])
  await context.close()
}

// ---------- 파티 안 순서: 다른 직업 → 호법성(4번째) → 치유성(5번째) ----------
{
  const order = ['치유성', '호법성', '검성', '수호성', '궁성', '치유성', '호법성', '살성', '마도성', '정령성']
  const team = order.map((className, i) => sched(`순서${i + 1}`, i, { 금: ['22:00'] }, { id: `q${i}`, className, leadReady: i === 0 ? 'O' : 'X' }))
  const { page, context } = await open(LOCAL, { schedules: team })
  await login(page)
  await pcTab(page, '파티')
  const columns = await page.locator('[id="calendar-slot-금-22:00"] .party-column').evaluateAll((cols) => cols.map((col) => [...col.querySelectorAll('img.nickname-icon')].map((img) => img.alt)))
  check('파티 순서: 두 파티 모두 5명', columns.map((col) => col.length), [5, 5])
  check('파티 순서: 호법성 4번째 · 치유성 5번째 (리딩 가능한 치유성도 맨 뒤)', columns.map((col) => [col[3], col[4]]), [['호법성', '치유성'], ['호법성', '치유성']])
  await context.close()

  // 전투력만 보면 호법성 둘이 한 파티로 가는 게 가장 고르지만(1800 : 1800), 호법성을 먼저 양쪽에 나눈다.
  const supports = [['호법A', '호법성', '900'], ['호법B', '호법성', '900'], ['검성원', '검성', '100'], ['궁성원', '궁성', '1700']]
    .map(([name, className, power], i) => sched(name, i, { 금: ['23:00'] }, { id: `s${i}`, className, power, leadReady: 'X' }))
  const split = await open(LOCAL, { schedules: supports })
  await login(split.page)
  await pcTab(split.page, '파티')
  check('파티 나누기: 호법성도 양쪽에 하나씩', await split.page.locator('[id="calendar-slot-금-23:00"] .party-column').evaluateAll((cols) => cols.map((col) => col.querySelectorAll('img.nickname-icon[alt="호법성"]').length)), [1, 1])
  await split.context.close()
}

// ---------- 초월(에라쿠스 유적)은 5인 1파티 ----------
{
  // 토 21:00에 12명: 앞의 5명이 1파티, 그다음 5명이 2파티, 2명은 대기
  const party = Array.from({ length: 12 }, (_, i) => sched(`초월원${i + 1}`, i, { 토: ['21:00'] }, {
    id: `p${i}`,
    raidName: '에라쿠스 유적',
    difficulty: '1단계',
    slotSignedAt: { '토|21:00': `2026-12-23T10:${String(i).padStart(2, '0')}:00+09:00` },
  }))
  const { page, context } = await open(LOCAL, { schedules: party })
  await login(page)
  await pickTarget(page, '에라쿠스 유적', '1단계', '트라이')
  const slot = page.locator('[id="calendar-slot-토-21:00"]')
  check('초월: 캘린더 칸 인원은 5명 × 2파티 기준', await slot.locator('.slot-count').innerText(), '10/10 +2')
  check('초월: 파티마다 A/B 없이 한 줄 (열 이름 대신 1파티 · 2파티 이름표)', [await slot.locator('.party-column').count(), await slot.locator('.party-label').count()], [2, 0])
  check('초월: 6번째부터 2파티', [
    await slot.locator('.party-block-label').allInnerTexts(),
    (await slot.locator('.party-block').nth(1).locator('.member-name-wrap > span:first-child').allInnerTexts()).sort(),
  ], [['1파티', '2파티'], ['초월원10', '초월원6', '초월원7', '초월원8', '초월원9']])
  check('초월: 11번째부터 대기', await slot.locator('.party-waiting').innerText(), '대기 2명: 초월원11, 초월원12')
  check('초월: 요일별 현황도 5명 × 2파티', (await page.locator('.day-raid-time-count').allInnerTexts()).includes('10/10 +2'))
  check('초월: 추천 시간도 5명이면 출발 가능', (await page.locator('.recommend-status').allInnerTexts()).includes('출발 가능'))
  await pcTab(page, '파티')
  await slot.scrollIntoViewIfNeeded()
  await slot.screenshot({ path: join(out, 'pc-erakus-party.png') })
  await context.close()
}

// ---------- 에라쿠스: 한 번 출발해 여러 번 클리어 + 이번 주 클리어 목록 ----------
for (const device of ['pc', 'mobile']) {
  const isPhone = device === 'mobile'
  const crew = [NICK, '원정2', '원정3', '원정4', '원정5']
  const schedules = [
    ...crew.map((name, i) => sched(name, i, { 수: ['20:00'] }, { id: `c${i}`, raidName: '에라쿠스 유적', difficulty: '1단계', slotSignedAt: { '수|20:00': `2026-12-23T10:0${i}:00+09:00` } })),
    ...['무스A', '무스B'].map((name, i) => sched(name, i, { 수: ['19:00'] }, { id: `mm${i}` })),
  ]
  const base = { weekStart: '2026-12-23', mode: '트라이', rallyCalledBy: NICK, rallyCalledAt: THIS_WEEK, gatheredAt: THIS_WEEK, clearedBy: null }
  const runs = [
    // 원정5는 준비하지 않은 채 시작했다.
    { ...base, day: '수', time: '20:00', raidName: '에라쿠스 유적', difficulty: '1단계', rallyCheckins: crew.slice(0, 4), cleared: null },
    { ...base, day: '수', time: '19:00', raidName: '무스펠', difficulty: '보통', rallyCheckins: ['무스A'], cleared: 'O', clearLog: [{ at: THIS_WEEK, by: '무스A', members: ['무스A'] }] },
  ]
  // 원정2는 이미 3회를 써서 2/5
  const adjustments = [{ weekStart: '2026-12-23', nickname: '원정2', raidName: '에라쿠스 유적', adjustment: 3 }]
  const { page, context } = await open(LOCAL, {
    schedules,
    extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify(runs), 'raid-calendar-entry-adjustments-v1': JSON.stringify(adjustments) },
    ...(isPhone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : {}),
  })
  await login(page)
  const press = (locator) => (isPhone ? locator.tap() : locator.click())
  const row = page.locator('[id="day-raid-row-수-에라쿠스 유적 / 1단계 / 트라이-20:00"]')
  const add = row.locator('[aria-label="20:00 클리어 1회 추가"]')
  const entries = () => row.locator('.day-raid-clear-entry').evaluateAll((items) => Object.fromEntries(items.map((item) => [item.firstChild.textContent, item.querySelector('.entries-left-badge').innerText])))
  const label = () => row.locator('.day-raid-clear-count .day-raid-run-label').innerText()
  const waitLabel = (text) => page.waitForFunction((value) => document.querySelector('.day-raid-clear-count .day-raid-run-label')?.innerText === value, text)

  check(`${device} 클리어: 출발하면 0회와 사람별 남은 횟수`, [await label(), await entries()], ['클리어 0회', { [NICK]: '5/5', 원정2: '2/5', 원정3: '5/5', 원정4: '5/5', 원정5: '5/5' }])
  // 시작한 시간대 표시: 5명 중 4명만 출발
  check(`${device} 출발: 일부만 갔으면 전원 준비가 아니라 출발 4/5`, [await row.locator('.day-raid-rally .day-raid-run-label').innerText(), await page.locator('.next-raid-status').innerText()], ['출발 4/5', '출발 4/5'])
  // 내 다음 레이드 카드에서도 같은 클리어 버튼
  const cardAdd = page.locator('.next-raid-card [aria-label="내 다음 레이드 20:00 클리어 1회 추가"]')
  await press(cardAdd)
  await waitLabel('클리어 1회')
  check(`${device} 다음 레이드 카드: 클리어와 내 남은 횟수`, [await label(), (await page.locator('.next-raid-left').innerText()).replace(/\s+/g, ' ')], ['클리어 1회', '내 남은 횟수 4/5'])
  if (isPhone) {
    const box = await cardAdd.boundingBox()
    check('모바일 다음 레이드 카드: 큰 버튼이 첫 화면에', [box.height >= 48, box.width >= 120, box.y < 400], [true, true, true])
    const toastBox = await page.locator('.toast').last().boundingBox()
    check('모바일 알림: 한 줄 높이', toastBox.height <= 64)
    await page.screenshot({ path: join(out, 'mobile-clear-card.png') })
  } else {
    await page.screenshot({ path: join(out, 'pc-clear-card.png') })
  }
  await press(page.locator('.next-raid-card [aria-label="내 다음 레이드 20:00 클리어 1회 되돌리기"]'))
  await waitLabel('클리어 0회')

  // 출발 인원 고치기: 원정5를 넣었다가 뺀다.
  await press(row.locator('.day-raid-rally-button', { hasText: '출발 인원' }))
  check(`${device} 출발 인원: 준비한 사람이 골라져 있음`, await page.locator('.depart-option').evaluateAll((items) => items.map((item) => [item.querySelector('.depart-option-name').innerText, item.querySelector('input').checked])), [[NICK, true], ['원정2', true], ['원정3', true], ['원정4', true], ['원정5', false]])
  check(`${device} 출발 인원: 남은 횟수도 함께`, await page.locator('.depart-option .entries-left-badge').count(), 5)
  await page.locator('.save-confirm-modal').screenshot({ path: join(out, `${device}-depart.png`) })
  for (const name of [NICK, '원정2', '원정3', '원정4']) await press(page.locator('.depart-option', { hasText: name }))
  check(`${device} 출발 인원: 아무도 안 고르면 못 바꿈`, await page.locator('.save-confirm-modal .primary-button').isDisabled(), true)
  for (const name of [NICK, '원정2', '원정3', '원정4', '원정5']) await press(page.locator('.depart-option', { hasText: name }))
  await press(page.locator('.save-confirm-modal .primary-button'))
  check(`${device} 출발 인원: 모두 고르면 전원 준비 5/5`, await row.locator('.day-raid-rally .day-raid-run-label').innerText(), '전원 준비 5/5')
  await press(row.locator('.day-raid-rally-button', { hasText: '출발 인원' }))
  await press(page.locator('.depart-option', { hasText: '원정5' }))
  await press(page.locator('.save-confirm-modal .primary-button'))
  check(`${device} 출발 인원: 빼면 다시 출발 4/5`, await row.locator('.day-raid-rally .day-raid-run-label').innerText(), '출발 4/5')

  check(`${device} 클리어: 실패 X는 클리어가 없을 때만`, await row.locator('[aria-label="20:00 클리어 X"]').count(), 1)
  await press(add)
  await waitLabel('클리어 1회')
  check(`${device} 클리어: 누르면 출발한 사람만 1회 차감`, await entries(), { [NICK]: '4/5', 원정2: '1/5', 원정3: '4/5', 원정4: '4/5', 원정5: '5/5' })
  check(`${device} 클리어: 차감 안내`, [(await toastText(page)).includes('1회씩 차감'), (await toastText(page)).includes(`${NICK} 4/5`)], [true, !isPhone])
  check(`${device} 클리어: 차감된 사람 강조 · 출발 안 한 사람 흐리게`, [await row.locator('.day-raid-clear-entry.is-charged').count(), await row.locator('.day-raid-clear-entry.is-absent').count()], [4, 1])
  check(`${device} 클리어: 클리어가 있으면 X 숨김`, await row.locator('[aria-label="20:00 클리어 X"]').count(), 0)
  await press(page.locator('.toast-action', { hasText: '되돌리기' }))
  await waitLabel('클리어 0회')
  check(`${device} 클리어: 알림에서 되돌리면 횟수 복구`, (await entries())[NICK], '5/5')
  await press(add)
  await waitLabel('클리어 1회')

  // 원정2가 1/5 → 0/5가 되는 클리어는 디스코드 알림이 가므로 확인한다.
  await press(add)
  check(`${device} 클리어: 마지막 1회를 쓰면 확인 창`, [await page.locator('.save-confirm-modal h3').innerText(), (await page.locator('.save-confirm-modal p').innerText()).includes('원정2님이 이번 주 횟수를 모두')], ['클리어 1회를 추가할까요?', true])
  await press(page.locator('.save-confirm-modal .primary-button'))
  await waitLabel('클리어 2회')
  check(`${device} 클리어: 0/5`, [(await entries()).원정2, (await entries())[NICK]], ['0/5', '3/5'])
  await press(add)
  await waitLabel('클리어 3회')
  check(`${device} 클리어: 0회인 사람은 더 차감하지 않음`, [(await entries()).원정2, (await entries())[NICK]], ['0/5', '2/5'])
  check(`${device} 클리어: 카드 밖으로 넘치지 않음`, await row.evaluate((el) => {
    const card = el.closest('.day-raid-card').getBoundingClientRect()
    return [...el.querySelectorAll('.day-raid-clear-count, .day-raid-clear-entry')].every((item) => item.getBoundingClientRect().right <= card.right + 1)
  }))
  await page.locator('.day-raid-summary-panel').screenshot({ path: join(out, `${device}-clear-day.png`) })

  // 이번 주 클리어 목록
  if (isPhone) {
    await page.locator('.mobile-tab', { hasText: '인원' }).tap()
    check('모바일 인원 탭: 처음에는 신청 인원', [await page.locator('.clear-summary').count(), await page.locator('.member-day-summary:visible').count()], [0, 1])
    check('모바일 인원 탭: 클리어 건수', await page.locator('.members-view-tab', { hasText: '이번 주 클리어' }).locator('.members-view-count').innerText(), '2')
    await page.locator('.members-view-tab', { hasText: '이번 주 클리어' }).tap()
    check('모바일 인원 탭: 클리어만 보기', await page.locator('.member-day-summary:visible h3').allInnerTexts().then((list) => list.map((text) => text.split(/\s*\d/)[0].trim())), ['이번 주 클리어'])
  }
  if (!isPhone) {
    check('PC 탭: 클리어 건수', await page.locator('.pc-tab', { hasText: '클리어' }).locator('.members-view-count').innerText(), '2')
    await pcTab(page, '클리어')
    check('PC 탭: 클리어만 보임', await page.locator('.member-day-summary:visible').count(), 1)
  }
  const summary = page.locator('.clear-summary')
  check(`${device} 목록: 이번 주 기간 표시`, (await summary.locator('h3 small').innerText()), '12/23 ~ 12/29')
  check(`${device} 목록: 진행 현황 (적게 남은 사람부터)`, [
    (await summary.locator('.clear-progress-card .weekday-title').innerText()).includes('5회 완료 1명 · 진행 중 3명'),
    await summary.locator('.clear-progress-card .clear-person-name').allInnerTexts(),
    await summary.locator('.clear-progress-card .clear-done-badge').count(),
  ], [true, ['원정2', '원정3', '원정4', NICK], 1])
  check(`${device} 목록: 시간대별 클리어 (이른 시간부터)`, (await summary.locator('.clear-run-card .weekday-title small').allInnerTexts()), ['수요일 19:00 · 1명', '수요일 20:00 · 클리어 3회 · 4명'])
  check(`${device} 목록: 다른 레이드도 클리어한 사람만`, await summary.locator('.clear-run-card').first().locator('.clear-person-name').allInnerTexts(), ['무스A'])
  check(`${device} 목록: 사람별 이번 출발 횟수`, await summary.locator('.clear-run-card').nth(1).locator('.clear-person').allInnerTexts().then((list) => list.map((text) => text.replace(/\s+/g, ' ')).sort()), [`${NICK} ×3`, '원정2 ×2', '원정3 ×3', '원정4 ×3'].sort())
  await summary.screenshot({ path: join(out, `${device}-clear-summary.png`) })

  if (isPhone) {
    await page.locator('.mobile-tab', { hasText: '이번 주' }).tap()
    check('모바일 클리어: 버튼 높이 40px 이상', await row.locator('.day-raid-clear-count button').evaluateAll((items) => items.every((item) => item.getBoundingClientRect().height >= 40)))
    await page.screenshot({ path: join(out, 'mobile-clear-screen.png'), fullPage: true })
  }

  // 새로고침해도 기록이 남는다. 신청을 지워도 차감은 그대로다.
  await page.evaluate((nick) => {
    const key = 'raid-calendar-raid-schedules-v1'
    localStorage.setItem(key, JSON.stringify(JSON.parse(localStorage.getItem(key)).filter((entry) => entry.nickname !== nick)))
  }, '원정3')
  await page.reload()
  await login(page)
  if (isPhone) {
    await page.locator('.mobile-tab', { hasText: '인원' }).tap()
    await page.locator('.members-view-tab', { hasText: '이번 주 클리어' }).tap()
  } else {
    await pcTab(page, '클리어')
  }
  check(`${device} 목록: 신청을 지운 사람도 기록 유지`, (await page.locator('.clear-progress-card .clear-person', { hasText: '원정3' }).innerText()).includes('2/5'))
  await context.close()
}

// ---------- 이 인원으로 시작: 갈 사람 고르기 (대기자 대신 넣기) + 같은 시간 겹친 신청 정리 ----------
for (const device of ['pc', 'mobile']) {
  const isPhone = device === 'mobile'
  const erakus = [NICK, '출발2', '출발3', '출발4', '출발5', '대기6'].map((name, i) => sched(name, i, { 수: ['20:00'] }, { id: `d${i}`, raidName: '에라쿠스 유적', difficulty: '1단계', slotSignedAt: { '수|20:00': `2026-12-23T10:0${i}:00+09:00` } }))
  const other = sched(NICK, 0, { 수: ['20:00'], 토: ['21:00'] }, { id: 'other', difficulty: '어려움', mode: '반숙이상' })
  const run = { weekStart: '2026-12-23', day: '수', time: '20:00', raidName: '에라쿠스 유적', difficulty: '1단계', mode: '트라이', rallyCalledBy: NICK, rallyCalledAt: THIS_WEEK, rallyCheckins: [NICK, '출발2'], gatheredAt: null, cleared: null, clearedBy: null }
  const { page, context } = await open(LOCAL, {
    schedules: [...erakus, other],
    extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify([run]) },
    ...(isPhone ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } : {}),
  })
  await login(page)
  const press = (locator) => (isPhone ? locator.tap() : locator.click())
  const row = page.locator('[id="day-raid-row-수-에라쿠스 유적 / 1단계 / 트라이-20:00"]')
  check(`${device} 겹침 정리: 출발 전에는 묻지 않음`, await page.locator('.overlap-notice').count(), 0)
  await press(row.locator('.day-raid-rally-button', { hasText: '이 인원으로 시작' }))
  // 6번째(대기6)는 2파티다. 1파티 출발 인원으로 대신 고를 수 있다.
  check(`${device} 시작: 2파티 사람까지 고를 수 있고 준비한 사람이 골라져 있음`, [
    await page.locator('.depart-option').evaluateAll((items) => items.filter((item) => item.querySelector('input').checked).map((item) => item.querySelector('.depart-option-name').innerText)),
    await page.locator('.depart-option', { hasText: '대기6' }).locator('small').innerText(),
  ], [[NICK, '출발2'], '2파티'])
  for (const name of ['출발3', '출발4', '출발5', '대기6']) await press(page.locator('.depart-option', { hasText: name }))
  check(`${device} 시작: 정원보다 많으면 못 시작`, [await page.locator('.save-confirm-modal .primary-button').isDisabled(), (await page.locator('.depart-count').innerText()).includes('정원보다 많아요')], [true, true])
  await press(page.locator('.depart-option', { hasText: '출발5' }))
  await press(page.locator('.save-confirm-modal .primary-button'))
  await row.locator('.day-raid-clear-count').waitFor()
  check(`${device} 시작: 2파티 사람을 넣어 5명 출발`, await row.locator('.day-raid-rally .day-raid-run-label').first().innerText(), '출발 5/5')
  await press(row.locator('[aria-label="20:00 1파티 클리어 1회 추가"]'))
  await page.waitForFunction(() => document.querySelector('.day-raid-clear-count .day-raid-run-label')?.innerText === '클리어 1회')
  check(`${device} 시작: 고른 사람만 차감`, await row.locator('.day-raid-clear-entry').evaluateAll((items) => Object.fromEntries(items.map((item) => [item.firstChild.textContent, item.querySelector('.entries-left-badge').innerText]))), { [NICK]: '4/5', 출발2: '4/5', 출발3: '4/5', 출발4: '4/5', 출발5: '5/5', 대기6: '4/5' })

  // 같은 시간 무스펠 신청을 뺄지 묻는다.
  check(`${device} 겹침 정리: 출발하면 같은 시간 다른 신청을 물음`, (await page.locator('.overlap-notice p').innerText()).includes('무스펠 어려움 반숙이상'))
  check(`${device} 다음 레이드 카드: 같은 시간이면 출발한 레이드 먼저`, (await page.locator('.next-raid-card strong').first().innerText()).includes('에라쿠스 유적 1단계'))
  await page.locator('.overlap-notice').screenshot({ path: join(out, `${device}-overlap.png`) })
  const otherSlots = () => page.evaluate((nick) => JSON.parse(localStorage.getItem('raid-calendar-raid-schedules-v1')).find((e) => e.nickname === nick && e.raidName === '무스펠').dayTimeSelection, NICK)
  await press(page.locator('.overlap-notice button', { hasText: '신청 빼기' }))
  await page.waitForFunction(() => !document.querySelector('.overlap-notice'))
  check(`${device} 겹침 정리: 그 시간만 빠지고 다른 시간은 그대로`, await otherSlots().then((s) => [s['수'], s['토']]), [[], ['21:00']])
  await press(page.locator('.toast-action', { hasText: '되돌리기' }).last())
  await page.locator('.overlap-notice').waitFor()
  check(`${device} 겹침 정리: 되돌리기`, await otherSlots().then((s) => s['수']), ['20:00'])
  await press(page.locator('.overlap-notice button', { hasText: '그대로 두기' }))
  check(`${device} 겹침 정리: 그대로 두면 사라짐`, [await page.locator('.overlap-notice').count(), (await otherSlots())['수']], [0, ['20:00']])
  await page.reload()
  await login(page)
  check(`${device} 겹침 정리: 새로고침해도 다시 묻지 않음`, await page.locator('.overlap-notice').count(), 0)
  await context.close()
}

// ---------- PC 배치: 클리어 목록 위치, 빈 시간 줄, 요일 카드 폭 ----------
{
  const erakusRun = { weekStart: '2026-12-23', day: '수', time: '19:00', raidName: '무스펠', difficulty: '보통', mode: '트라이', rallyCalledBy: NICK, rallyCalledAt: THIS_WEEK, gatheredAt: THIS_WEEK, rallyCheckins: ['무스A'], cleared: 'O', clearedBy: '무스A', clearLog: [{ at: THIS_WEEK, by: '무스A', members: ['무스A'] }] }
  const lastWeekRun = { ...erakusRun, weekStart: '2026-12-16', clearLog: [{ at: THIS_WEEK, by: '지난주', members: ['지난주사람'] }] }
  const { page, context } = await open(LOCAL, { schedules: [...crowd, sched('무스A', 1, { 수: ['19:00'] }, { id: 'ma' })], extraStorage: { 'raid-calendar-raid-runs-v1': JSON.stringify([erakusRun, lastWeekRun]) } })
  await login(page)
  await pickTarget(page)
  await pcTab(page, '클리어')
  check('PC 배치: 클리어 목록은 이번 주만', await page.locator('.clear-summary .clear-person-name').allInnerTexts(), ['무스A'])
  await pcTab(page, '인원')
  check('PC 탭: 인원은 신청 인원만', await page.locator('.member-day-summary:visible h3').allInnerTexts(), ['레이드별 신청 인원'])
  await pcTab(page, '파티')
  const heights = await page.locator('[id="calendar-slot-토-22:00"], [id="calendar-slot-토-21:00"]').evaluateAll((cells) => Object.fromEntries(cells.map((cell) => [cell.id, Math.round(cell.getBoundingClientRect().height)])))
  check('PC 배치: 신청 없는 시간 줄은 얇게', heights['calendar-slot-토-22:00'] <= 40)
  check('PC 배치: 신청 있는 시간 줄은 그대로', heights['calendar-slot-토-21:00'] > 100)
  check('PC 배치: 낮시간 설정 버튼 크기', await page.locator('.slot-legend .small-toggle').evaluate((el) => el.getBoundingClientRect().width < 130 && el.getBoundingClientRect().height < 40))
  await pcTab(page, '이번 주')
  check('PC 배치: 급하지 않으면 위쪽은 한 줄', [await page.locator('.summary-strip').count(), await page.locator('.next-raid-card').count(), await page.locator('.summary-strip').evaluate((el) => el.getBoundingClientRect().height <= 52)], [1, 0, true])
  const widths = await page.locator('.day-raid-card').evaluateAll((cards) => cards.map((card) => [card.querySelector('.day-raid-header').innerText.slice(0, 1), Math.round(card.getBoundingClientRect().width), Math.round(card.getBoundingClientRect().top)]))
  const widthOf = (day) => widths.find(([name]) => name === day)[1]
  check('PC 배치: 신청 있는 요일이 더 넓음', widthOf('금') > widthOf('토') + 40)
  check('PC 배치: 요일 카드는 한 줄', new Set(widths.map(([, , y]) => y)).size, 1)
  await page.locator('[id="day-raid-row-금-무스펠 / 보통 / 트라이-21:00"] .day-raid-time-toggle').click()
  check('PC 배치: 요일 카드 안의 인원 수 · 닉네임이 넘치지 않음', await page.locator('.day-raid-card').evaluateAll((cards) => cards.flatMap((card) => {
    const right = card.getBoundingClientRect().right
    return [...card.querySelectorAll('.day-raid-time-tag, .day-raid-member')].filter((el) => el.getBoundingClientRect().right > right).map((el) => el.innerText)
  })), [])
  check('PC 배치: 상단 닉네임이 잘리지 않음', await page.locator('.user-badge-name').evaluate((el) => el.scrollWidth <= el.clientWidth))
  await page.screenshot({ path: join(out, 'pc-layout.png'), fullPage: true })
  await context.close()

  // 모든 요일에 신청이 있어도 한 줄에 들어가고 넘치지 않는다.
  const full = await open(LOCAL, { schedules: Array.from({ length: 12 }, (_, i) => sched(i === 0 ? '일곱글자닉네임' : `꽉찬${i}`, i, { 수: ['22:00'], 목: ['21:00'], 금: ['21:00'], 토: ['21:00'], 일: ['21:00'], 월: ['21:00'], 화: ['21:00'] }, { id: `f${i}` })) })
  await login(full.page)
  const cards = await full.page.locator('.day-raid-card').evaluateAll((list) => list.map((card) => ({
    top: Math.round(card.getBoundingClientRect().top),
    over: [...card.querySelectorAll('.day-raid-time-tag, .join-slot-button, .day-raid-icon-stack')].some((el) => el.getBoundingClientRect().right > card.getBoundingClientRect().right),
  })))
  check('PC 배치: 참여 버튼이 시간 · 아이콘과 겹치지 않음', await full.page.locator('.day-raid-time-head').evaluateAll((heads) => heads.filter((head) => {
    const button = head.querySelector('.join-slot-button')?.getBoundingClientRect()
    return button && [...head.querySelectorAll('.day-raid-time-tag, .slot-warn, .my-slot-badge, .day-raid-icon-stack, .day-raid-toggle-arrow')].some((el) => {
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.right > button.left + 1 && rect.left < button.right && rect.bottom > button.top + 1 && rect.top < button.bottom - 1
    })
  }).length), 0)
  check('PC 배치: 모든 요일에 신청이 있어도 한 줄 · 넘침 없음', [new Set(cards.map((card) => card.top)).size, cards.some((card) => card.over)], [1, false])
  await full.page.locator('.day-raid-summary-panel').screenshot({ path: join(out, 'pc-layout-full-week.png') })
  await full.context.close()
}

// ---------- 모바일 배치: 신청 한 줄 요약, 파티 탭 빈 시간 접기 ----------
{
  const mine = sched(NICK, 0, { 금: ['21:00'] }, { id: 'mine', power: '700~800k' })
  const { page, context } = await open(LOCAL, { schedules: [...crowd, mine], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  await login(page)
  await page.locator('.mobile-tab', { hasText: '신청' }).tap()
  check('모바일 배치: 신청 화면은 리셋 · 다음 레이드 한 줄', [await page.locator('.summary-strip').count(), await page.locator('.next-raid-card').count()], [1, 0])
  check('모바일 배치: 한 줄 내용', [(await page.locator('.summary-strip-item').innerText()).includes('6일 3시간 후'), (await page.locator('.summary-strip-next').innerText()).includes('금 21:00 무스펠 보통')], [true, true])
  const firstTime = await page.locator('.mobile-time-button').first().boundingBox()
  const tabbar = await page.locator('.mobile-tabbar').boundingBox()
  check('모바일 배치: 시간 버튼이 첫 화면에', firstTime.y + firstTime.height <= tabbar.y)
  console.log(`INFO 모바일 첫 시간 버튼 y=${Math.round(firstTime.y)} (수정 전 862), 하단 탭 y=${Math.round(tabbar.y)}`)
  await page.screenshot({ path: join(out, 'm-form-compact.png') })
  await page.locator('.summary-strip-next').tap()
  check('모바일 배치: 다음 레이드를 누르면 이번 주 화면으로', [await page.locator('.mobile-tab.active span').innerText(), await page.locator('.next-raid-card').count()], ['이번 주', 1])

  await page.locator('.mobile-tab', { hasText: '파티' }).tap()
  await page.locator('.mobile-day-tabs[data-section="calendar"] .mobile-day-tab', { hasText: '금' }).tap()
  const visibleTimes = () => page.locator('.calendar-grid .time-label:visible').allInnerTexts()
  check('모바일 파티: 신청 있는 시간만 먼저', await visibleTimes(), ['21:00'])
  const toggle = page.locator('.vacant-times-toggle')
  check('모바일 파티: 빈 시간 더 보기', (await toggle.innerText()).startsWith('빈 시간 7개 더 보기'))
  await page.screenshot({ path: join(out, 'm-party-compact.png') })
  await toggle.tap()
  check('모바일 파티: 펼치면 시간 순서대로 모두', await visibleTimes(), ['17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00', '24:00'])
  await toggle.tap()
  await page.locator('.mobile-day-tabs[data-section="calendar"] .mobile-day-tab', { hasText: '일' }).tap()
  check('모바일 파티: 신청이 없는 요일은 빈 시간을 바로 보여 줌', [(await visibleTimes()).length > 5, await toggle.count()], [true, 0])
  await context.close()
}

// ---------- 남이 클리어를 눌러 내 횟수가 차감되면 안내 (가짜 Supabase) ----------
{
  const toRow = (e) => ({ id: e.id, nickname: e.nickname, raid_name: e.raidName, difficulty: e.difficulty, mode: e.mode, days: e.days, times: e.times, day_time_selection: e.dayTimeSelection, attendance: e.attendance, class_name: e.className, power: e.power, lead_ready: e.leadReady, updated_at: e.updatedAt })
  const rows = [NICK, '원정2'].map((name, i) => toRow(sched(name, i, { 수: ['20:00'] }, { id: `w${i}`, raidName: '에라쿠스 유적', difficulty: '1단계' })))
  const clear = (by) => ({ at: THIS_WEEK, by, members: [NICK, '원정2'] })
  const runRow = { week_start: '2026-12-23', day: '수', time: '20:00', raid_name: '에라쿠스 유적', difficulty: '1단계', mode: '트라이', rally_called_by: NICK, rally_called_at: THIS_WEEK, rally_checkins: [NICK, '원정2'], gathered_at: THIS_WEEK, cleared: 'O', cleared_by: '원정2', clear_log: [clear('원정2')], clear_finished: [] }
  const state = { run: runRow }
  const routes = (context) => context.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const url = route.request().url()
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    let body = url.includes('nickname=eq') ? 'null' : '[]'
    if (url.includes('/rpc/member_login')) body = '"ok"'
    else if (url.includes('/rest/v1/raid_schedules')) body = JSON.stringify(rows)
    else if (url.includes('/rest/v1/raid_runs')) body = JSON.stringify([state.run])
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body })
  })
  const { page, context } = await open(REMOTE, { routes, members: [], extraStorage: { 'raid-calendar-login-v1': NICK, 'raid-calendar-saved-password-v1': PW } })
  await page.waitForSelector('.day-raid-clear-count')
  check('차감 안내: 처음 불러온 기록은 알리지 않음', (await toastText(page)).includes('남은 횟수'), false)
  const refocus = async (minutes) => {
    await page.clock.setFixedTime(new Date(new Date(NOW).getTime() + minutes * 60000))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  }
  state.run = { ...runRow, clear_log: [clear('원정2'), clear('원정2')] }
  await refocus(1)
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('남은 횟수')), null, { timeout: 4000 }).catch(() => {})
  check('차감 안내: 남이 누르면 내 남은 횟수 안내', (await toastText(page)).includes(`에라쿠스 유적 클리어 2회! ${NICK} 남은 횟수 3/5`))
  await context.close()
}

// ---------- 에라쿠스: 클리어로 0/5가 되면 그 시간대와 남은 신청이 일정표에서 빠짐 (가짜 Supabase) ----------
{
  const toRow = (e) => ({ id: e.id, nickname: e.nickname, raid_name: e.raidName, difficulty: e.difficulty, mode: e.mode, days: e.days, times: e.times, day_time_selection: e.dayTimeSelection, attendance: e.attendance, class_name: e.className, power: e.power, lead_ready: e.leadReady, updated_at: e.updatedAt })
  const mine = toRow(sched(NICK, 0, { 수: ['20:00'], 목: ['21:00'] }, { id: 'x0', raidName: '에라쿠스 유적', difficulty: '1단계' }))
  const other = toRow(sched('원정2', 1, { 수: ['20:00'] }, { id: 'x1', raidName: '에라쿠스 유적', difficulty: '1단계' }))
  const runRow = { week_start: '2026-12-23', day: '수', time: '20:00', raid_name: '에라쿠스 유적', difficulty: '1단계', mode: '트라이', rally_called_by: NICK, rally_called_at: THIS_WEEK, rally_checkins: [NICK, '원정2'], gathered_at: THIS_WEEK, cleared: null, cleared_by: null, clear_log: [], clear_finished: [], clear_dropped: [] }
  const cleared = { ...runRow, cleared: 'O', cleared_by: NICK, clear_log: [{ at: THIS_WEEK, by: NICK, members: [NICK, '원정2'] }], clear_finished: [NICK], clear_dropped: [NICK] }
  const requests = []
  const routes = (context) => context.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const url = route.request().url()
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    let body = url.includes('nickname=eq') ? 'null' : '[]'
    if (url.includes('/rpc/member_login')) body = '"ok"'
    else if (url.includes('/rpc/member_raid_clear_count')) {
      requests.push(route.request().postDataJSON())
      body = JSON.stringify({ run: cleared, notified: true, dropped: [NICK] })
    } else if (url.includes('/rest/v1/raid_entry_adjustments')) body = JSON.stringify([{ week_start: '2026-12-23', nickname: NICK, raid_name: '에라쿠스 유적', adjustment: 4 }])
    else if (url.includes('/rest/v1/raid_schedules')) body = JSON.stringify([mine, other])
    else if (url.includes('/rest/v1/raid_runs')) body = JSON.stringify([runRow])
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body })
  })
  const { page, context } = await open(REMOTE, { routes, members: [], extraStorage: { 'raid-calendar-login-v1': NICK, 'raid-calendar-saved-password-v1': PW } })
  const addButton = page.locator('[aria-label="20:00 클리어 1회 추가"]').first()
  await addButton.waitFor()
  await addButton.click()
  check('0/5 정리: 확인 팝업에 신청이 빠진다고 안내', (await page.locator('.save-confirm-modal').innerText()).includes('이 시간대와 아직 시작하지 않은 에라쿠스 유적 신청은 일정표에서 자동으로 빠져요'))
  await page.locator('.save-confirm-modal .primary-button').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('일정표에서 뺐어요')), null, { timeout: 4000 }).catch(() => {})
  check('0/5 정리: 클리어 요청은 한 번', requests.map((request) => request.p_action), ['add'])
  check('0/5 정리: 알림에 신청을 뺐다고 안내', (await toastText(page)).includes(`${NICK}님은 이번 주 횟수를 다 써서 에라쿠스 유적 신청을 일정표에서 뺐어요`))
  check('0/5 정리: 내 에라쿠스 신청이 목록에서 빠짐', await page.locator('.saved-schedule-tag', { hasText: '에라쿠스' }).count(), 0)
  check('0/5 정리: 신청이 빠져도 출발했으니 클리어 버튼은 그대로', await addButton.isDisabled(), false)
  await context.close()
}

// ---------- 에라쿠스: 다른 사람이 먼저 클리어를 누른 경우 (가짜 Supabase) ----------
{
  const toRow = (e) => ({ id: e.id, nickname: e.nickname, raid_name: e.raidName, difficulty: e.difficulty, mode: e.mode, days: e.days, times: e.times, day_time_selection: e.dayTimeSelection, attendance: e.attendance, class_name: e.className, power: e.power, lead_ready: e.leadReady, updated_at: e.updatedAt })
  const rows = [NICK, '원정2'].map((name, i) => toRow(sched(name, i, { 수: ['20:00'] }, { id: `r${i}`, raidName: '에라쿠스 유적', difficulty: '1단계' })))
  const runRow = { week_start: '2026-12-23', day: '수', time: '20:00', raid_name: '에라쿠스 유적', difficulty: '1단계', mode: '트라이', rally_called_by: NICK, rally_called_at: THIS_WEEK, rally_checkins: [NICK, '원정2'], gathered_at: THIS_WEEK, cleared: null, cleared_by: null, clear_log: [], clear_finished: [] }
  const oneClear = { ...runRow, cleared: 'O', cleared_by: '원정2', clear_log: [{ at: THIS_WEEK, by: '원정2', members: [NICK, '원정2'] }] }
  const requests = []
  const routes = (context) => context.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const url = route.request().url()
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    let body = url.includes('nickname=eq') ? 'null' : '[]'
    if (url.includes('/rpc/member_login')) body = '"ok"'
    else if (url.includes('/rpc/member_raid_clear_count')) {
      requests.push(route.request().postDataJSON())
      body = JSON.stringify(requests.length === 1
        ? { error: 'clear_changed', run: oneClear }
        : { run: { ...oneClear, clear_log: [...oneClear.clear_log, { at: THIS_WEEK, by: NICK, members: [NICK, '원정2'] }] }, notified: false })
    } else if (url.includes('/rest/v1/raid_schedules')) body = JSON.stringify(rows)
    else if (url.includes('/rest/v1/raid_runs')) body = JSON.stringify([runRow])
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body })
  })
  const { page, context } = await open(REMOTE, { routes, members: [], extraStorage: { 'raid-calendar-login-v1': NICK, 'raid-calendar-saved-password-v1': PW } })
  await page.waitForSelector('[aria-label="20:00 클리어 1회 추가"]')
  const waitLabel = (text) => page.waitForFunction((value) => document.querySelector('.day-raid-clear-count .day-raid-run-label')?.innerText === value, text)
  await page.locator('[aria-label="20:00 클리어 1회 추가"]').click()
  await waitLabel('클리어 1회')
  check('동시 클리어: 먼저 누른 사람 것으로 맞추고 안내', (await toastText(page)).includes('다른 사람이 클리어 횟수를 바꿨어요'))
  await page.locator('[aria-label="20:00 클리어 1회 추가"]').click()
  await waitLabel('클리어 2회')
  check('동시 클리어: 화면의 횟수를 함께 보냄', requests.map((request) => [request.p_action, request.p_expected_count]), [['add', 0], ['add', 1]])
  check('동시 클리어: 남은 횟수', await page.locator('.day-raid-clear-entry .entries-left-badge').allInnerTexts(), ['3/5', '3/5'])
  await context.close()
}

// ---------- 같은 시간에 다른 레이드 함께 신청 ----------
{
  // 금 20:00에 무스펠 어려움 반숙이상(10인 × 2공대, 21명)과 에라쿠스 1단계(5인 × 2파티, 11명). 같은 사람 11명이 양쪽에 있다.
  const muspel = Array.from({ length: 21 }, (_, i) => sched(`겹침${i + 1}`, i, { 금: ['20:00'] }, {
    id: `dm${i}`, difficulty: '어려움', mode: '반숙이상',
    slotSignedAt: { '금|20:00': `2026-12-23T10:${String(i).padStart(2, '0')}:00+09:00` },
  }))
  const erakus = Array.from({ length: 11 }, (_, i) => sched(`겹침${i + 1}`, i, { 금: ['20:00'] }, {
    id: `de${i}`, raidName: '에라쿠스 유적', difficulty: '1단계', mode: '트라이',
    slotSignedAt: { '금|20:00': `2026-12-23T11:${String(i).padStart(2, '0')}:00+09:00` },
  }))
  const { page, context } = await open(LOCAL, { schedules: [...muspel, ...erakus] })
  await login(page)
  const slot = page.locator('[id="calendar-slot-금-20:00"]')
  const names = () => slot.locator('.party-column .member-name-wrap > span:first-child').allInnerTexts().then((list) => list.sort())

  // 무스펠: 10인 A/B 두 파티 × 2공대, 21번째는 대기
  await pcTab(page, '파티')
  await pickTarget(page, '무스펠', '어려움', '반숙이상')
  check('겹침: 무스펠은 10명 × 2공대 정원', await slot.locator('.slot-count').innerText(), '20/20 +1')
  check('겹침: 무스펠은 공대마다 A/B 5명씩', await slot.locator('.party-column').evaluateAll((cols) => cols.map((c) => c.querySelectorAll('.time-member-pill').length)), [5, 5, 5, 5])
  check('겹침: 무스펠 대기', await slot.locator('.party-waiting').innerText(), '대기 1명: 겹침21')
  await slot.scrollIntoViewIfNeeded()
  await slot.screenshot({ path: join(out, 'pc-same-time-muspel.png') })

  // 신청 저장 → 같은 시간 에라쿠스도 이어서 저장
  await page.locator('[aria-label="금요일 20:00"]').click()
  await page.locator('.member-actions .primary-button').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes('저장했어요')))
  await pickTarget(page, '에라쿠스 유적', '1단계', '트라이')
  check('겹침: 에라쿠스는 5명 × 2파티 정원', await slot.locator('.slot-count').innerText(), '10/10 +1')
  check('겹침: 에라쿠스는 파티마다 한 줄 5명', [await slot.locator('.party-column').count(), await names()], [2, Array.from({ length: 10 }, (_, i) => `겹침${i + 1}`).sort()])
  check('겹침: 에라쿠스 대기', await slot.locator('.party-waiting').innerText(), '대기 1명: 겹침11')
  await slot.screenshot({ path: join(out, 'pc-same-time-erakus.png') })
  check('겹침: 다른 레이드 신청이 있어도 바로 신청 버튼', await slot.locator('.join-slot-button').innerText(), '+ 대기 신청')
  const cell = page.locator('[aria-label="금요일 20:00"]')
  check('겹침: 시간표 칸에 점', (await cell.getAttribute('class')).includes('has-other-raid'))
  await page.locator('#schedule-day-field').screenshot({ path: join(out, 'pc-same-time-form.png') })
  await slot.locator('.join-slot-button').click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('신청했어요')))
  const saved = await page.evaluate((nick) => JSON.parse(localStorage.getItem('raid-calendar-raid-schedules-v1'))
    .filter((e) => e.nickname === nick && e.dayTimeSelection['금'].includes('20:00'))
    .map((e) => `${e.raidName} ${e.difficulty} ${e.mode}`).sort(), NICK)
  check('겹침: 같은 시간 두 레이드 모두 저장', saved, ['무스펠 어려움 반숙이상', '에라쿠스 유적 1단계 트라이'])
  check('겹침: 신청한 레이드에는 버튼 없음', await slot.locator('.join-slot-button').count(), 0)

  // 요일별 현황 · 내 다음 레이드
  const dayCount = (key) => page.locator(`[id="day-raid-row-금-${key}-20:00"] .day-raid-time-count`).innerText()
  check('겹침: 요일별 현황도 레이드별 정원', [await dayCount('무스펠 / 어려움 / 반숙이상'), await dayCount('에라쿠스 유적 / 1단계 / 트라이')], ['20/20 +2', '10/10 +2'])
  await pcTab(page, '이번 주')
  const card = await page.locator('.summary-strip').innerText()
  check('겹침: 내 다음 레이드에 둘 다', [card.includes('무스펠 어려움'), card.includes('에라쿠스 유적 1단계')], [true, true])
  await page.locator('.day-raid-summary-panel').screenshot({ path: join(out, 'pc-same-time-day.png') })
  await context.close()
}

// ---------- 본캐 · 부캐의 같은 레이드 같은 시간은 계속 막음 (가짜 Supabase) ----------
{
  const alt = '테스트부캐'
  const toRow = (e) => ({ id: e.id, nickname: e.nickname, raid_name: e.raidName, difficulty: e.difficulty, mode: e.mode, days: e.days, times: e.times, day_time_selection: e.dayTimeSelection, attendance: e.attendance, class_name: e.className, power: e.power, lead_ready: e.leadReady, updated_at: e.updatedAt })
  const rows = [toRow(sched(alt, 1, { 토: ['21:00'] }, { id: 'alt-row' }))]
  const routes = (context) => context.route(`${FAKE_SUPABASE}/**`, async (route) => {
    const url = route.request().url()
    const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = url.includes('/rpc/member_login') ? '"ok"'
      : url.includes('/rest/v1/raid_schedules') ? JSON.stringify(rows)
        : url.includes('member_alts') ? JSON.stringify([{ alt_nickname: alt, owner_nickname: NICK }])
          : url.includes('nickname=eq') ? 'null' : '[]'
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body })
  })
  const { page, context } = await open(REMOTE, { routes, members: [], extraStorage: { 'raid-calendar-login-v1': NICK, 'raid-calendar-saved-password-v1': PW } })
  await page.waitForSelector('.app-shell')
  await pcTab(page, '파티')
  await page.waitForSelector('[id="calendar-slot-토-21:00"] .time-member-pill')
  await pickTarget(page)
  const cell = page.locator('[aria-label="토요일 21:00"]')
  await cell.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await cell.click({ force: true })
  check('#14 부캐가 같은 레이드로 신청한 시간은 막고 이유 표시', [
    await cell.getAttribute('aria-pressed'),
    (await toastText(page)).includes('다른 캐릭터로 이미 신청한 시간'),
  ], ['false', true])
  check('부캐가 같은 레이드로 신청한 칸에는 바로 신청 버튼 없음', await page.locator('[id="calendar-slot-토-21:00"] .join-slot-button').count(), 0)
  await pickTarget(page, '무스펠', '어려움', '트라이')
  await cell.click({ force: true })
  check('부캐와 다른 레이드면 같은 시간도 고를 수 있음', await cell.getAttribute('aria-pressed'), 'true')
  await context.close()
}

// ---------- PC는 기존 방식 유지 ----------
{
  const { page, context } = await open(LOCAL, { schedules: [...crowd, sched(NICK, 0, { 토: ['22:00'] }, { id: 'mine' })], showGuide: true })
  check('PC: 로그인 화면에 휴대폰 안내 없음', await page.locator('.remember-hint').count(), 0)
  await login(page)
  check('PC: 사용법 팝업 없음', await page.locator('.mobile-guide').count(), 0)
  check('PC: 레이드 선택은 접지 않음', [await page.locator('.target-summary').count(), await page.locator('[aria-label="레이드"] button').count()], [0, 5])
  // 초월 레이드는 난이도가 1~3단계. 성역 레이드로 돌아가면 난이도를 다시 고르게 비운다.
  await page.locator('[aria-label="레이드"] button', { hasText: '에라쿠스 유적' }).click()
  check('PC: 초월 레이드는 1~3단계', [
    await page.locator('[aria-label="난이도"] button').allInnerTexts(),
    await page.locator('[aria-label="난이도"] button.active').count(),
  ], [['1단계', '2단계', '3단계'], 0])
  check('PC: 1~3단계는 난이도를 한 줄 전체로', await page.locator('.two-column.is-stacked [aria-label="난이도"]').count(), 1)
  await page.locator('[aria-label="난이도"]').screenshot({ path: join(out, 'pc-erakus-difficulty.png') })
  await page.locator('[aria-label="난이도"] button', { hasText: '2단계' }).click()
  check('PC: 초월 레이드를 고르면 시간표도 그 탭', (await page.locator('.raid-tab.active').innerText()).startsWith('에라쿠스 유적 2단계'))
  await page.locator('[aria-label="레이드"] button', { hasText: '무스펠' }).click()
  check('PC: 성역 레이드로 바꾸면 난이도 비움', [
    await page.locator('[aria-label="난이도"] button').allInnerTexts(),
    await page.locator('[aria-label="난이도"] button.active').count(),
  ], [['보통', '어려움'], 0])
  await pickTarget(page)
  await page.locator('[aria-label="레이드"] .chip.upcoming', { hasText: '루드라 챌린지' }).click()
  check('PC: 오픈 예정 레이드는 가운데 팝업으로 날짜 알림', [
    await page.locator('.save-confirm-backdrop .upcoming-raid-modal p').innerText(),
    await page.locator('[aria-label="레이드"] .chip.upcoming.active').count(),
  ], ['12/2일 오픈 예정입니다.', 0])
  await page.locator('.upcoming-raid-modal button', { hasText: '확인' }).click()
  check('PC: 확인을 누르면 팝업 닫힘', await page.locator('.upcoming-raid-modal').count(), 0)
  await pcTab(page, '파티')
  await page.locator('.raid-tab.upcoming', { hasText: '승천의 요새' }).click()
  check('PC: 레이드 탭에서도 오픈 날짜 팝업', await page.locator('.upcoming-raid-modal p').innerText(), '1/20일 오픈 예정입니다.')
  await page.keyboard.press('Escape')
  check('PC: Esc로 팝업 닫힘', await page.locator('.upcoming-raid-modal').count(), 0)
  check('PC: 목록의 시간 칩은 눌러 지우기 유지', [(await page.locator('.saved-slot-chip').count()) > 0, await page.locator('.saved-slot-tag').count()], [true, 0])
  const pcHistory = await page.evaluate(() => history.length)
  await page.locator('.saved-schedule-clear').count()
  check('PC: 추천 목록은 항상 펼침', [await page.locator('.recommend-list').count(), await page.locator('.recommend-toggle').count()], [1, 0])
  check('PC: 하단 탭 대신 위쪽 탭 (파티 표는 이번 주 아래)', [await page.locator('.pc-tab').allInnerTexts(), await page.locator('.mobile-tabbar').isVisible()], [['이번 주', '클리어', '인원'], false])
  check('PC: 뒤로 가기 기록을 건드리지 않음', await page.evaluate(() => history.length), pcHistory)
  check('PC: 칸 시간표 유지', [await page.locator('.time-pick-grid').count(), await page.locator('.mobile-time-list').count()], [1, 0])
  check('PC: 레이드 탭 유지', [await page.locator('.raid-tab-group').count(), await page.locator('.mobile-raid-select').count()], [1, 0])
  check('PC: 빈 칸에는 신청 버튼 없음', await page.locator('[id="calendar-slot-토-19:00"] .join-slot-button').count(), 0)
  await pcTab(page, '이번 주')
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
  await pcTab(page, '파티')
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
  await page.waitForFunction(() => document.querySelector('[id="calendar-slot-금-21:00"] .slot-count')?.innerText === '20/20 +1', null, { timeout: 3000 }).catch(() => {})
  check('#2 다른 사람의 삭제가 바로 반영', [beforeCount, await page.locator('[id="calendar-slot-금-21:00"] .slot-count').innerText()], ['20/20 +2', '20/20 +1'])

  // 10. 돌아왔을 때 다시 불러오기 (30초 제한을 넘긴 뒤 focus)
  state.rows = state.rows.slice(0, 5)
  await page.clock.setFixedTime(new Date(new Date(NOW).getTime() + 60000))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => document.querySelector('[id="calendar-slot-금-21:00"] .slot-count')?.innerText === '5/10', null, { timeout: 3000 }).catch(() => {})
  check('#10 앱으로 돌아오면 최신 현황', await page.locator('[id="calendar-slot-금-21:00"] .slot-count').innerText(), '5/10')

  // 대기에서 정원으로 올라오면 앱에서 바로 알림
  const promoteRows = [
    ...Array.from({ length: 20 }, (_, i) => toRow(sched(`선착${i + 1}`, i, { 금: ['21:00'] }, { id: `p-${i}`, slotSignedAt: { '금|21:00': `2026-12-23T10:${String(i).padStart(2, '0')}:00+09:00` } }))),
    toRow(sched(NICK, 1, { 금: ['21:00'] }, { id: 'p-me', slotSignedAt: { '금|21:00': '2026-12-23T11:00:00+09:00' } })),
  ]
  state.rows = promoteRows
  await page.clock.setFixedTime(new Date(new Date(NOW).getTime() + 120000))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.waitForFunction(() => document.querySelector('.summary-strip-next')?.innerText.includes('대기 1번'), null, { timeout: 3000 }).catch(() => {})
  check('내가 대기 1번', (await page.locator('.summary-strip-next').innerText()).includes('대기 1번'))
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
  check('삭제 전 대기 3명', await waiting(), '대기 3명: 레기온원20, 레기온원21, 레기온원22')
  await page.locator('.saved-schedule-delete').click()
  await page.locator('.toast-action', { hasText: '되돌리기' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('.toast-message')].some((t) => t.innerText.includes('되돌렸어요')))
  check('삭제를 되돌리면 원래 순서', await waiting(), '대기 3명: 레기온원20, 레기온원21, 레기온원22')
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

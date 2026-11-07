// 시간표 계산, 신청 데이터 변환, 브라우저 저장 등 화면과 무관한 함수 모음
import { supabase } from './supabase'

export const raidOptions = [
  {
    id: 'muspel',
    label: '무스펠',
    modes: ['보통(트라이)', '어려움(트라이)', '보통(반숙이상)', '어려움(반숙이상)'],
  },
  {
    id: 'snow',
    label: '비탄의 설원',
    modes: ['보통(트라이)', '어려움(트라이)', '보통(반숙이상)', '어려움(반숙이상)'],
  },
]

export const difficultyOptions = ['보통', '어려움']

// 요일별 신청 현황에서 접힌 시간 줄에 미리 보여줄 직업 아이콘 수
export const SUMMARY_ICON_PREVIEW_LIMIT = 4

// 한 타임 정원 (한 파티 5명 × 2파티)
export const RAID_FULL_SIZE = 10

// 시작한 뒤에도 이 시간 동안은 '내 다음 레이드'에 진행 중으로 남겨 둔다.
export const RAID_ONGOING_MS = 60 * 60 * 1000

// 준비 확인은 시작 이 시간 전부터 누를 수 있다. (디스코드 알림이 너무 일찍 가지 않게)
export const RALLY_OPEN_BEFORE_MS = 60 * 60 * 1000

// 앱으로 돌아왔을 때 마지막으로 불러온 뒤 이 시간이 지났으면 현황을 다시 불러온다.
export const REFRESH_MIN_INTERVAL_MS = 30 * 1000

// 파티를 나눌 때 양쪽에 고르게 넣을 직업
export const HEALER_CLASS = '치유성'

// 자정을 넘겨 끝나는 레이드를 위해, 새벽 이 시간까지는 전날 카드를 접지 않고 지난주 화요일 레이드도 표시할 수 있게 둔다.
export const LATE_NIGHT_GRACE_MS = 6 * 60 * 60 * 1000

// 토스트 알림이 떠 있는 시간 (ms)
export const TOAST_DURATION = { info: 3500, success: 3000, error: 6000 }

// 되돌리기 같은 버튼이 달린 알림은 누를 시간을 넉넉히 준다.
export const TOAST_ACTION_DURATION = 8000

// '내 레이드만 보기' 설정을 이 브라우저에 기억해 둔다.
export const ONLY_MINE_STORAGE_KEY = 'raid-calendar-only-mine-v1'

// 준비 확인 동작이 끝났을 때 알림 문구
export const RALLY_SUCCESS_MESSAGES = {
  call: '준비 확인을 시작했어요.',
  check: '준비 완료로 표시했어요.',
  uncheck: '준비를 취소했어요.',
  cancel: '준비 확인을 취소했어요.',
  remind: '디스코드로 다시 알렸어요.',
  start: '지금 준비한 인원으로 시작했어요.',
}

export const modeOptions = ['트라이', '반숙이상']

export const raidTabOptions = [
  { id: 'muspel-normal', label: '무스펠 보통', raid: '무스펠', difficulty: '보통' },
  { id: 'muspel-hard', label: '무스펠 어려움', raid: '무스펠', difficulty: '어려움' },
  { id: 'snow-normal', label: '비탄의 설원 보통', raid: '비탄의 설원', difficulty: '보통' },
  { id: 'snow-hard', label: '비탄의 설원 어려움', raid: '비탄의 설원', difficulty: '어려움' },
]

export const raidDifficultyAvailability = {
  무스펠: ['보통', '어려움'],
  '비탄의 설원': ['보통', '어려움'],
}

export const STORAGE_KEY = 'raid-calendar-members-v1'

export const RAID_SCHEDULES_STORAGE_KEY = 'raid-calendar-raid-schedules-v1'

// 지난 신청 보관 (다시 등록한 뒤 지워도 다시 불러올 수 있게)
export const ARCHIVED_SCHEDULES_STORAGE_KEY = 'raid-calendar-archived-schedules-v1'

export const LOGIN_STORAGE_KEY = 'raid-calendar-login-v1'

// '비밀번호 저장'을 켠 기기에서만 비밀번호를 남겨 두고, 다음 접속 때 입력칸에 미리 채운다.
export const SAVED_PASSWORD_STORAGE_KEY = 'raid-calendar-saved-password-v1'

export const RAID_RUNS_STORAGE_KEY = 'raid-calendar-raid-runs-v1'
// 모바일 첫 사용 안내를 본 기기
export const MOBILE_GUIDE_STORAGE_KEY = 'raid-calendar-mobile-guide-v1'

// 모바일에서 햄버거 메뉴로 한 번에 하나씩 보여주는 영역 (data-section 값과 맞춘다)
// short: 모바일 하단 탭에 쓰는 짧은 이름
export const MOBILE_SECTIONS = [
  { id: 'form', label: '레이드 신청', short: '신청' },
  { id: 'day', label: '이번 주 현황', short: '이번 주' },
  { id: 'calendar', label: '파티 보기', short: '파티' },
  { id: 'members', label: '레이드별 인원', short: '인원' },
]

export const weekdayNames = ['수', '목', '금', '토', '일', '월', '화']

export const weekdayTimeSlots = [
  '19:00',
  '20:00',
  '21:00',
  '22:00',
  '23:00',
  '00:00',
]

export const weekendTimeSlots = [
  '12:00',
  '13:00',
  '14:00',
  '15:00',
  '16:00',
  '17:00',
  '18:00',
  '19:00',
  '20:00',
  '21:00',
  '22:00',
  '23:00',
  '00:00',
]

export const hiddenWeekdayTimeSlots = ['12:00', '13:00', '14:00', '15:00', '16:00']

export const timeSlots = Array.from(new Set([...weekdayTimeSlots, ...weekendTimeSlots, ...hiddenWeekdayTimeSlots])).sort((a, b) => {
  const aMinutes = a === '00:00' ? 24 * 60 : timeToMinutes(a)
  const bMinutes = b === '00:00' ? 24 * 60 : timeToMinutes(b)
  return aMinutes - bMinutes
})

export function formatIsoDate(date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function buildFallbackHolidaySet(year) {
  const set = new Set()
  const fixedHolidayDates = [
    `${year}-01-01`,
    `${year}-03-01`,
    `${year}-05-05`,
    `${year}-06-06`,
    `${year}-08-15`,
    `${year}-10-03`,
    `${year}-10-09`,
    `${year}-12-25`,
  ]

  fixedHolidayDates.forEach((date) => set.add(date))

  // 공휴일 API를 못 쓸 때의 예비 값. 해마다 달라지는 날(음력 명절, 대체 공휴일 등)을 2026-11 기준 같은 API 값으로 넣었다.
  const yearlyHolidayMap = {
    2026: ['02-16', '02-17', '02-18', '03-02', '05-01', '05-25', '06-03', '07-17', '08-17', '09-24', '09-25', '09-26', '10-05'],
    2027: ['02-06', '02-08', '02-09', '05-03', '05-13', '07-19', '08-16', '09-14', '09-15', '09-16', '10-04', '10-11'],
    2028: ['01-26', '01-27', '01-28', '05-01', '05-02', '07-17', '10-02', '10-04'],
    2029: ['02-12', '02-13', '02-14', '05-01', '05-07', '05-21', '07-17', '09-21', '09-22', '09-24'],
    2030: ['02-02', '02-04', '02-05', '05-01', '05-06', '05-09', '07-17', '09-11', '09-12', '09-13'],
  }

  ;(yearlyHolidayMap[year] ?? []).forEach((date) => set.add(`${year}-${date}`))

  return set
}

export function getHolidaySetForYear(year) {
  return fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Holiday API failed: ${response.status}`)
      }

      return response.json()
    })
    .then((holidays) => new Set(holidays.map((holiday) => holiday.date)))
    .catch(() => buildFallbackHolidaySet(year))
}

export const classOptions = [
  '수호성',
  '검성',
  '권성',
  '궁성',
  '정령성',
  '마도성',
  '살성',
  '호법성',
  '치유성',
]

export const powerOptions = [
  '100~200k',
  '200~300k',
  '300~400k',
  '400~500k',
  '500~600k',
  '600~700k',
  '700~800k',
  '800~900k',
  '900~1000k',
  '1000~1100k',
  '1100~1200k',
]

export function normalizeRaidName(raidValue) {
  const normalized = String(raidValue ?? '')
    .replace(/비탄의\s*성역/g, '비탄의 설원')
    .replace(/비탄의\s*설원/g, '비탄의 설원')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return '무스펠'
  }

  const matched = raidOptions.find((raid) => {
    const label = raid.label
    return (
      raid.id === raidValue ||
      label === raidValue ||
      label.replace(/\s+/g, ' ') === normalized ||
      raidValue === label.replace(/\s+/g, ' ')
    )
  })

  return matched?.label ?? normalized
}

export function getRaidLabel(raidValue) {
  const normalized = normalizeRaidName(raidValue)
  return raidOptions.find((raid) => {
    const label = raid.label
    return raid.id === normalized || label === normalized || label === raidValue || label.replace(/\s+/g, ' ') === normalized
  })?.label ?? '무스펠'
}

export function getDifficultyForRaid(raidLabel) {
  if (raidLabel === '비탄의 설원') return '보통'
  return '보통'
}

export function normalizeLeadReady(value) {
  const normalized = String(value ?? 'X').toUpperCase()
  return normalized === 'O' || normalized === 'TRUE' || normalized === 'YES' ? 'O' : 'X'
}

export function getClassIconPath(className) {
  return `/img/${className}.webp`
}

export function getNicknameClassName(nickname) {
  return nickname && nickname.length >= 4 ? 'nickname-truncate' : ''
}

// 기준 시각이 속한 주의 수요일 00시
export function getWeekStart(baseDate) {
  const start = new Date(baseDate)
  const offset = (baseDate.getDay() + 4) % 7
  start.setDate(baseDate.getDate() - offset)
  start.setHours(0, 0, 0, 0)
  return start
}

export function getWeekDates(weekStartTime) {
  const start = new Date(weekStartTime)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

export function getNextResetDate() {
  const now = new Date()
  const nextReset = new Date(now)
  nextReset.setHours(0, 0, 0, 0)

  const daysToWednesday = (3 - nextReset.getDay() + 7) % 7
  nextReset.setDate(nextReset.getDate() + (daysToWednesday === 0 ? 7 : daysToWednesday))

  return nextReset
}

export function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// 화요일 00:00은 수요일 00:00(주간 리셋)과 같은 시각이라, 시작하는 순간 사라져서 신청을 받지 않는다.
export function isResetOverlapSlot(day, time) {
  return day === '화' && time === '00:00'
}

// 저장 값 00:00은 그 요일 밤 12시라서 화면에는 24:00으로 보여 준다.
export function formatTimeLabel(time) {
  return time === '00:00' ? '24:00' : time
}

// 인원 표시: 정원까지는 "7/10", 넘으면 "10/10 +3"
export function formatHeadcount(count) {
  const overflow = count - RAID_FULL_SIZE
  return `${Math.min(count, RAID_FULL_SIZE)}/${RAID_FULL_SIZE}${overflow > 0 ? ` +${overflow}` : ''}`
}

export function buildEmptyDayTimeSelection() {
  return Object.fromEntries(weekdayNames.map((day) => [day, []]))
}

export function normalizeDayTimeSelection(rawSelection) {
  const nextSelection = buildEmptyDayTimeSelection()

  if (!rawSelection || typeof rawSelection !== 'object') {
    return nextSelection
  }

  Object.entries(rawSelection).forEach(([day, times]) => {
    if (!weekdayNames.includes(day)) {
      return
    }

    const normalizedTimes = Array.isArray(times)
      ? [...new Set(times.filter((time) => typeof time === 'string' && timeSlots.includes(time) && !isResetOverlapSlot(day, time)))]
      : []

    nextSelection[day] = normalizedTimes
  })

  return nextSelection
}

export function getSelectedDayList(dayTimeSelection) {
  return Object.entries(dayTimeSelection ?? {})
    .filter(([day, times]) => weekdayNames.includes(day) && Array.isArray(times) && times.length > 0)
    .map(([day]) => day)
}

export function getCombinedTimes(dayTimeSelection) {
  return [...new Set(Object.values(dayTimeSelection ?? {}).flat().filter((time) => timeSlots.includes(time)))].sort(
    (a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b),
  )
}

// 저장된 레코드에서 요일별 시간 선택을 복원한다.
// 요일별 데이터가 없는 이전 레코드는 days × times 조합으로 복원한다.
export function resolveDayTimeSelection(record) {
  const selection = normalizeDayTimeSelection(record.day_time_selection ?? record.dayTimeSelection)

  if (getSelectedDayList(selection).length > 0) {
    return selection
  }

  const legacyDays = Array.isArray(record.days) ? record.days : []
  const legacyTimes = Array.isArray(record.times) ? record.times : []

  return normalizeDayTimeSelection(Object.fromEntries(legacyDays.map((day) => [day, legacyTimes])))
}

// 스케줄을 구분하는 키 (레이드 · 난이도 · 공략 방식).
export function getScheduleKey(entry) {
  return `${entry.raidName}|${entry.difficulty}|${entry.mode}`
}

// members 쪽에 남은 같은 스케줄(닉네임 · 레이드 조합). 스케줄을 지우거나 줄일 때 같이 맞춰야 캘린더에 반영된다.
export function isScheduleMember(member, nickname, target) {
  return member.nickname === nickname
    && getRaidLabel(member.raidFocus) === target.raidName
    && (member.difficulty ?? getDifficultyForRaid(target.raidName)) === target.difficulty
    && (member.mode ?? '트라이') === target.mode
}

// 스케줄 키 "무스펠|어려움|트라이"를 "무스펠 · 어려움 · 트라이"로 표시한다.
export function formatScheduleKey(key) {
  return key.split('|').join(' · ')
}

// 시간 삭제 대상 { entry, day, time }을 "목요일 19:00" / "목요일 전체" 형태로 표시한다. (time이 null이면 그 요일 전체)
export function describePendingSlot({ day, time }) {
  return `${day}요일 ${time ? formatTimeLabel(time) : '전체'}`
}

// 요일별 시간 선택을 "목 19:00 / 금 20:00, 21:00" 형태로 표시한다.
export function formatDayTimeSelection(dayTimeSelection) {
  return weekdayNames
    .filter((day) => (dayTimeSelection?.[day] ?? []).length > 0)
    .map((day) => `${day} ${[...dayTimeSelection[day]].sort((a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b)).map(formatTimeLabel).join(', ')}`)
    .join(' / ')
}

// 요일별 시간 선택을 [요일, 시간] 쌍 목록으로 펼친다.
export function getDayTimePairs(dayTimeSelection) {
  return Object.entries(dayTimeSelection ?? {}).flatMap(([day, times]) =>
    Array.isArray(times) ? times.map((time) => [day, time]) : [],
  )
}

// 이번 주 요일 · 시간을 실제 시각으로 바꾼다. 00:00은 그 요일 밤 12시(다음 날 0시)로 본다.
export function getSlotStartDate(weekDates, day, time) {
  const date = new Date(weekDates[weekdayNames.indexOf(day)])

  if (time === '00:00') {
    date.setDate(date.getDate() + 1)
    return date
  }

  const [hours, minutes] = time.split(':').map(Number)
  date.setHours(hours, minutes, 0, 0)
  return date
}

// 남은 시간을 "2시간 10분 후" / "15분 후" / "진행 중" 으로 표시한다.
export function formatTimeUntil(diffMs) {
  if (diffMs <= 0) {
    return '진행 중'
  }

  const totalMinutes = Math.ceil(diffMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) {
    return `${days}일 ${hours}시간 후`
  }

  return hours > 0 ? `${hours}시간 ${minutes}분 후` : `${minutes}분 후`
}

// 전투력 구간 "600~700k"를 비교할 수 있는 숫자(아래쪽 값)로 바꾼다. 알 수 없으면 0.
export function getPowerValue(power) {
  const matched = String(power ?? '').match(/\d+/)
  return matched ? Number(matched[0]) : 0
}

// 한 타임 인원을 A/B 파티로 나눈다. people은 신청 순서로 정렬되어 있어야 한다. 앞의 10명이 정원이고 나머지는 대기다.
// 가능한 나눔을 모두 비교해 리딩 가능자 수 → 치유성 수 → 전투력 합 순으로 가장 고른 것을 고른다. (최대 252가지)
export function buildBalancedParties(people) {
  const roster = people.slice(0, RAID_FULL_SIZE)
  const count = roster.length
  const sizeA = Math.ceil(count / 2)
  const sum = (getValue) => roster.reduce((total, member) => total + getValue(member), 0)
  const leaderValue = (member) => (member.leadReady === 'O' ? 1 : 0)
  const healerValue = (member) => (member.className === HEALER_CLASS ? 1 : 0)
  const totals = [sum(leaderValue), sum(healerValue), sum((member) => getPowerValue(member.power))]
  let bestMask = 0
  let bestCost = null

  // 첫 사람은 항상 A에 둔다. (같은 나눔이 A/B만 뒤바뀌어 사람마다 다르게 보이지 않게)
  for (let mask = 1; mask < (1 << count); mask += 2) {
    const partyA = roster.filter((_, index) => mask & (1 << index))

    if (partyA.length !== sizeA) {
      continue
    }

    const partSums = [
      partyA.reduce((total, member) => total + leaderValue(member), 0),
      partyA.reduce((total, member) => total + healerValue(member), 0),
      partyA.reduce((total, member) => total + getPowerValue(member.power), 0),
    ]
    const cost = partSums.map((value, index) => Math.abs(2 * value - totals[index]))
    const isBetter = !bestCost
      || cost[0] < bestCost[0]
      || (cost[0] === bestCost[0] && (cost[1] < bestCost[1] || (cost[1] === bestCost[1] && cost[2] < bestCost[2])))

    if (isBetter) {
      bestMask = mask
      bestCost = cost
    }
  }

  const byRole = (a, b) => (b.leadReady === 'O') - (a.leadReady === 'O') || getPowerValue(b.power) - getPowerValue(a.power)

  return {
    partyA: roster.filter((_, index) => bestMask & (1 << index)).sort(byRole),
    partyB: roster.filter((_, index) => !(bestMask & (1 << index))).sort(byRole),
    waiting: people.slice(RAID_FULL_SIZE),
  }
}

// 레이드 · 난이도 · 공략 방식 순으로 정렬한다.
export function compareSchedules(a, b) {
  const raidOrder = { 무스펠: 0, '비탄의 설원': 1 }
  const difficultyOrder = { 보통: 0, 어려움: 1 }

  return (raidOrder[a.raidName] ?? 99) - (raidOrder[b.raidName] ?? 99)
    || (difficultyOrder[a.difficulty] ?? 99) - (difficultyOrder[b.difficulty] ?? 99)
    || (a.mode ?? '').localeCompare(b.mode ?? '')
}

export function buildDefaultMember(overrides = {}) {
  const initialSelection = buildEmptyDayTimeSelection()

  return {
    id: `member-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nickname: '나의닉네임',
    days: [],
    times: [],
    dayTimeSelection: initialSelection,
    attendance: '참',
    // 로그인 직후 폼에는 아무것도 선택되지 않은 상태로 시작한다.
    className: '',
    power: '',
    raidFocus: '',
    difficulty: '',
    mode: '',
    leadReady: '',
    ...overrides,
  }
}

export function normalizeMemberRecord(member) {
  if (!member) {
    return null
  }

  const raidFocus = normalizeRaidName(member.raid_focus ?? member.raidFocus ?? '무스펠')
  const dayTimeSelection = resolveDayTimeSelection(member)
  const normalizedDays = getSelectedDayList(dayTimeSelection)
  const normalizedTimes = getCombinedTimes(dayTimeSelection)

  return {
    id: member.id ?? `member-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nickname: member.nickname ?? '닉네임',
    days: normalizedDays,
    times: normalizedTimes,
    dayTimeSelection,
    attendance: member.attendance ?? '참',
    className: member.class_name ?? member.className ?? '수호성',
    power: member.power ?? '600~700k',
    raidFocus,
    difficulty: member.difficulty ?? getDifficultyForRaid(raidFocus),
    mode: member.mode ?? '트라이',
    leadReady: normalizeLeadReady(member.lead_ready ?? member.leadReady ?? 'X'),
    updatedAt: member.updated_at ?? member.updatedAt ?? new Date().toISOString(),
  }
}

// 이번 주(수요일 00시) 이후에 저장된 기록인지. 지난주에 저장한 신청은 매주 수요일에 초기화된 것으로 본다.
export function isSavedThisWeek(record, weekStartTime) {
  const savedTime = new Date(record.updatedAt).getTime()
  return Number.isNaN(savedTime) || savedTime >= weekStartTime
}

// 그 시간대에 처음 신청한 시각. 기록이 없는 예전 신청은 마지막 저장 시각으로 본다. (DB의 _raid_slot_roster와 같은 기준)
export function getSlotSignedTime(record, day, time) {
  const signedTime = new Date(record.slotSignedAt?.[`${day}|${time}`] ?? record.updatedAt).getTime()
  return Number.isNaN(signedTime) ? 0 : signedTime
}

// 한 시간대 인원을 신청 순서로 정렬한다. 같은 시각이면 닉네임 코드값 순으로, 어느 화면에서든 순서가 같게 한다.
export function compareSlotPeople(a, b) {
  if (a.signedTime !== b.signedTime) {
    return a.signedTime - b.signedTime
  }

  if (a.nickname === b.nickname) {
    return 0
  }

  return a.nickname < b.nickname ? -1 : 1
}

// 로컬 모드에서 DB 트리거(_stamp_slot_signed_at)와 같은 규칙으로 시간대별 신청 시각을 채운다.
// restored: 되돌리기로 다시 넣을 때 쓰는, 뺄 때의 신청 시각
export function stampSlotSignedAt(previous, selection, nowIso, weekStartTime, restored = null) {
  const wasThisWeek = Boolean(previous) && isSavedThisWeek(previous, weekStartTime)

  return Object.fromEntries(getDayTimePairs(selection).map(([day, time]) => {
    const slotKey = `${day}|${time}`
    const kept = wasThisWeek
      ? previous.slotSignedAt?.[slotKey] ?? ((previous.dayTimeSelection?.[day] ?? []).includes(time) ? previous.updatedAt : null)
      : null

    return [slotKey, kept ?? restored?.[slotKey] ?? nowIso]
  }))
}

export function normalizeRaidScheduleEntry(entry) {
  if (!entry) {
    return null
  }

  const nickname = entry.nickname ?? '닉네임'
  const raidName = normalizeRaidName(entry.raid_name ?? entry.raidName ?? '무스펠')
  const difficulty = entry.difficulty ?? '쉬움'
  const mode = entry.mode ?? '트라이'
  const dayTimeSelection = resolveDayTimeSelection(entry)
  const normalizedDays = getSelectedDayList(dayTimeSelection)
  const normalizedTimes = getCombinedTimes(dayTimeSelection)

  return {
    id: entry.id ?? `schedule-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nickname,
    raidName,
    difficulty,
    mode,
    days: normalizedDays,
    times: normalizedTimes,
    dayTimeSelection,
    attendance: entry.attendance ?? '참',
    className: entry.class_name ?? entry.className ?? '수호성',
    power: entry.power ?? '600~700k',
    leadReady: normalizeLeadReady(entry.lead_ready ?? entry.leadReady ?? 'X'),
    updatedAt: entry.updated_at ?? entry.updatedAt ?? new Date().toISOString(),
    slotSignedAt: entry.slot_signed_at ?? entry.slotSignedAt ?? {},
  }
}

export function loadLocalMembers() {
  const saved = localStorage.getItem(STORAGE_KEY)

  if (!saved) {
    return []
  }

  try {
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.map((member) => normalizeMemberRecord(member)).filter(Boolean) : []
  } catch {
    return []
  }
}

export function saveLocalMembers(nextMembers) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMembers))
}

export function loadLocalRaidSchedules() {
  const saved = localStorage.getItem(RAID_SCHEDULES_STORAGE_KEY)

  if (!saved) {
    return []
  }

  try {
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeRaidScheduleEntry(entry)).filter(Boolean) : []
  } catch {
    return []
  }
}

export function saveLocalRaidSchedules(nextSchedules) {
  localStorage.setItem(RAID_SCHEDULES_STORAGE_KEY, JSON.stringify(nextSchedules))
}

// 지난 신청 보관 (raid_schedule_archive)
export function loadLocalArchivedSchedules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVED_SCHEDULES_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeRaidScheduleEntry(entry)).filter(Boolean) : []
  } catch {
    return []
  }
}

export function saveLocalArchivedSchedules(nextSchedules) {
  try {
    localStorage.setItem(ARCHIVED_SCHEDULES_STORAGE_KEY, JSON.stringify(nextSchedules))
  } catch {
    // Ignore storage errors.
  }
}

// 보관 목록에 지난 신청을 합친다. 캐릭터 · 레이드 조합마다 가장 최근에 저장된 것 한 건만 남긴다.
// 바뀐 것이 없으면 prev를 그대로 돌려준다.
export function mergeArchivedSchedules(prev, entries) {
  const byKey = new Map(prev.map((entry) => [`${entry.nickname}|${getScheduleKey(entry)}`, entry]))
  let changed = false

  entries.forEach((entry) => {
    const key = `${entry.nickname}|${getScheduleKey(entry)}`
    const existing = byKey.get(key)

    if (!existing || new Date(existing.updatedAt).getTime() < new Date(entry.updatedAt).getTime()) {
      byKey.set(key, entry)
      changed = true
    }
  })

  return changed ? [...byKey.values()] : prev
}

// 시간대별 준비 / 클리어 기록 (raid_runs)
export function formatDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function getRaidRunKey(run) {
  return [run.weekStart, run.day, run.time, run.raidName, run.difficulty, run.mode].join('|')
}

export function normalizeRaidRun(entry) {
  if (!entry) {
    return null
  }

  return {
    weekStart: entry.week_start ?? entry.weekStart,
    day: entry.day,
    time: entry.time,
    raidName: entry.raid_name ?? entry.raidName,
    difficulty: entry.difficulty,
    mode: entry.mode,
    // 준비: 호출한 사람 · 시각, 체크한 닉네임, 모두 모인 시각
    rallyCalledBy: entry.rally_called_by ?? entry.rallyCalledBy ?? null,
    rallyCalledAt: entry.rally_called_at ?? entry.rallyCalledAt ?? null,
    rallyCheckins: entry.rally_checkins ?? entry.rallyCheckins ?? [],
    gatheredAt: entry.gathered_at ?? entry.gatheredAt ?? null,
    cleared: entry.cleared ?? null,
    clearedBy: entry.cleared_by ?? entry.clearedBy ?? null,
    // 준비 확인 알림을 보낸 횟수 (시간대마다 최대 2번). 클리어 알림은 한 번만 보낸다.
    rallyNotifyCount: entry.rally_notify_count ?? entry.rallyNotifyCount ?? (entry.rally_notified_at ? 1 : 0),
    clearedNotified: Boolean(entry.cleared_notified_at ?? entry.clearedNotified),
  }
}

export function loadLocalRaidRuns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RAID_RUNS_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeRaidRun(entry)).filter(Boolean) : []
  } catch {
    return []
  }
}

export function saveLocalRaidRuns(nextRuns) {
  try {
    localStorage.setItem(RAID_RUNS_STORAGE_KEY, JSON.stringify(nextRuns))
  } catch {
    // Ignore storage errors.
  }
}

// 기록 목록에서 한 건을 바꾸거나 추가한다.
export function upsertRaidRun(runs, nextRun) {
  const key = getRaidRunKey(nextRun)
  const index = runs.findIndex((run) => getRaidRunKey(run) === key)

  if (index < 0) {
    return [...runs, nextRun]
  }

  const nextRuns = [...runs]
  nextRuns[index] = nextRun
  return nextRuns
}

export function readStoredLoginNickname() {
  try {
    return localStorage.getItem(LOGIN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeStoredLoginNickname(nextNickname) {
  try {
    if (nextNickname) {
      localStorage.setItem(LOGIN_STORAGE_KEY, nextNickname)
      return
    }

    localStorage.removeItem(LOGIN_STORAGE_KEY)
  } catch {
    // Ignore storage errors.
  }
}

export function readStoredLoginPassword() {
  try {
    return localStorage.getItem(SAVED_PASSWORD_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeStoredLoginPassword(nextPassword) {
  try {
    if (nextPassword) {
      localStorage.setItem(SAVED_PASSWORD_STORAGE_KEY, nextPassword)
      return
    }

    localStorage.removeItem(SAVED_PASSWORD_STORAGE_KEY)
  } catch {
    // Ignore storage errors.
  }
}

export function buildEmptyPasswordForm() {
  return { current: '', next: '', confirm: '', hintQuestion: '', hintAnswer: '', error: '', message: '' }
}

// 본캐 · 부캐 연결 목록. 실패하거나 로컬 모드면 null (부캐 기능은 Supabase 모드 전용)
export async function fetchMemberAlts() {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase.from('member_alts').select('alt_nickname, owner_nickname')

  if (error || !Array.isArray(data)) {
    return null
  }

  return data.map((row) => ({ altNickname: row.alt_nickname, ownerNickname: row.owner_nickname }))
}

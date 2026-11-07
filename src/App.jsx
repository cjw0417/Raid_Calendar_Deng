import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import {
  HINT_QUESTIONS,
  PASSWORD_RULE,
  deleteAllMemberSchedules,
  deleteMemberSchedule,
  describeAuthResult,
  linkMemberAlt,
  memberGetHintQuestion,
  memberLogin,
  memberResetPassword,
  memberSetPassword,
  memberSetupPassword,
  normalizeHintAnswer,
  saveMemberSchedule,
  setRaidRally,
  setRaidRunStatus,
  unlinkMemberAlt,
} from './lib/memberApi'
import './App.css'

const raidOptions = [
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

const difficultyOptions = ['보통', '어려움']
// 요일별 신청 현황에서 접힌 시간 줄에 미리 보여줄 직업 아이콘 수
const SUMMARY_ICON_PREVIEW_LIMIT = 4
// 한 타임 정원 (한 파티 5명 × 2파티)
const RAID_FULL_SIZE = 10
// 시작한 뒤에도 이 시간 동안은 '내 다음 레이드'에 진행 중으로 남겨 둔다.
const RAID_ONGOING_MS = 60 * 60 * 1000
// 준비 확인은 시작 이 시간 전부터 누를 수 있다. (디스코드 알림이 너무 일찍 가지 않게)
const RALLY_OPEN_BEFORE_MS = 60 * 60 * 1000
// 앱으로 돌아왔을 때 마지막으로 불러온 뒤 이 시간이 지났으면 현황을 다시 불러온다.
const REFRESH_MIN_INTERVAL_MS = 30 * 1000
// 파티를 나눌 때 양쪽에 고르게 넣을 직업
const HEALER_CLASS = '치유성'
// 토스트 알림이 떠 있는 시간 (ms)
const TOAST_DURATION = { info: 3500, success: 3000, error: 6000 }
// 되돌리기 같은 버튼이 달린 알림은 누를 시간을 넉넉히 준다.
const TOAST_ACTION_DURATION = 8000
// '내 레이드만 보기' 설정을 이 브라우저에 기억해 둔다.
const ONLY_MINE_STORAGE_KEY = 'raid-calendar-only-mine-v1'
// 준비 확인 동작이 끝났을 때 알림 문구
const RALLY_SUCCESS_MESSAGES = {
  call: '준비 확인을 시작했어요.',
  check: '준비 완료로 표시했어요.',
  uncheck: '준비를 취소했어요.',
  cancel: '준비 확인을 취소했어요.',
  remind: '디스코드로 다시 알렸어요.',
  start: '지금 준비한 인원으로 시작했어요.',
}
const modeOptions = ['트라이', '반숙이상']
const raidTabOptions = [
  { id: 'muspel-normal', label: '무스펠 보통', raid: '무스펠', difficulty: '보통' },
  { id: 'muspel-hard', label: '무스펠 어려움', raid: '무스펠', difficulty: '어려움' },
  { id: 'snow-normal', label: '비탄의 설원 보통', raid: '비탄의 설원', difficulty: '보통' },
  { id: 'snow-hard', label: '비탄의 설원 어려움', raid: '비탄의 설원', difficulty: '어려움' },
]

const raidDifficultyAvailability = {
  무스펠: ['보통', '어려움'],
  '비탄의 설원': ['보통', '어려움'],
}

const STORAGE_KEY = 'raid-calendar-members-v1'
const RAID_SCHEDULES_STORAGE_KEY = 'raid-calendar-raid-schedules-v1'
// 지난 신청 보관 (다시 등록한 뒤 지워도 다시 불러올 수 있게)
const ARCHIVED_SCHEDULES_STORAGE_KEY = 'raid-calendar-archived-schedules-v1'
const LOGIN_STORAGE_KEY = 'raid-calendar-login-v1'
// '비밀번호 저장'을 켠 기기에서만 비밀번호를 남겨 두고, 다음 접속 때 입력칸에 미리 채운다.
const SAVED_PASSWORD_STORAGE_KEY = 'raid-calendar-saved-password-v1'
const RAID_RUNS_STORAGE_KEY = 'raid-calendar-raid-runs-v1'

// 모바일에서 햄버거 메뉴로 한 번에 하나씩 보여주는 영역 (data-section 값과 맞춘다)
// short: 모바일 하단 탭에 쓰는 짧은 이름
const MOBILE_SECTIONS = [
  { id: 'form', label: '내 시간 등록', short: '내 시간' },
  { id: 'day', label: '요일별 신청 현황', short: '요일별' },
  { id: 'calendar', label: '주간 레이드 슬롯', short: '주간 슬롯' },
  { id: 'members', label: '난이도별 선택인원', short: '인원' },
]

// 모바일 하단 탭 아이콘
function MobileTabIcon({ id }) {
  const paths = {
    form: 'M5 4h14v16H5z M9 9h6 M9 13h6 M9 17h3',
    day: 'M4 6h16 M4 12h16 M4 18h10',
    calendar: 'M4 5h16v15H4z M4 10h16 M9 5v15 M15 5v15',
    members: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M16 5.5a3 3 0 0 1 0 5.5 M18 14.5c1.8.9 3 2.9 3 5.5',
  }

  return (
    <svg className="mobile-tab-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[id]} />
    </svg>
  )
}
const weekdayNames = ['수', '목', '금', '토', '일', '월', '화']
const weekdayTimeSlots = [
  '19:00',
  '20:00',
  '21:00',
  '22:00',
  '23:00',
  '00:00',
]
const weekendTimeSlots = [
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
const hiddenWeekdayTimeSlots = ['12:00', '13:00', '14:00', '15:00', '16:00']
const timeSlots = Array.from(new Set([...weekdayTimeSlots, ...weekendTimeSlots, ...hiddenWeekdayTimeSlots])).sort((a, b) => {
  const aMinutes = a === '00:00' ? 24 * 60 : timeToMinutes(a)
  const bMinutes = b === '00:00' ? 24 * 60 : timeToMinutes(b)
  return aMinutes - bMinutes
})

function formatIsoDate(date) {
  const offset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function buildFallbackHolidaySet(year) {
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

  const lunarHolidayMap = {
    2025: ['2025-01-29', '2025-01-30', '2025-01-31', '2025-10-06', '2025-10-07', '2025-10-08'],
    2026: ['2026-02-17', '2026-02-18', '2026-02-19', '2026-10-25', '2026-10-26', '2026-10-27'],
    2027: ['2027-02-06', '2027-02-07', '2027-02-08', '2027-10-15', '2027-10-16', '2027-10-17'],
    2028: ['2028-02-24', '2028-02-25', '2028-02-26', '2028-11-02', '2028-11-03', '2028-11-04'],
    2029: ['2029-02-12', '2029-02-13', '2029-02-14', '2029-10-22', '2029-10-23', '2029-10-24'],
    2030: ['2030-02-02', '2030-02-03', '2030-02-04', '2030-10-12', '2030-10-13', '2030-10-14'],
  }

  ;(lunarHolidayMap[year] ?? []).forEach((date) => set.add(date))

  return set
}

function getHolidaySetForYear(year) {
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

const classOptions = [
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
const powerOptions = [
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

function normalizeRaidName(raidValue) {
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

function getRaidLabel(raidValue) {
  const normalized = normalizeRaidName(raidValue)
  return raidOptions.find((raid) => {
    const label = raid.label
    return raid.id === normalized || label === normalized || label === raidValue || label.replace(/\s+/g, ' ') === normalized
  })?.label ?? '무스펠'
}

function getDifficultyForRaid(raidLabel) {
  if (raidLabel === '비탄의 설원') return '보통'
  return '보통'
}

function normalizeLeadReady(value) {
  const normalized = String(value ?? 'X').toUpperCase()
  return normalized === 'O' || normalized === 'TRUE' || normalized === 'YES' ? 'O' : 'X'
}

function getClassIconPath(className) {
  return `/img/${className}.webp`
}

function getNicknameClassName(nickname) {
  return nickname && nickname.length >= 4 ? 'nickname-truncate' : ''
}

// 기준 시각이 속한 주의 수요일 00시
function getWeekStart(baseDate) {
  const start = new Date(baseDate)
  const offset = (baseDate.getDay() + 4) % 7
  start.setDate(baseDate.getDate() - offset)
  start.setHours(0, 0, 0, 0)
  return start
}

function getWeekDates(weekStartTime) {
  const start = new Date(weekStartTime)

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function getNextResetDate() {
  const now = new Date()
  const nextReset = new Date(now)
  nextReset.setHours(0, 0, 0, 0)

  const daysToWednesday = (3 - nextReset.getDay() + 7) % 7
  nextReset.setDate(nextReset.getDate() + (daysToWednesday === 0 ? 7 : daysToWednesday))

  return nextReset
}

function timeToMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// 화요일 00:00은 수요일 00:00(주간 리셋)과 같은 시각이라, 시작하는 순간 사라져서 신청을 받지 않는다.
function isResetOverlapSlot(day, time) {
  return day === '화' && time === '00:00'
}

// 저장 값 00:00은 그 요일 밤 12시라서 화면에는 24:00으로 보여 준다.
function formatTimeLabel(time) {
  return time === '00:00' ? '24:00' : time
}

function buildEmptyDayTimeSelection() {
  return Object.fromEntries(weekdayNames.map((day) => [day, []]))
}

function normalizeDayTimeSelection(rawSelection) {
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

function getSelectedDayList(dayTimeSelection) {
  return Object.entries(dayTimeSelection ?? {})
    .filter(([day, times]) => weekdayNames.includes(day) && Array.isArray(times) && times.length > 0)
    .map(([day]) => day)
}

function getCombinedTimes(dayTimeSelection) {
  return [...new Set(Object.values(dayTimeSelection ?? {}).flat().filter((time) => timeSlots.includes(time)))].sort(
    (a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b),
  )
}

// 저장된 레코드에서 요일별 시간 선택을 복원한다.
// 요일별 데이터가 없는 이전 레코드는 days × times 조합으로 복원한다.
function resolveDayTimeSelection(record) {
  const selection = normalizeDayTimeSelection(record.day_time_selection ?? record.dayTimeSelection)

  if (getSelectedDayList(selection).length > 0) {
    return selection
  }

  const legacyDays = Array.isArray(record.days) ? record.days : []
  const legacyTimes = Array.isArray(record.times) ? record.times : []

  return normalizeDayTimeSelection(Object.fromEntries(legacyDays.map((day) => [day, legacyTimes])))
}

// 스케줄을 구분하는 키 (레이드 · 난이도 · 공략 방식).
function getScheduleKey(entry) {
  return `${entry.raidName}|${entry.difficulty}|${entry.mode}`
}

// members 쪽에 남은 같은 스케줄(닉네임 · 레이드 조합). 스케줄을 지우거나 줄일 때 같이 맞춰야 캘린더에 반영된다.
function isScheduleMember(member, nickname, target) {
  return member.nickname === nickname
    && getRaidLabel(member.raidFocus) === target.raidName
    && (member.difficulty ?? getDifficultyForRaid(target.raidName)) === target.difficulty
    && (member.mode ?? '트라이') === target.mode
}

// 스케줄 키 "무스펠|어려움|트라이"를 "무스펠 · 어려움 · 트라이"로 표시한다.
function formatScheduleKey(key) {
  return key.split('|').join(' · ')
}

// 시간 삭제 대상 { entry, day, time }을 "목요일 19:00" / "목요일 전체" 형태로 표시한다. (time이 null이면 그 요일 전체)
function describePendingSlot({ day, time }) {
  return `${day}요일 ${time ? formatTimeLabel(time) : '전체'}`
}

// 요일별 시간 선택을 "목 19:00 / 금 20:00, 21:00" 형태로 표시한다.
function formatDayTimeSelection(dayTimeSelection) {
  return weekdayNames
    .filter((day) => (dayTimeSelection?.[day] ?? []).length > 0)
    .map((day) => `${day} ${[...dayTimeSelection[day]].sort((a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b)).map(formatTimeLabel).join(', ')}`)
    .join(' / ')
}

// 요일별 시간 선택을 [요일, 시간] 쌍 목록으로 펼친다.
function getDayTimePairs(dayTimeSelection) {
  return Object.entries(dayTimeSelection ?? {}).flatMap(([day, times]) =>
    Array.isArray(times) ? times.map((time) => [day, time]) : [],
  )
}

// 이번 주 요일 · 시간을 실제 시각으로 바꾼다. 00:00은 그 요일 밤 12시(다음 날 0시)로 본다.
function getSlotStartDate(weekDates, day, time) {
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
function formatTimeUntil(diffMs) {
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
function getPowerValue(power) {
  const matched = String(power ?? '').match(/\d+/)
  return matched ? Number(matched[0]) : 0
}

// 한 타임 인원을 A/B 파티로 나눈다. people은 신청 순서로 정렬되어 있어야 한다. 앞의 10명이 정원이고 나머지는 대기다.
// 가능한 나눔을 모두 비교해 리딩 가능자 수 → 치유성 수 → 전투력 합 순으로 가장 고른 것을 고른다. (최대 252가지)
function buildBalancedParties(people) {
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
function compareSchedules(a, b) {
  const raidOrder = { 무스펠: 0, '비탄의 설원': 1 }
  const difficultyOrder = { 보통: 0, 어려움: 1 }

  return (raidOrder[a.raidName] ?? 99) - (raidOrder[b.raidName] ?? 99)
    || (difficultyOrder[a.difficulty] ?? 99) - (difficultyOrder[b.difficulty] ?? 99)
    || (a.mode ?? '').localeCompare(b.mode ?? '')
}

function buildDefaultMember(overrides = {}) {
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

function normalizeMemberRecord(member) {
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
function isSavedThisWeek(record, weekStartTime) {
  const savedTime = new Date(record.updatedAt).getTime()
  return Number.isNaN(savedTime) || savedTime >= weekStartTime
}

// 그 시간대에 처음 신청한 시각. 기록이 없는 예전 신청은 마지막 저장 시각으로 본다. (DB의 _raid_slot_roster와 같은 기준)
function getSlotSignedTime(record, day, time) {
  const signedTime = new Date(record.slotSignedAt?.[`${day}|${time}`] ?? record.updatedAt).getTime()
  return Number.isNaN(signedTime) ? 0 : signedTime
}

// 한 시간대 인원을 신청 순서로 정렬한다. 같은 시각이면 닉네임 코드값 순으로, 어느 화면에서든 순서가 같게 한다.
function compareSlotPeople(a, b) {
  if (a.signedTime !== b.signedTime) {
    return a.signedTime - b.signedTime
  }

  if (a.nickname === b.nickname) {
    return 0
  }

  return a.nickname < b.nickname ? -1 : 1
}

// 로컬 모드에서 DB 트리거(_stamp_slot_signed_at)와 같은 규칙으로 시간대별 신청 시각을 채운다.
function stampSlotSignedAt(previous, selection, nowIso, weekStartTime) {
  const wasThisWeek = Boolean(previous) && isSavedThisWeek(previous, weekStartTime)

  return Object.fromEntries(getDayTimePairs(selection).map(([day, time]) => {
    const slotKey = `${day}|${time}`
    const kept = wasThisWeek
      ? previous.slotSignedAt?.[slotKey] ?? ((previous.dayTimeSelection?.[day] ?? []).includes(time) ? previous.updatedAt : null)
      : null

    return [slotKey, kept ?? nowIso]
  }))
}

function normalizeRaidScheduleEntry(entry) {
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

function loadLocalMembers() {
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

function saveLocalMembers(nextMembers) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMembers))
}

function loadLocalRaidSchedules() {
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

function saveLocalRaidSchedules(nextSchedules) {
  localStorage.setItem(RAID_SCHEDULES_STORAGE_KEY, JSON.stringify(nextSchedules))
}

// 지난 신청 보관 (raid_schedule_archive)
function loadLocalArchivedSchedules() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ARCHIVED_SCHEDULES_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeRaidScheduleEntry(entry)).filter(Boolean) : []
  } catch {
    return []
  }
}

function saveLocalArchivedSchedules(nextSchedules) {
  try {
    localStorage.setItem(ARCHIVED_SCHEDULES_STORAGE_KEY, JSON.stringify(nextSchedules))
  } catch {
    // Ignore storage errors.
  }
}

// 보관 목록에 지난 신청을 합친다. 캐릭터 · 레이드 조합마다 가장 최근에 저장된 것 한 건만 남긴다.
// 바뀐 것이 없으면 prev를 그대로 돌려준다.
function mergeArchivedSchedules(prev, entries) {
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
function formatDateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function getRaidRunKey(run) {
  return [run.weekStart, run.day, run.time, run.raidName, run.difficulty, run.mode].join('|')
}

function normalizeRaidRun(entry) {
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

function loadLocalRaidRuns() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RAID_RUNS_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.map((entry) => normalizeRaidRun(entry)).filter(Boolean) : []
  } catch {
    return []
  }
}

function saveLocalRaidRuns(nextRuns) {
  try {
    localStorage.setItem(RAID_RUNS_STORAGE_KEY, JSON.stringify(nextRuns))
  } catch {
    // Ignore storage errors.
  }
}

// 기록 목록에서 한 건을 바꾸거나 추가한다.
function upsertRaidRun(runs, nextRun) {
  const key = getRaidRunKey(nextRun)
  const index = runs.findIndex((run) => getRaidRunKey(run) === key)

  if (index < 0) {
    return [...runs, nextRun]
  }

  const nextRuns = [...runs]
  nextRuns[index] = nextRun
  return nextRuns
}

function readStoredLoginNickname() {
  try {
    return localStorage.getItem(LOGIN_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeStoredLoginNickname(nextNickname) {
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

function readStoredLoginPassword() {
  try {
    return localStorage.getItem(SAVED_PASSWORD_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeStoredLoginPassword(nextPassword) {
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

function buildEmptyPasswordForm() {
  return { current: '', next: '', confirm: '', hintQuestion: '', hintAnswer: '', error: '', message: '' }
}

// 본캐 · 부캐 연결 목록. 실패하거나 로컬 모드면 null (부캐 기능은 Supabase 모드 전용)
async function fetchMemberAlts() {
  if (!supabase) {
    return null
  }

  const { data, error } = await supabase.from('member_alts').select('alt_nickname, owner_nickname')

  if (error || !Array.isArray(data)) {
    return null
  }

  return data.map((row) => ({ altNickname: row.alt_nickname, ownerNickname: row.owner_nickname }))
}

// 리딩 O/X 표시. 글꼴·화면 배율에 따라 글자가 틀어지지 않도록 SVG로 그린다.
function LeadMark({ value }) {
  return (
    <svg className="lead-mark" viewBox="0 0 10 10" aria-hidden="true">
      {value === 'O' ? <circle cx="5" cy="5" r="3.1" /> : <path d="M2.5 2.5 7.5 7.5 M7.5 2.5 2.5 7.5" />}
    </svg>
  )
}

// 탭 옆 신청 인원 수. 0명이면 흐리게 보여 준다.
function TabCount({ count }) {
  return (
    <span className={`tab-count ${count > 0 ? '' : 'is-zero'}`} aria-label={`${count}명`}>
      {count}
    </span>
  )
}

// 1초마다 바뀌는 표시는 이 작은 컴포넌트들만 다시 그린다. (화면 전체는 1분마다만 다시 계산한다)
function useSecondTicker() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return now
}

function LiveClock() {
  const now = useSecondTicker()
  return <strong>{now.toLocaleString('ko-KR')}</strong>
}

function ResetCountdown() {
  const now = useSecondTicker()
  const nextReset = getNextResetDate()
  const totalSeconds = Math.max(0, Math.floor((nextReset.getTime() - now.getTime()) / 1000))
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  return (
    <>
      <strong>{nextReset.toLocaleString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
      <small>
        {days}일 {hours}시간 {minutes}분 {seconds}초 후
      </small>
    </>
  )
}

// 멤버 칩에 마우스를 올리면 보이는 상세 정보. (터치 기기에서는 칩을 누르면 같은 내용을 팝업으로 보여 준다)
function MemberTooltip({ member, ownerNickname, showLead = false }) {
  return (
    <span className="member-hover-tooltip" aria-hidden="true">
      <span className="tooltip-header-row">
        <img src={getClassIconPath(member.className)} alt={member.className} className="tooltip-icon" />
        <strong>{member.nickname}</strong>
        {showLead && member.leadReady === 'O' && <span className="tooltip-lead-label">리딩 가능</span>}
      </span>
      <span className="tooltip-power">{member.power}</span>
      {ownerNickname && <span className="tooltip-alt-owner">{ownerNickname}의 부캐</span>}
    </span>
  )
}

function App() {
  // 화면 계산에 쓰는 현재 시각. 1분마다만 바뀐다. (초 단위 시계는 LiveClock · ResetCountdown이 따로 그린다)
  const [currentTime, setCurrentTime] = useState(() => new Date())
  // 페이지를 켜 둔 채 수요일 00시가 지나면 새 주로 넘어가도록 현재 시각에서 주 시작을 다시 계산한다.
  const weekStartTime = getWeekStart(currentTime).getTime()
  const weekDates = useMemo(() => getWeekDates(weekStartTime), [weekStartTime])
  const todayStartTime = new Date(currentTime).setHours(0, 0, 0, 0)
  const [holidaySet, setHolidaySet] = useState(() => buildFallbackHolidaySet(new Date().getFullYear()))
  const [activeRaidTab, setActiveRaidTab] = useState('무스펠 보통')
  const [activeModeTab, setActiveModeTab] = useState('트라이')
  // 로그인 직후 주간 슬롯 탭을 내 스케줄로 맞춰 둔 닉네임 (한 번만 맞춘다)
  const [calendarTabAutoNickname, setCalendarTabAutoNickname] = useState('')
  const [helpOpen, setHelpOpen] = useState(false)
  const [calendarHelpOpen, setCalendarHelpOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState(MOBILE_SECTIONS[0].id)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // 요일별 신청 현황에서 펼쳐 둔 시간 줄 ("요일-레이드조합-시간" → true)
  const [expandedSummaryRows, setExpandedSummaryRows] = useState({})
  // 요일별 신청 현황에서 펼쳐 둔 지난 요일 ("수" → true). 지난 요일은 기본으로 접혀 있다.
  const [expandedPastDays, setExpandedPastDays] = useState({})
  const pastDayNames = weekdayNames.filter((_, index) => weekDates[index].getTime() < todayStartTime)
  const areAllPastDaysExpanded = pastDayNames.length > 0 && pastDayNames.every((day) => expandedPastDays[day])
  const [loggedInNickname, setLoggedInNickname] = useState('')
  const [loginNickname, setLoginNickname] = useState(() => readStoredLoginNickname())
  const [rememberMe, setRememberMe] = useState(() => Boolean(readStoredLoginNickname()))
  const [savePassword, setSavePassword] = useState(() => Boolean(readStoredLoginPassword()))
  const [loginPassword, setLoginPassword] = useState(() => readStoredLoginPassword())
  const [loginError, setLoginError] = useState('')
  const [isLoginPending, setIsLoginPending] = useState(false)
  // 비밀번호를 저장해 둔 기기는 접속하자마자 로그인을 시도한다.
  const [isAutoLoggingIn, setIsAutoLoggingIn] = useState(() => Boolean(readStoredLoginNickname() && readStoredLoginPassword()))
  const autoLoginStartedRef = useRef(false)
  // 현황 불러오기 상태: 'loading' | 'ready' | 'error'. '신청 없음'과 '아직 못 불러옴'을 구분한다.
  const [dataLoadState, setDataLoadState] = useState(() => (supabase ? 'loading' : 'ready'))
  // 이 값이 바뀌면 준비 / 클리어 기록을 다시 불러온다.
  const [raidRunsReloadTick, setRaidRunsReloadTick] = useState(0)
  const lastRemoteLoadRef = useRef(0)
  // 다 채운 '내 캐릭터'는 한 줄로 접어 둔다. 고치는 동안에는 펼친다.
  const [characterEditOpen, setCharacterEditOpen] = useState(false)
  // 로그인한 사람의 비밀번호. 저장·삭제할 때 DB가 다시 확인하므로 메모리에만 들고 있는다.
  const [sessionPassword, setSessionPassword] = useState('')
  // 본캐에 연결된 부캐 목록: [{ altNickname, ownerNickname }] (누구나 읽을 수 있어 캘린더에 "OO의 부캐"로도 쓴다)
  const [memberAlts, setMemberAlts] = useState([])
  // 신청 폼에서 고른 캐릭터. ''이면 로그인한 본캐.
  const [activeCharacter, setActiveCharacter] = useState('')
  const [altManagerOpen, setAltManagerOpen] = useState(false)
  const [altForm, setAltForm] = useState({ nickname: '', password: '', error: '', pending: false })
  // 초기 비밀번호로 들어온 경우의 개인 비밀번호 설정 단계: { nickname, currentPassword }
  const [passwordSetup, setPasswordSetup] = useState(null)
  // 비밀번호 찾기 단계: { nickname, question } (question이 null이면 닉네임 입력 단계)
  const [passwordReset, setPasswordReset] = useState(null)
  // 개인 비밀번호 설정 · 변경 · 찾기 폼 (세 화면이 같이 쓴다)
  const [passwordForm, setPasswordForm] = useState(() => buildEmptyPasswordForm())
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false)
  // 화면 아래에 잠깐 띄우는 알림: [{ id, message, type: 'info' | 'success' | 'error' }]
  const [toasts, setToasts] = useState([])
  // 터치 기기에서 멤버 칩을 눌렀을 때 띄우는 상세 정보
  const [memberDetail, setMemberDetail] = useState(null)
  // 레이드 조합을 고르기 전에 시간표를 눌렀으면 빠진 항목에 테두리를 두른다.
  const [showTargetWarning, setShowTargetWarning] = useState(false)
  // 지난 신청 불러오기 확인 팝업
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false)
  // 저장 · 불러오기 요청 중 (중복 클릭 방지)
  const [isSaving, setIsSaving] = useState(false)
  // 시간표를 끌어서 고르는 중이면 true(고르기) / false(지우기), 아니면 null
  const timeDragModeRef = useRef(null)
  // 시간표 칸을 마지막으로 누른 입력 장치 ('mouse' | 'touch' | 'pen')
  const timePointerTypeRef = useRef('')
  const [profile, setProfile] = useState(() => buildDefaultMember({ nickname: '나의닉네임' }))
  const [storedMembers, setMembers] = useState(() => loadLocalMembers())
  const [storedRaidSchedules, setRaidSchedules] = useState(() => loadLocalRaidSchedules())
  // 화면에는 이번 주에 저장된 신청만 보여 준다. (지난주 신청은 수요일 00시에 초기화)
  const members = useMemo(
    () =>
      storedMembers.map((member) =>
        isSavedThisWeek(member, weekStartTime)
          ? member
          : { ...member, days: [], times: [], dayTimeSelection: buildEmptyDayTimeSelection() },
      ),
    [storedMembers, weekStartTime],
  )
  const raidSchedules = useMemo(
    () => storedRaidSchedules.filter((entry) => isSavedThisWeek(entry, weekStartTime)),
    [storedRaidSchedules, weekStartTime],
  )
  // 지난주 이전 신청 (아직 덮어쓰이지 않은 것)
  const pastRaidSchedules = useMemo(
    () => storedRaidSchedules.filter((entry) => !isSavedThisWeek(entry, weekStartTime)),
    [storedRaidSchedules, weekStartTime],
  )
  // 덮어쓰이거나 지워진 지난 신청 보관 목록. DB 보관 기록과 화면에서 본 지난 신청을 모두 모은다.
  const [archivedSchedules, setArchivedSchedules] = useState(() => (supabase ? [] : loadLocalArchivedSchedules()))
  // 불러오기 팝업에서 고른 신청 키 (레이드 · 난이도 · 공략 방식)
  const [restoreSelectedKeys, setRestoreSelectedKeys] = useState([])
  const [showDaytimeSlots, setShowDaytimeSlots] = useState(false)
  // '내 스케줄 전체 삭제' 확인 팝업 (한 건 · 한 시간 삭제는 확인 없이 지우고 되돌리기를 띄운다)
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false)
  // 요일별 신청 현황에서 내가 신청한 시간대만 보기 (이 브라우저에 기억)
  const [showOnlyMine, setShowOnlyMine] = useState(() => {
    try {
      return localStorage.getItem(ONLY_MINE_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  // 모바일 주간 캘린더에서 보고 있는 요일 (weekdayNames 순서, 기본은 오늘)
  const [mobileCalendarDayIndex, setMobileCalendarDayIndex] = useState(() => (new Date().getDay() + 4) % 7)
  // 추천 시간을 눌러 잠깐 강조할 캘린더 칸 ("요일-시간")
  const [highlightedSlotKey, setHighlightedSlotKey] = useState('')
  // 저장 전 수정 중인 요일/시간 선택 (레이드 · 난이도 · 공략 방식 조합별)
  const [dayTimeDrafts, setDayTimeDrafts] = useState({})
  // 이번 주(수요일 시작) 시간대별 준비 / 클리어 기록
  const weekStartKey = useMemo(() => formatDateKey(weekDates[0]), [weekDates])
  const [raidRuns, setRaidRuns] = useState(() => (supabase ? [] : loadLocalRaidRuns()))
  // 디스코드 알림이 가거나 기록이 지워지는 동작 전 확인 팝업 대상: { run, action: 'call' | 'cancel' | 'cleared', alreadyNotified }
  const [pendingRunStatus, setPendingRunStatus] = useState(null)
  // 저장 중인 기록 키 (중복 클릭 방지)
  const [savingRunKey, setSavingRunKey] = useState('')

  useEffect(() => {
    let isMounted = true

    // 연말 주간은 다음 해 날짜까지 걸치므로 두 해를 함께 불러온다.
    const year = new Date().getFullYear()

    Promise.all([getHolidaySetForYear(year), getHolidaySetForYear(year + 1)])
      .then(([thisYearSet, nextYearSet]) => {
        if (isMounted) {
          setHolidaySet(new Set([...thisYearSet, ...nextYearSet]))
        }
      })
      .catch(() => {
        if (isMounted) {
          setHolidaySet(buildFallbackHolidaySet(year))
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  // 신청 · 인원 · 보관 기록을 DB에서 다시 불러온다. 실패해도 지금 보이는 내용은 그대로 둔다.
  const loadRemoteData = useCallback(async () => {
    if (!supabase) {
      return
    }

    lastRemoteLoadRef.current = Date.now()

    try {
      const [membersResult, schedulesResult, archiveResult] = await Promise.all([
        supabase.from('members').select('*').order('updated_at', { ascending: false }),
        supabase.from('raid_schedules').select('*').order('updated_at', { ascending: false }),
        supabase.from('raid_schedule_archive').select('*'),
      ])

      if (membersResult.error || schedulesResult.error) {
        setDataLoadState('error')
        return
      }

      setMembers((membersResult.data ?? []).map((member) => normalizeMemberRecord(member)).filter(Boolean))
      setRaidSchedules((schedulesResult.data ?? []).map((entry) => normalizeRaidScheduleEntry(entry)).filter(Boolean))

      // 보관 테이블은 SQL을 실행하기 전에는 없을 수 있어 실패로 치지 않는다.
      if (!archiveResult.error && Array.isArray(archiveResult.data)) {
        const archived = archiveResult.data.map((entry) => normalizeRaidScheduleEntry(entry)).filter(Boolean)
        setArchivedSchedules((prev) => mergeArchivedSchedules(prev, archived))
      }

      setDataLoadState('ready')
    } catch {
      setDataLoadState('error')
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      saveLocalMembers(storedMembers)
      saveLocalRaidSchedules(storedRaidSchedules)
      return
    }

    loadRemoteData()
    fetchMemberAlts().then((alts) => alts && setMemberAlts(alts))

    const memberChannel = supabase
      .channel('members-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members' },
        (payload) => {
          // 삭제 이벤트는 new가 빈 객체이고, old에는 기본 키(id)만 온다.
          if (payload.eventType === 'DELETE') {
            setMembers((prev) => prev.filter((member) => member.id !== payload.old?.id))
            return
          }

          const nextMember = normalizeMemberRecord(payload.new)

          setMembers((prev) => {
            const exists = prev.findIndex((member) => member.nickname === nextMember.nickname)

            if (exists >= 0) {
              const updated = [...prev]
              updated[exists] = nextMember
              return updated
            }

            return [nextMember, ...prev]
          })
        },
      )
      .subscribe()

    const raidScheduleChannel = supabase
      .channel('raid-schedules-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'raid_schedules' },
        (payload) => {
          // 삭제 이벤트는 new가 빈 객체이고, old에는 기본 키(id)만 온다.
          if (payload.eventType === 'DELETE') {
            setRaidSchedules((prev) => prev.filter((entry) => entry.id !== payload.old?.id))
            return
          }

          const nextEntry = normalizeRaidScheduleEntry(payload.new)

          setRaidSchedules((prev) => {
            const exists = prev.findIndex((entry) => entry.nickname === nextEntry.nickname && entry.raidName === nextEntry.raidName && entry.difficulty === nextEntry.difficulty && entry.mode === nextEntry.mode)

            if (exists >= 0) {
              const updated = [...prev]
              updated[exists] = nextEntry
              return updated
            }

            return [nextEntry, ...prev]
          })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(memberChannel)
      supabase.removeChannel(raidScheduleChannel)
    }
  }, [loadRemoteData])

  // 다른 앱을 보다 돌아오거나 네트워크가 다시 연결되면 놓친 변경을 불러온다.
  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    const refreshIfStale = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastRemoteLoadRef.current < REFRESH_MIN_INTERVAL_MS) {
        return
      }

      setCurrentTime(new Date())
      setRaidRunsReloadTick((prev) => prev + 1)
      loadRemoteData()
      fetchMemberAlts().then((alts) => alts && setMemberAlts(alts))
    }

    document.addEventListener('visibilitychange', refreshIfStale)
    window.addEventListener('focus', refreshIfStale)
    window.addEventListener('online', refreshIfStale)

    return () => {
      document.removeEventListener('visibilitychange', refreshIfStale)
      window.removeEventListener('focus', refreshIfStale)
      window.removeEventListener('online', refreshIfStale)
    }
  }, [loadRemoteData])

  useEffect(() => {
    if (!supabase) {
      saveLocalMembers(storedMembers)
      saveLocalRaidSchedules(storedRaidSchedules)
    }
  }, [storedMembers, storedRaidSchedules])

  useEffect(() => {
    if (!supabase) {
      saveLocalRaidRuns(raidRuns)
    }
  }, [raidRuns])

  // 화면에 보이는 지난 신청을 보관 목록에 모아 둔다.
  // 다시 등록해서 덮어쓰거나 지운 뒤에도 불러오기 목록에 남기기 위해서다. (DB에서는 트리거가 같은 일을 한다)
  useEffect(() => {
    setArchivedSchedules((prev) => mergeArchivedSchedules(prev, pastRaidSchedules))
  }, [pastRaidSchedules])

  useEffect(() => {
    if (!supabase) {
      saveLocalArchivedSchedules(archivedSchedules)
    }
  }, [archivedSchedules])

  // 이번 주 준비 / 클리어 기록을 불러온다.
  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    let isMounted = true

    supabase
      .from('raid_runs')
      .select('*')
      .eq('week_start', weekStartKey)
      .then(({ data, error }) => {
        if (isMounted && !error && Array.isArray(data)) {
          setRaidRuns(data.map((entry) => normalizeRaidRun(entry)).filter(Boolean))
        }
      })

    return () => {
      isMounted = false
    }
  }, [weekStartKey, raidRunsReloadTick])

  // 다른 사람이 준비 / 클리어 기록을 바꾸면 바로 반영한다.
  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    const raidRunChannel = supabase
      .channel('raid-runs-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'raid_runs' },
        (payload) => {
          const nextRun = normalizeRaidRun(payload.new)

          if (nextRun?.weekStart === weekStartKey) {
            setRaidRuns((prev) => upsertRaidRun(prev, nextRun))
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(raidRunChannel)
    }
  }, [weekStartKey])

  useEffect(() => {
    // 분이 바뀌었을 때만 새 시각을 넣는다. (같은 값이면 다시 그리지 않는다)
    const timer = setInterval(() => {
      setCurrentTime((prev) => (
        Math.floor(prev.getTime() / 60000) === Math.floor(Date.now() / 60000) ? prev : new Date()
      ))
    }, 5000)

    return () => clearInterval(timer)
  }, [])

  // 시간표를 끌다가 어디서든 손을 떼면 끌기를 끝낸다.
  useEffect(() => {
    const stopTimeDrag = () => {
      timeDragModeRef.current = null
    }

    window.addEventListener('pointerup', stopTimeDrag)
    window.addEventListener('pointercancel', stopTimeDrag)
    return () => {
      window.removeEventListener('pointerup', stopTimeDrag)
      window.removeEventListener('pointercancel', stopTimeDrag)
    }
  }, [])

  // key를 주면 같은 key의 알림은 쌓지 않고 새 알림으로 바꾼다. (나중에 key로 한꺼번에 지울 수도 있다)
  // action: { label, onClick } 을 주면 알림 안에 버튼(예: 되돌리기)을 달고 조금 더 오래 띄운다.
  const showToast = (message, type = 'info', key = '', action = null) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`

    // 한꺼번에 많이 쌓이지 않게 최근 3개만 둔다.
    setToasts((prev) => [...prev.filter((toast) => !key || toast.key !== key).slice(-2), { id, message, type, key, action }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id))
    }, action ? TOAST_ACTION_DURATION : (TOAST_DURATION[type] ?? TOAST_DURATION.info))
  }

  const dismissToast = (id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id))
  }

  // 멤버 칩을 누르면 터치 기기에서만 상세 팝업을 연다. (마우스는 올리기만 해도 툴팁이 보인다)
  const getMemberPillProps = (member) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => {
      if (window.matchMedia?.('(hover: none)').matches) {
        setMemberDetail(member)
      }
    },
  })

  const visibleRaidTabs = useMemo(
    () =>
      raidTabOptions.filter((tab) => {
        const availableDifficulties = raidDifficultyAvailability[tab.raid] ?? [tab.difficulty]
        return availableDifficulties.includes(tab.difficulty)
      }),
    [],
  )

  useEffect(() => {
    if (!visibleRaidTabs.some((tab) => tab.label === activeRaidTab)) {
      setActiveRaidTab(visibleRaidTabs[0]?.label ?? '무스펠 보통')
    }
  }, [activeRaidTab, visibleRaidTabs])

  // 그 날짜에 있는 시간 줄. 주말과 공휴일은 낮시간까지 있다. 입력 폼과 캘린더가 함께 쓴다.
  const getDayTimeSlots = (date) => {
    const day = date.getDay()
    const isWeekendOrHoliday = day === 0 || day === 6 || holidaySet.has(formatIsoDate(date))
    const slots = !isWeekendOrHoliday
      ? weekdayTimeSlots
      : showDaytimeSlots ? weekendTimeSlots : weekendTimeSlots.filter((time) => !hiddenWeekdayTimeSlots.includes(time))

    return day === 2 ? slots.filter((time) => !isResetOverlapSlot('화', time)) : slots
  }

  const getSelectableTimesForSelectedDay = (day) => {
    const dayIndex = weekdayNames.indexOf(day)
    return dayIndex < 0 ? weekdayTimeSlots : getDayTimeSlots(weekDates[dayIndex])
  }

  // 이번 주에서 이미 지난 시간대인지 (시작하고 RAID_ONGOING_MS가 지나면 지난 것으로 본다)
  const isPastSlot = (day, time) => (
    getSlotStartDate(weekDates, day, time).getTime() + RAID_ONGOING_MS <= currentTime.getTime()
  )

  // 입력 폼 시간표의 시간 줄. 낮시간(12~16시)은 켰을 때만 보여 준다.
  const formTimeRows = timeSlots.filter((time) => showDaytimeSlots || !hiddenWeekdayTimeSlots.includes(time))

  // 폼에서 고른 레이드 · 난이도 · 공략 방식. 요일/시간 선택은 이 조합마다 따로 관리한다.
  // 지금 신청 · 삭제하는 캐릭터 (본캐 또는 고른 부캐)
  const currentNickname = (activeCharacter || loggedInNickname || profile.nickname).trim()
  const altOwnerByNickname = useMemo(
    () => new Map(memberAlts.map(({ altNickname, ownerNickname }) => [altNickname, ownerNickname])),
    [memberAlts],
  )
  const myAltNicknames = useMemo(
    () => memberAlts
      .filter(({ ownerNickname }) => ownerNickname === loggedInNickname)
      .map(({ altNickname }) => altNickname)
      .sort((a, b) => a.localeCompare(b)),
    [memberAlts, loggedInNickname],
  )
  // 로그인한 사람이 움직일 수 있는 캐릭터 (본캐 + 부캐). 준비 · 클리어 표시와 중복 시간 확인에 쓴다.
  const myCharacters = useMemo(
    () => (loggedInNickname ? [loggedInNickname, ...myAltNicknames] : [currentNickname]),
    [loggedInNickname, myAltNicknames, currentNickname],
  )
  const selectedRaidLabel = profile.raidFocus ? getRaidLabel(profile.raidFocus) : ''
  const currentScheduleTarget = {
    raidName: selectedRaidLabel,
    difficulty: profile.difficulty,
    mode: profile.mode,
  }
  // 레이드 · 난이도 · 공략 방식을 모두 골라야 요일/시간을 선택할 수 있다.
  const isScheduleTargetSelected = Boolean(currentScheduleTarget.raidName && currentScheduleTarget.difficulty && currentScheduleTarget.mode)
  const currentScheduleKey = isScheduleTargetSelected ? getScheduleKey(currentScheduleTarget) : null
  const savedCurrentSchedule = currentScheduleKey
    ? raidSchedules.find((entry) => entry.nickname === currentNickname && getScheduleKey(entry) === currentScheduleKey)
    : null
  // 저장 전 수정 중인 선택 > 저장된 선택 > 빈 선택 순으로 보여준다.
  const currentDayTimeSelection = (currentScheduleKey && dayTimeDrafts[currentScheduleKey])
    ?? savedCurrentSchedule?.dayTimeSelection
    ?? buildEmptyDayTimeSelection()
  const currentSelectedDays = getSelectedDayList(currentDayTimeSelection)

  // 같은 계정(본캐 + 부캐)이 이번 주에 이미 참여로 신청한 시간 ("요일|시간" → 그 신청).
  // 지금 고치고 있는 스케줄(같은 캐릭터 · 같은 레이드 조합)은 덮어쓸 것이라 뺀다. DB의 _schedule_time_conflict와 같은 기준이다.
  const takenSlots = useMemo(() => {
    const map = new Map()

    raidSchedules.forEach((entry) => {
      if (
        entry.attendance !== '참'
        || !myCharacters.includes(entry.nickname)
        || (entry.nickname === currentNickname && getScheduleKey(entry) === currentScheduleKey)
      ) {
        return
      }

      getDayTimePairs(entry.dayTimeSelection).forEach(([day, time]) => {
        const slotKey = `${day}|${time}`

        if (!map.has(slotKey)) {
          map.set(slotKey, entry)
        }
      })
    })

    return map
  }, [raidSchedules, myCharacters, currentNickname, currentScheduleKey])

  // "부캐명 · 무스펠 보통 트라이" 처럼 겹친 신청을 알려 주는 문구
  const describeTakenSlot = (entry) => (
    `${entry.nickname === currentNickname ? '이 캐릭터' : entry.nickname} · ${entry.raidName} ${entry.difficulty} ${entry.mode}`
  )

  // 시간표 칸 여러 개를 한꺼번에 고르거나(shouldSelect) 지운다.
  // 그 요일에 없는 시간대, 이미 지난 시간, 같은 계정이 이미 신청한 시간은 새로 고를 수 없다. (골라 둔 것을 빼는 것은 된다)
  // 끌어서 빠르게 여러 칸을 바꿀 수 있어 이전 수정 상태(prev)를 기준으로 바꾼다.
  const setSlotSelection = (pairs, shouldSelect) => {
    if (!currentScheduleKey) {
      return
    }

    const scheduleKey = currentScheduleKey
    const savedSelection = savedCurrentSchedule?.dayTimeSelection

    setDayTimeDrafts((prev) => {
      const nextSelection = normalizeDayTimeSelection(prev[scheduleKey] ?? savedSelection)

      pairs.forEach(([day, time]) => {
        const dayTimes = nextSelection[day]

        if (!shouldSelect) {
          nextSelection[day] = dayTimes.filter((item) => item !== time)
          return
        }

        if (!dayTimes.includes(time) && getSelectableTimesForSelectedDay(day).includes(time) && !takenSlots.has(`${day}|${time}`) && !isPastSlot(day, time)) {
          nextSelection[day] = [...dayTimes, time]
        }
      })

      return { ...prev, [scheduleKey]: nextSelection }
    })
  }

  // 레이드 조합을 다 고르기 전에 시간표를 누르면 무엇을 먼저 골라야 하는지 알려 주고, 빠진 항목에 테두리를 두른다.
  const warnScheduleTargetMissing = () => {
    const missingLabels = [
      [selectedRaidLabel, '레이드'],
      [profile.difficulty, '난이도'],
      [profile.mode, '공략 방식'],
    ]
      .filter(([value]) => !value)
      .map(([, label]) => label)

    setShowTargetWarning(true)
    showToast(`${missingLabels.join(', ')}을(를) 먼저 골라 주세요.`, 'error', 'target-missing')
    // 빠진 항목이 화면 밖에 있을 때만 보이는 곳까지 스크롤한다. (시간표가 크게 밀려나지 않게)
    document.getElementById('schedule-target-field')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // 레이드 조합을 다 고르면 '먼저 골라 주세요' 알림과 테두리를 바로 없앤다. (남아 있으면 시간표가 안 눌리는 것처럼 보인다)
  useEffect(() => {
    if (!isScheduleTargetSelected) {
      return
    }

    setShowTargetWarning(false)
    setToasts((prev) => prev.filter((toast) => toast.key !== 'target-missing'))
  }, [isScheduleTargetSelected])

  // 이 칸을 새로 고를 수 없는 이유. 없으면 ''. 터치 기기는 title이 안 보이므로 눌렀을 때 알림으로도 띄운다.
  const getSlotBlockReason = (day, time, isSelected) => {
    if (isSelected) {
      return ''
    }

    const takenBy = takenSlots.get(`${day}|${time}`)

    if (takenBy) {
      return `이미 신청한 시간이에요: ${describeTakenSlot(takenBy)}`
    }

    return isPastSlot(day, time) ? '이미 지난 시간이라 고를 수 없어요.' : ''
  }

  // 마우스로 시간표 칸을 누르면 그 칸을 바꾸고, 누른 채 끌면 지나가는 칸에도 같은 동작을 한다.
  // 터치는 화면을 스크롤하다 칸이 바뀌지 않도록 손을 뗀 탭(click)에서만 바꾼다.
  const startTimeDrag = (event, day, time, isSelected) => {
    timePointerTypeRef.current = event.pointerType

    if (event.pointerType !== 'mouse' || event.button !== 0) {
      return
    }

    event.preventDefault()

    if (!isScheduleTargetSelected) {
      warnScheduleTargetMissing()
      return
    }

    const blockReason = getSlotBlockReason(day, time, isSelected)

    if (blockReason) {
      showToast(blockReason, 'info', 'slot-blocked')
      return
    }

    timeDragModeRef.current = !isSelected
    setSlotSelection([[day, time]], !isSelected)
  }

  const handleTimeCellClick = (event, day, time, isSelected) => {
    // 마우스는 누를 때 이미 바꿨다. (키보드로 누르면 detail이 0)
    if (event.detail !== 0 && timePointerTypeRef.current === 'mouse') {
      return
    }

    if (!isScheduleTargetSelected) {
      warnScheduleTargetMissing()
      return
    }

    const blockReason = getSlotBlockReason(day, time, isSelected)

    if (blockReason) {
      showToast(blockReason, 'info', 'slot-blocked')
      return
    }

    setSlotSelection([[day, time]], !isSelected)
  }

  const continueTimeDrag = (event, day, time) => {
    if (timeDragModeRef.current === null || event.buttons !== 1) {
      return
    }

    setSlotSelection([[day, time]], timeDragModeRef.current)
  }

  // 요일 · 시간 머리를 누르면 그 줄에서 고를 수 있는 칸을 모두 고른다. 이미 다 골라져 있으면 모두 지운다.
  const toggleTimeLine = (pairs) => {
    if (!isScheduleTargetSelected) {
      warnScheduleTargetMissing()
      return
    }

    const selectablePairs = pairs.filter(([day, time]) => (
      getSelectableTimesForSelectedDay(day).includes(time)
      && ((currentDayTimeSelection[day] ?? []).includes(time) || (!takenSlots.has(`${day}|${time}`) && !isPastSlot(day, time)))
    ))

    if (selectablePairs.length === 0) {
      return
    }

    const isAllSelected = selectablePairs.every(([day, time]) => (currentDayTimeSelection[day] ?? []).includes(time))
    setSlotSelection(selectablePairs, !isAllSelected)
  }
  const activeTabMeta = visibleRaidTabs.find((tab) => tab.label === activeRaidTab) ?? visibleRaidTabs[0] ?? raidTabOptions[0]

  const hasActiveScheduleSelection = (entry) => {
    if (!entry || entry.attendance !== '참') {
      return false
    }

    const days = Array.isArray(entry.days) ? entry.days : []
    const times = Array.isArray(entry.times) ? entry.times : []
    return days.length > 0 && times.length > 0
  }

  const allScheduleEntries = useMemo(() => {
    const merged = [
      ...raidSchedules
        .filter((entry) => hasActiveScheduleSelection(entry))
        .map((entry) => ({
          nickname: entry.nickname,
          className: entry.className ?? '수호성',
          power: entry.power ?? '600~700k',
          leadReady: normalizeLeadReady(entry.leadReady ?? 'X'),
          raidName: entry.raidName,
          difficulty: entry.difficulty,
          mode: entry.mode,
          days: entry.days,
          times: entry.times,
          dayTimeSelection: entry.dayTimeSelection,
          attendance: entry.attendance,
        })),
      ...members
        .filter((member) => hasActiveScheduleSelection(member))
        .map((member) => ({
          nickname: member.nickname,
          className: member.className ?? '수호성',
          power: member.power ?? '600~700k',
          leadReady: normalizeLeadReady(member.leadReady ?? 'X'),
          raidName: getRaidLabel(member.raidFocus),
          difficulty: member.difficulty ?? getDifficultyForRaid(getRaidLabel(member.raidFocus)),
          mode: member.mode ?? '트라이',
          days: member.days,
          times: member.times,
          dayTimeSelection: member.dayTimeSelection,
          attendance: member.attendance,
        })),
    ]

    const uniqueEntries = new Map()

    merged.forEach((entry) => {
      const key = `${entry.nickname}|${entry.raidName}|${entry.difficulty}|${entry.mode}`
      const existingEntry = uniqueEntries.get(key)

      if (!existingEntry) {
        uniqueEntries.set(key, entry)
        return
      }

      uniqueEntries.set(key, {
        ...existingEntry,
        ...entry,
        className: entry.className || existingEntry.className,
        power: entry.power || existingEntry.power,
        leadReady: normalizeLeadReady(entry.leadReady || existingEntry.leadReady),
        days: entry.days.length > 0 ? entry.days : existingEntry.days,
        times: entry.times.length > 0 ? entry.times : existingEntry.times,
        dayTimeSelection: entry.days.length > 0 ? entry.dayTimeSelection : existingEntry.dayTimeSelection,
      })
    })

    return [...uniqueEntries.values()]
  }, [members, raidSchedules])

  const myScheduleSet = useMemo(() => {
    const tabRaidName = activeTabMeta?.raid ?? '무스펠'
    const tabDifficulty = activeTabMeta?.difficulty ?? '보통'
    const tabMode = activeModeTab ?? '트라이'
    const tabKey = getScheduleKey({ raidName: tabRaidName, difficulty: tabDifficulty, mode: tabMode })
    const nextSet = new Set()

    // 폼에서 수정 중인 레이드 탭이면 저장 전 선택을 바로 보여준다.
    if (tabKey === currentScheduleKey) {
      getDayTimePairs(currentDayTimeSelection).forEach(([day, time]) => {
        nextSet.add(`${day}-${time}`)
      })

      return nextSet
    }

    allScheduleEntries
      .filter((entry) => entry.nickname === currentNickname && getScheduleKey(entry) === tabKey)
      .forEach((entry) => {
        getDayTimePairs(entry.dayTimeSelection).forEach(([day, time]) => {
          nextSet.add(`${day}-${time}`)
        })
      })

    return nextSet
  }, [activeModeTab, activeTabMeta, allScheduleEntries, currentDayTimeSelection, currentNickname, currentScheduleKey])

  const isSharedMode = Boolean(supabase)

  const memberByRaidDifficulty = useMemo(() => {
    const map = new Map()

    allScheduleEntries.forEach((entry) => {
      if (!hasActiveScheduleSelection(entry)) return

      const key = `${entry.raidName} / ${entry.difficulty} / ${entry.mode}`
      const current = map.get(key) ?? {
        raidName: entry.raidName,
        difficulty: entry.difficulty,
        mode: entry.mode,
        members: [],
        days: [],
        times: [],
      }

      const memberExists = current.members.some(
        (member) => member.nickname === entry.nickname && member.className === entry.className,
      )

      if (!memberExists) {
        current.members.push({
          nickname: entry.nickname,
          className: entry.className,
          power: entry.power ?? '600~700k',
          leadReady: normalizeLeadReady(entry.leadReady ?? 'X'),
          days: entry.days,
          times: entry.times,
        })
      }

      current.days = [...new Set([...current.days, ...entry.days])]
      current.times = [...new Set([...current.times, ...entry.times])]

      map.set(key, current)
    })

    return [...map.values()].sort((a, b) => {
      const raidOrder = { 무스펠: 0, '비탄의 설원': 1 }
      const raidDiff = (raidOrder[a.raidName] ?? 99) - (raidOrder[b.raidName] ?? 99)
      if (raidDiff !== 0) return raidDiff

      const difficultyOrder = { 보통: 0, 어려움: 1 }
      const difficultyDiff = (difficultyOrder[a.difficulty] ?? 99) - (difficultyOrder[b.difficulty] ?? 99)
      if (difficultyDiff !== 0) return difficultyDiff

      return (a.mode ?? '').localeCompare(b.mode ?? '')
    })
  }, [allScheduleEntries])

  const dayRaidSummary = useMemo(() => {
    return weekdayNames.map((day) => {
      const dayMembers = allScheduleEntries.filter(
        (entry) => entry.attendance === '참' && entry.days.includes(day),
      )

      const raidGroups = new Map()

      dayMembers.forEach((entry) => {
        const key = `${entry.raidName} / ${entry.difficulty} / ${entry.mode}`

        const existing = raidGroups.get(key) ?? {
          label: key,
          raidName: entry.raidName,
          difficulty: entry.difficulty,
          mode: entry.mode,
          times: new Set(),
          timeMembers: new Map(),
          members: [],
        }

        // 시간대별로 어떤 인원이 투표했는지 함께 모은다.
        const memberKey = `${entry.nickname}|${entry.className}`
        const dayTimes = entry.dayTimeSelection?.[day] ?? []
        dayTimes.forEach((time) => {
          existing.times.add(time)
          const voters = existing.timeMembers.get(time) ?? new Set()
          voters.add(memberKey)
          existing.timeMembers.set(time, voters)
        })

        const memberExists = existing.members.some(
          (member) => member.nickname === entry.nickname && member.className === entry.className,
        )

        if (!memberExists) {
          existing.members.push({
            nickname: entry.nickname,
            className: entry.className,
            power: entry.power ?? '600~700k',
            leadReady: normalizeLeadReady(entry.leadReady ?? 'X'),
          })
        }

        raidGroups.set(key, existing)
      })

      return {
        day,
        raidGroups: [...raidGroups.values()].map((group) => ({
          label: group.label,
          raidName: group.raidName,
          difficulty: group.difficulty,
          mode: group.mode,
          // 투표 인원이 많은 시간대부터, 인원이 같으면 이른 시간부터
          times: [...group.times].sort((a, b) => (
            (group.timeMembers.get(b)?.size ?? 0) - (group.timeMembers.get(a)?.size ?? 0)
            || timeSlots.indexOf(a) - timeSlots.indexOf(b)
          )),
          timeMembers: Object.fromEntries(
            [...group.timeMembers].map(([time, voters]) => [time, [...voters]]),
          ),
          members: group.members,
        })),
      }
    })
  }, [allScheduleEntries])

  const raidRunByKey = useMemo(
    () => new Map(raidRuns.filter((run) => run.weekStart === weekStartKey).map((run) => [getRaidRunKey(run), run])),
    [raidRuns, weekStartKey],
  )

  const memberByRaidDateTime = useMemo(() => {
    const map = new Map()
    const scheduleEntries = [
      ...raidSchedules.map((entry) => ({
        nickname: entry.nickname,
        className: entry.className,
        power: entry.power,
        leadReady: entry.leadReady,
        raidName: entry.raidName,
        difficulty: entry.difficulty,
        mode: entry.mode,
        days: entry.days,
        times: entry.times,
        dayTimeSelection: entry.dayTimeSelection,
        attendance: entry.attendance,
        slotSignedAt: entry.slotSignedAt,
        updatedAt: entry.updatedAt,
      })),
      ...members
        .filter((member) => member.attendance === '참' && (member.days.length > 0 || member.times.length > 0))
        .map((member) => ({
          nickname: member.nickname,
          className: member.className,
          power: member.power ?? '600~700k',
          leadReady: normalizeLeadReady(member.leadReady ?? 'X'),
          raidName: getRaidLabel(member.raidFocus),
          difficulty: member.difficulty ?? getDifficultyForRaid(getRaidLabel(member.raidFocus)),
          mode: member.mode ?? '트라이',
          days: member.days,
          times: member.times,
          dayTimeSelection: member.dayTimeSelection,
          attendance: member.attendance,
          updatedAt: member.updatedAt,
        })),
    ]

    scheduleEntries.forEach((entry) => {
      if (!hasActiveScheduleSelection(entry)) return

      const tabKey = `${entry.raidName} ${entry.difficulty} ${entry.mode}`

      getDayTimePairs(entry.dayTimeSelection).forEach(([day, time]) => {
        const key = `${day}-${time}`
        const target = map.get(key) ?? {}
        const existing = target[tabKey] ?? []

        if (!existing.some((person) => person.nickname === entry.nickname && person.className === entry.className)) {
          existing.push({
            nickname: entry.nickname,
            className: entry.className,
            power: entry.power ?? '600~700k',
            leadReady: normalizeLeadReady(entry.leadReady ?? 'X'),
            signedTime: getSlotSignedTime(entry, day, time),
          })
        }

        target[tabKey] = existing
        map.set(key, target)
      })
    })

    // 시간대마다 먼저 신청한 사람부터 둔다. 앞의 10명이 정원이다.
    map.forEach((peopleByTab) => {
      Object.values(peopleByTab).forEach((people) => people.sort(compareSlotPeople))
    })

    return map
  }, [members, raidSchedules])

  // 내가 저장한 스케줄 목록 (레이드 → 난이도 → 공략 방식 순).
  const mySavedSchedules = useMemo(
    () => raidSchedules
      .filter((entry) => entry.nickname === currentNickname && entry.days.length > 0)
      .sort(compareSchedules),
    [currentNickname, raidSchedules],
  )

  // 지난주 이전에 저장해 둔 내 신청 중 이번 주에 같은 레이드 조합을 아직 저장하지 않은 것.
  // 수요일 리셋 뒤 골라서 다시 등록할 수 있게 한다. 다시 등록했다가 지운 신청도 보관 목록에서 다시 나온다.
  const restorableSchedules = useMemo(() => {
    const thisWeekKeys = new Set(
      raidSchedules.filter((entry) => entry.nickname === currentNickname).map((entry) => getScheduleKey(entry)),
    )

    return mergeArchivedSchedules(archivedSchedules, pastRaidSchedules)
      .filter((entry) => (
        entry.nickname === currentNickname
        && entry.attendance === '참'
        && entry.days.length > 0
        && !isSavedThisWeek(entry, weekStartTime)
        && !thisWeekKeys.has(getScheduleKey(entry))
      ))
      .sort(compareSchedules)
  }, [archivedSchedules, currentNickname, pastRaidSchedules, raidSchedules, weekStartTime])

  // 내 캐릭터(본캐 + 부캐)가 참여로 신청한 이번 주 시간대 중 아직 끝나지 않은 것 (가까운 순).
  // 1초마다 다시 계산하지 않도록 분 단위로만 갱신한다.
  const currentMinute = Math.floor(currentTime.getTime() / 60000)
  const myUpcomingSlots = useMemo(() => {
    const nowTime = currentMinute * 60000

    return raidSchedules
      .filter((entry) => entry.attendance === '참' && myCharacters.includes(entry.nickname))
      .flatMap((entry) => getDayTimePairs(entry.dayTimeSelection).map(([day, time]) => ({
        nickname: entry.nickname,
        raidName: entry.raidName,
        difficulty: entry.difficulty,
        mode: entry.mode,
        day,
        time,
        startTime: getSlotStartDate(weekDates, day, time).getTime(),
      })))
      .filter((slot) => slot.startTime + RAID_ONGOING_MS > nowTime)
      .sort((a, b) => a.startTime - b.startTime || compareSchedules(a, b))
  }, [currentMinute, myCharacters, raidSchedules, weekDates])

  // 탭별 신청 인원 ("무스펠 어려움 트라이" → 닉네임 Set). 레이드 · 공략 방식 탭에 인원 수로 보여 준다.
  const tabNicknames = useMemo(() => {
    const map = new Map()

    memberByRaidDateTime.forEach((peopleByTab) => {
      Object.entries(peopleByTab).forEach(([tabKey, people]) => {
        const nicknames = map.get(tabKey) ?? new Set()
        people.forEach((person) => nicknames.add(person.nickname))
        map.set(tabKey, nicknames)
      })
    })

    return map
  }, [memberByRaidDateTime])

  const countTabMembers = (raid, difficulty, modes) => (
    new Set(modes.flatMap((mode) => [...(tabNicknames.get(`${raid} ${difficulty} ${mode}`) ?? [])])).size
  )

  // 주간 레이드 슬롯 탭을 레이드 조합 하나에 맞춘다.
  const showScheduleInCalendar = ({ raidName, difficulty, mode }) => {
    const tab = raidTabOptions.find((option) => option.raid === raidName && option.difficulty === difficulty)

    if (tab) {
      setActiveRaidTab(tab.label)
    }

    if (modeOptions.includes(mode)) {
      setActiveModeTab(mode)
    }
  }

  // 폼에서 레이드 조합을 고르면 주간 슬롯도 같은 탭을 보여 준다. (내 시간 표시가 바로 보이도록)
  useEffect(() => {
    if (currentScheduleKey) {
      const [raidName, difficulty, mode] = currentScheduleKey.split('|')
      showScheduleInCalendar({ raidName, difficulty, mode })
    }
  }, [currentScheduleKey])

  // 로그인하면 주간 슬롯을 내가 저장한 첫 스케줄 탭으로 연다. 닉네임마다 한 번만 맞추고 이후엔 사용자가 고른 탭을 둔다.
  useEffect(() => {
    if (!loggedInNickname || calendarTabAutoNickname === loggedInNickname || mySavedSchedules.length === 0) {
      return
    }

    setCalendarTabAutoNickname(loggedInNickname)

    // 이미 신청한 사람은 첫 신청을 폼에 불러와, 아래 목록까지 내려가 '수정'을 누르지 않아도 바로 고칠 수 있게 한다.
    if (!currentScheduleKey) {
      showScheduleInCalendar(mySavedSchedules[0])
      loadScheduleIntoForm(mySavedSchedules[0])
    }

    // 이번 주에 이미 신청한 사람은 모바일에서 등록 폼 대신 요일별 신청 현황부터 보여 준다.
    setMobileSection((prev) => (prev === 'form' ? 'day' : prev))
  }, [loggedInNickname, mySavedSchedules])

  // 저장하지 않은 요일/시간 변경이 있는 레이드 조합 키 목록 (지금 캐릭터 기준)
  const unsavedScheduleKeys = useMemo(
    () => Object.entries(dayTimeDrafts)
      .filter(([key, draft]) => {
        const saved = raidSchedules.find((entry) => entry.nickname === currentNickname && getScheduleKey(entry) === key)
        return formatDayTimeSelection(normalizeDayTimeSelection(draft)) !== formatDayTimeSelection(saved?.dayTimeSelection)
      })
      .map(([key]) => key),
    [dayTimeDrafts, raidSchedules, currentNickname],
  )
  const hasUnsavedChanges = unsavedScheduleKeys.length > 0

  // 저장하지 않은 변경이 있으면 새로고침 · 창 닫기 전에 브라우저가 한 번 묻는다.
  useEffect(() => {
    if (!hasUnsavedChanges) {
      return undefined
    }

    const warnBeforeUnload = (event) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  // 저장하지 않은 변경이 사라지는 동작(로그아웃 · 캐릭터 변경) 전에 확인한다. 진행해도 되면 true.
  const confirmDiscardUnsaved = () => (
    !hasUnsavedChanges
    || window.confirm(`저장하지 않은 시간 변경이 있어요.\n\n${unsavedScheduleKeys.map(formatScheduleKey).join('\n')}\n\n저장하지 않고 넘어갈까요?`)
  )

  // 저장된 스케줄을 폼에 불러와 바로 고칠 수 있게 한다.
  // 직업 · 전투력 · 리딩은 '내 캐릭터' 칸의 값을 그대로 쓰고, 레이드 조합만 불러온다.
  const loadScheduleIntoForm = (entry) => {
    const raid = raidOptions.find((option) => option.label === entry.raidName)

    setProfile((prev) => ({
      ...prev,
      raidFocus: raid?.id ?? entry.raidName,
      difficulty: entry.difficulty,
      mode: entry.mode,
    }))

    // 주말 낮시간(12~16시)이 들어 있으면 고칠 수 있게 낮시간을 켠다.
    if (getDayTimePairs(entry.dayTimeSelection).some(([, time]) => hiddenWeekdayTimeSlots.includes(time))) {
      setShowDaytimeSlots(true)
    }
  }

  const editSavedSchedule = (entry) => {
    loadScheduleIntoForm(entry)
    document.getElementById('schedule-day-field')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const handleLogin = async (event) => {
    event.preventDefault()

    const trimmedNickname = loginNickname.trim()

    if (!trimmedNickname) {
      setLoginError('닉네임을 입력해 주세요.')
      return
    }

    if (!loginPassword) {
      setLoginError('비밀번호를 입력해 주세요.')
      return
    }

    setIsLoginPending(true)

    try {
      const result = await memberLogin(trimmedNickname, loginPassword)

      if (result === 'must_change') {
        // 초기 비밀번호로 들어왔으면 개인 비밀번호부터 정한다.
        setPasswordSetup({ nickname: trimmedNickname, currentPassword: loginPassword })
        resetPasswordForm()
        setLoginPassword('')
        setLoginError('')
        return
      }

      if (result !== 'ok') {
        setLoginError(describeAuthResult(result))
        return
      }

      await completeLogin(trimmedNickname, loginPassword)
    } catch (error) {
      setLoginError(`로그인 중 오류가 났어요. (${error.message})`)
    } finally {
      setIsLoginPending(false)
    }
  }

  const completeLogin = async (nickname, password) => {
    setLoginError('')
    setLoginPassword('')
    setPasswordSetup(null)
    setSessionPassword(password)
    setLoggedInNickname(nickname)
    setActiveCharacter('')
    setCharacterEditOpen(false)
    setExpandedPastDays({})
    // 다른 기기에서 연결한 부캐도 보이도록 로그인할 때 다시 불러온다.
    reloadMemberAlts()

    if (rememberMe || savePassword) {
      writeStoredLoginNickname(nickname)
    } else {
      writeStoredLoginNickname('')
    }

    writeStoredLoginPassword(savePassword ? password : '')

    setProfile(buildDefaultMember({ nickname }))
    await loadCurrentProfileByNickname(nickname)
  }

  // 비밀번호를 저장해 둔 기기는 로그인 버튼을 다시 누르지 않아도 되게 한다.
  useEffect(() => {
    if (!isAutoLoggingIn || autoLoginStartedRef.current) {
      return
    }

    autoLoginStartedRef.current = true

    const nickname = readStoredLoginNickname()
    const password = readStoredLoginPassword()

    const tryAutoLogin = async () => {
      try {
        const result = await memberLogin(nickname, password)

        if (result === 'ok') {
          await completeLogin(nickname, password)
        } else if (result === 'invalid') {
          // 다른 기기에서 비밀번호를 바꿨을 수 있다. 새로고침마다 틀린 비밀번호로 시도해 잠기지 않도록 지운다.
          writeStoredLoginPassword('')
          setSavePassword(false)
          setLoginPassword('')
          setLoginError('저장된 비밀번호가 맞지 않아요. 다시 입력해 주세요.')
        } else if (result !== 'must_change') {
          setLoginError(describeAuthResult(result))
        }
      } catch (error) {
        setLoginError(`자동 로그인에 실패했어요. (${error.message})`)
      } finally {
        setIsAutoLoggingIn(false)
      }
    }

    tryAutoLogin()
  }, [isAutoLoggingIn])

  // Esc로 맨 위 팝업부터 닫는다.
  useEffect(() => {
    const closeTopPopup = (event) => {
      if (event.key !== 'Escape') {
        return
      }

      if (memberDetail) {
        setMemberDetail(null)
      } else if (pendingRunStatus) {
        setPendingRunStatus(null)
      } else if (clearAllConfirmOpen) {
        setClearAllConfirmOpen(false)
      } else if (restoreConfirmOpen) {
        setRestoreConfirmOpen(false)
      } else if (altManagerOpen) {
        setAltManagerOpen(false)
      } else if (passwordChangeOpen) {
        setPasswordChangeOpen(false)
      } else if (mobileMenuOpen) {
        setMobileMenuOpen(false)
      }
    }

    window.addEventListener('keydown', closeTopPopup)
    return () => window.removeEventListener('keydown', closeTopPopup)
  }, [memberDetail, pendingRunStatus, clearAllConfirmOpen, restoreConfirmOpen, altManagerOpen, passwordChangeOpen, mobileMenuOpen])

  const resetPasswordForm = () => {
    setPasswordForm(buildEmptyPasswordForm())
  }

  const updatePasswordForm = (field, value) => {
    setPasswordForm((prev) => ({ ...prev, [field]: value, error: '', message: '' }))
  }

  // 새 비밀번호 입력값 확인. 문제가 있으면 안내 문구를, 없으면 ''를 돌려준다.
  const validateNewPassword = (currentPassword) => {
    if (!PASSWORD_RULE.test(passwordForm.next)) {
      return describeAuthResult('weak')
    }

    if (passwordForm.next !== passwordForm.confirm) {
      return '새 비밀번호가 서로 달라요.'
    }

    if (passwordForm.next === currentPassword) {
      return '지금 비밀번호와 다른 비밀번호를 정해 주세요.'
    }

    return ''
  }

  // 초기 비밀번호로 로그인한 뒤 개인 비밀번호를 정한다.
  const handlePasswordSetup = async (event) => {
    event.preventDefault()

    const validationError = validateNewPassword(passwordSetup.currentPassword)
      || (!passwordForm.hintQuestion || normalizeHintAnswer(passwordForm.hintAnswer).length < 2 ? describeAuthResult('hint_required') : '')

    if (validationError) {
      setPasswordForm((prev) => ({ ...prev, error: validationError }))
      return
    }

    try {
      const result = await memberSetupPassword(
        passwordSetup.nickname,
        passwordSetup.currentPassword,
        passwordForm.next,
        passwordForm.hintQuestion,
        passwordForm.hintAnswer,
      )

      if (result !== 'ok') {
        setPasswordForm((prev) => ({ ...prev, error: describeAuthResult(result) }))
        return
      }

      const nextPassword = passwordForm.next
      resetPasswordForm()
      await completeLogin(passwordSetup.nickname, nextPassword)
    } catch (error) {
      setPasswordForm((prev) => ({ ...prev, error: `비밀번호 설정 중 오류가 났어요. (${error.message})` }))
    }
  }

  // 로그인한 상태에서 비밀번호를 바꾼다.
  const handlePasswordChange = async (event) => {
    event.preventDefault()

    const validationError = validateNewPassword(passwordForm.current)

    if (validationError) {
      setPasswordForm((prev) => ({ ...prev, error: validationError }))
      return
    }

    try {
      const result = await memberSetPassword(loggedInNickname, passwordForm.current, passwordForm.next)

      if (result !== 'ok') {
        setPasswordForm((prev) => ({
          ...prev,
          error: result === 'invalid' ? '지금 비밀번호가 맞지 않아요.' : describeAuthResult(result),
        }))
        return
      }

      setSessionPassword(passwordForm.next)

      if (readStoredLoginPassword()) {
        writeStoredLoginPassword(passwordForm.next)
      }

      setPasswordForm({ ...buildEmptyPasswordForm(), message: '비밀번호를 바꿨어요.' })
    } catch (error) {
      setPasswordForm((prev) => ({ ...prev, error: `비밀번호 변경 중 오류가 났어요. (${error.message})` }))
    }
  }

  const openPasswordReset = () => {
    resetPasswordForm()
    setLoginError('')
    setPasswordReset({ nickname: loginNickname.trim(), question: null })
  }

  const cancelPasswordReset = () => {
    setPasswordReset(null)
    resetPasswordForm()
  }

  // 비밀번호 찾기 1단계: 닉네임으로 찾기 질문을 불러온다.
  const handlePasswordResetLookup = async (event) => {
    event.preventDefault()

    const nickname = passwordReset.nickname.trim()

    if (!nickname) {
      setPasswordForm((prev) => ({ ...prev, error: '닉네임을 입력해 주세요.' }))
      return
    }

    try {
      const { status, question } = await memberGetHintQuestion(nickname)

      if (status !== 'ok') {
        setPasswordForm((prev) => ({ ...prev, error: describeAuthResult(status) }))
        return
      }

      setPasswordReset({ nickname, question })
      setPasswordForm((prev) => ({ ...prev, error: '' }))
    } catch (error) {
      setPasswordForm((prev) => ({ ...prev, error: `질문을 불러오지 못했어요. (${error.message})` }))
    }
  }

  // 비밀번호 찾기 2단계: 답을 맞히면 새 비밀번호로 바꾸고 바로 로그인한다.
  const handlePasswordReset = async (event) => {
    event.preventDefault()

    const validationError = !passwordForm.hintAnswer.trim() ? '답을 입력해 주세요.' : validateNewPassword('')

    if (validationError) {
      setPasswordForm((prev) => ({ ...prev, error: validationError }))
      return
    }

    try {
      const result = await memberResetPassword(passwordReset.nickname, passwordForm.hintAnswer, passwordForm.next)

      if (result !== 'ok') {
        setPasswordForm((prev) => ({
          ...prev,
          error: result === 'invalid' ? '답이 맞지 않아요.' : describeAuthResult(result),
        }))
        return
      }

      const { nickname } = passwordReset
      const nextPassword = passwordForm.next
      setPasswordReset(null)
      resetPasswordForm()
      await completeLogin(nickname, nextPassword)
    } catch (error) {
      setPasswordForm((prev) => ({ ...prev, error: `비밀번호 찾기 중 오류가 났어요. (${error.message})` }))
    }
  }

  const openPasswordChange = () => {
    resetPasswordForm()
    setPasswordChangeOpen(true)
  }

  const cancelPasswordSetup = () => {
    setPasswordSetup(null)
    resetPasswordForm()
  }

  const handleLogout = () => {
    if (!confirmDiscardUnsaved()) {
      return
    }

    setLoggedInNickname('')
    setCalendarTabAutoNickname('')
    setActiveCharacter('')
    setAltManagerOpen(false)
    setLoginNickname('')
    setLoginPassword('')
    setSessionPassword('')
    setPasswordSetup(null)
    setPasswordReset(null)
    setPasswordChangeOpen(false)
    resetPasswordForm()
    setRememberMe(false)
    setSavePassword(false)
    writeStoredLoginNickname('')
    writeStoredLoginPassword('')
    setProfile(buildDefaultMember({ nickname: '' }))
    setDayTimeDrafts({})
    setMobileMenuOpen(false)
  }

  const selectMobileSection = (sectionId) => {
    setMobileSection(sectionId)
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0 })
  }

  // '내 다음 레이드'에서 그 시간대를 요일별 신청 현황에 펼쳐 보여 준다. (모바일은 그 영역으로 넘어간다)
  const openSlotInDaySummary = ({ day, time, raidName, difficulty, mode }) => {
    const rowKey = `${day}-${raidName} / ${difficulty} / ${mode}-${time}`

    setMobileSection('day')
    setExpandedPastDays((prev) => ({ ...prev, [day]: true }))
    setExpandedSummaryRows((prev) => ({ ...prev, [rowKey]: true }))
    // 펼친 줄이 그려진 뒤에 스크롤한다.
    setTimeout(() => {
      document.getElementById(`day-raid-row-${rowKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
  }

  const openPasswordChangeFromMenu = () => {
    setMobileMenuOpen(false)
    openPasswordChange()
  }

  const mobileSectionLabel = MOBILE_SECTIONS.find((section) => section.id === mobileSection)?.label ?? ''

  const loadCurrentProfileByNickname = async (nickname) => {
    const trimmedNickname = String(nickname ?? '').trim()

    if (!trimmedNickname) {
      return
    }

    let member = null

    if (supabase) {
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('nickname', trimmedNickname)
        .maybeSingle()

      if (!error && data) {
        member = normalizeMemberRecord(data)
      }
    }

    member = member ?? loadLocalMembers().find((item) => item.nickname === trimmedNickname)

    if (!member) {
      return
    }

    // 이전에 저장한 개인 정보만 채우고, 레이드 · 난이도 · 공략 방식은 비워 둔다.
    setProfile((prev) => ({
      ...prev,
      nickname: trimmedNickname,
      className: member.className,
      power: member.power,
      leadReady: member.leadReady,
    }))
  }

  // 신청 폼의 캐릭터를 바꾼다. 직업 · 전투력 · 리딩은 캐릭터마다 달라서 다시 불러오고, 레이드 조합은 그대로 둔다.
  const switchCharacter = async (nickname) => {
    const nextCharacter = nickname === loggedInNickname ? '' : nickname

    if (nextCharacter === activeCharacter) {
      return
    }

    setActiveCharacter(nextCharacter)
    setDayTimeDrafts({})
    setProfile((prev) => buildDefaultMember({
      nickname,
      raidFocus: prev.raidFocus,
      difficulty: prev.difficulty,
      mode: prev.mode,
    }))
    await loadCurrentProfileByNickname(nickname)
  }

  const reloadMemberAlts = async () => {
    const alts = await fetchMemberAlts()

    if (alts) {
      setMemberAlts(alts)
    }

    return alts
  }

  const openAltManager = () => {
    setAltForm({ nickname: '', password: '', error: '', pending: false })
    setAltManagerOpen(true)
    setMobileMenuOpen(false)
  }

  const handleLinkAlt = async (event) => {
    event.preventDefault()

    const altNickname = altForm.nickname.trim()

    if (!altNickname) {
      setAltForm((prev) => ({ ...prev, error: '부캐 닉네임을 입력해 주세요.' }))
      return
    }

    setAltForm((prev) => ({ ...prev, error: '', pending: true }))

    try {
      const result = await linkMemberAlt(loggedInNickname, sessionPassword, altNickname, altForm.password)

      if (result !== 'ok') {
        setAltForm((prev) => ({ ...prev, error: describeAuthResult(result), pending: false }))
        return
      }

      await reloadMemberAlts()
      setAltForm({ nickname: '', password: '', error: '', pending: false })
    } catch (error) {
      setAltForm((prev) => ({ ...prev, error: `부캐를 연결하지 못했어요. (${error.message})`, pending: false }))
    }
  }

  const handleUnlinkAlt = async (altNickname) => {
    if (!window.confirm(`${altNickname} 부캐 연결을 해제할까요?\n\n신청 기록은 남고, ${altNickname}은(는) 다시 초기 비밀번호로 로그인해 개인 비밀번호를 정해야 해요.`)) {
      return
    }

    try {
      const result = await unlinkMemberAlt(loggedInNickname, sessionPassword, altNickname)

      if (result !== 'ok') {
        setAltForm((prev) => ({ ...prev, error: describeAuthResult(result) }))
        return
      }

      await reloadMemberAlts()

      if (activeCharacter === altNickname) {
        await switchCharacter(loggedInNickname)
      }
    } catch (error) {
      setAltForm((prev) => ({ ...prev, error: `부캐 연결을 해제하지 못했어요. (${error.message})` }))
    }
  }

  // '내 캐릭터' 칸을 고친다. 마지막 칸을 고르는 순간 접혀 버리지 않도록 고치는 동안은 펼쳐 둔다.
  const updateCharacterField = (field, value) => {
    setCharacterEditOpen(true)
    setProfile((prev) => ({ ...prev, [field]: value }))
  }

  // 스케줄 한 건(캐릭터 · 레이드 조합)을 저장하고 화면에 반영한다. 성공하면 true, 실패하면 알림을 띄우고 false.
  // info: 참여 여부 · 직업 · 전투력 · 리딩, target: 레이드 · 난이도 · 공략 방식
  const persistSchedule = async (nickname, info, target, dayTimeSelection) => {
    const selection = normalizeDayTimeSelection(dayTimeSelection)
    const days = getSelectedDayList(selection)
    const times = getCombinedTimes(selection)
    const leadReady = normalizeLeadReady(info.leadReady)

    const scheduleEntry = {
      nickname,
      raid_name: target.raidName,
      difficulty: target.difficulty,
      mode: target.mode,
      days,
      times,
      day_time_selection: selection,
      attendance: info.attendance,
      class_name: info.className,
      power: info.power,
      lead_ready: leadReady,
    }

    if (supabase) {
      let result

      try {
        result = await saveMemberSchedule(
          nickname,
          sessionPassword,
          {
            attendance: info.attendance,
            class_name: info.className,
            power: info.power,
            lead_ready: leadReady,
          },
          scheduleEntry,
        )
      } catch (error) {
        showToast(`스케줄 저장에 실패했어요. (${error.message})`, 'error')
        return false
      }

      if (result?.error) {
        const conflict = result.conflict
        const conflictDetail = conflict
          ? `\n${conflict.day}요일 ${formatTimeLabel(conflict.time)}: ${conflict.nickname} · ${conflict.raid_name} ${conflict.difficulty} ${conflict.mode}`
          : ''
        showToast(`스케줄 저장에 실패했어요. ${describeAuthResult(result.error)}${conflictDetail}`, 'error')
        return false
      }

      const savedMember = normalizeMemberRecord(result.member)
      const savedEntry = normalizeRaidScheduleEntry(result.schedule)

      setMembers((prevMembers) => {
        const index = prevMembers.findIndex((member) => member.nickname === nickname)

        if (index >= 0) {
          const nextMembers = [...prevMembers]
          nextMembers[index] = savedMember
          return nextMembers
        }

        return [...prevMembers, savedMember]
      })

      setRaidSchedules((prevSchedules) => {
        const index = prevSchedules.findIndex((entry) => entry.nickname === nickname && getScheduleKey(entry) === getScheduleKey(savedEntry))

        if (index >= 0) {
          const nextSchedules = [...prevSchedules]
          nextSchedules[index] = savedEntry
          return nextSchedules
        }

        return [...prevSchedules, savedEntry]
      })
      return true
    }

    const updatedAt = new Date().toISOString()
    const nextLocalMember = {
      nickname,
      id: `member-${Date.now()}`,
      days,
      times,
      dayTimeSelection: selection,
      attendance: info.attendance,
      className: info.className,
      power: info.power,
      leadReady,
      raidFocus: target.raidName,
      difficulty: target.difficulty,
      mode: target.mode,
      updatedAt,
    }
    setMembers((prevMembers) => {
      const targetIndex = prevMembers.findIndex((member) => member.nickname === nickname)

      if (targetIndex >= 0) {
        const nextMembers = [...prevMembers]
        nextMembers[targetIndex] = { ...nextMembers[targetIndex], ...nextLocalMember }
        return nextMembers
      }

      return [...prevMembers, nextLocalMember]
    })

    const localEntry = normalizeRaidScheduleEntry({
      ...scheduleEntry,
      className: scheduleEntry.class_name,
      leadReady: scheduleEntry.lead_ready,
      raidName: scheduleEntry.raid_name,
      updatedAt,
    })

    setRaidSchedules((prevSchedules) => {
      const nextSchedules = [...prevSchedules]
      const index = nextSchedules.findIndex((entry) => entry.nickname === nickname && getScheduleKey(entry) === getScheduleKey(localEntry))
      const stampedEntry = { ...localEntry, slotSignedAt: stampSlotSignedAt(nextSchedules[index], selection, updatedAt, weekStartTime) }

      if (index >= 0) {
        nextSchedules[index] = stampedEntry
        return nextSchedules
      }

      return [...nextSchedules, stampedEntry]
    })
    return true
  }

  // 저장된 신청에서 시간을 모두 뺐으면 저장 버튼이 그 신청을 지운다.
  const isClearingSavedSchedule = Boolean(savedCurrentSchedule) && currentSelectedDays.length === 0

  // 저장 전에 선택하지 않은 항목이나 겹치는 시간이 있으면 알려 주고, 없으면 바로 저장한다.
  const handleSaveClick = async () => {
    if (isClearingSavedSchedule) {
      if (!isSaving) {
        await deleteWithUndo(savedCurrentSchedule)
      }

      return
    }

    const missingFields = [
      [profile.className, '직업'],
      [profile.power, '전투력'],
      [profile.leadReady, '리딩 여부'],
      [selectedRaidLabel, '레이드'],
      [profile.difficulty, '난이도'],
      [profile.mode, '공략 방식'],
      [currentSelectedDays.length > 0, '요일 · 시간'],
    ]
      .filter(([value]) => !value)
      .map(([, label]) => label)

    if (missingFields.length > 0) {
      showToast(`다음 항목을 선택해 주세요: ${missingFields.join(', ')}`, 'error')
      return
    }

    // 골라 둔 뒤에 다른 캐릭터로 같은 시간을 저장했을 수 있어 저장 전에 한 번 더 본다.
    const conflictLines = getDayTimePairs(currentDayTimeSelection)
      .filter(([day, time]) => takenSlots.has(`${day}|${time}`))
      .map(([day, time]) => `${day}요일 ${formatTimeLabel(time)}: ${describeTakenSlot(takenSlots.get(`${day}|${time}`))}`)

    if (conflictLines.length > 0) {
      showToast(`같은 시간에 이미 신청한 캐릭터가 있어요. 아래 시간을 빼고 저장해 주세요.\n${conflictLines.join('\n')}`, 'error')
      return
    }

    const nickname = currentNickname
    const scheduleKey = currentScheduleKey

    if (!nickname || isSaving) {
      return
    }

    // 직업 · 전투력 · 리딩이 바뀌었으면 이 캐릭터의 다른 신청에도 함께 반영한다.
    const outdatedSchedules = getOutdatedCharacterSchedules([scheduleKey])

    setIsSaving(true)

    try {
      const isSaved = await persistSchedule(nickname, { ...profile, attendance: '참' }, currentScheduleTarget, currentDayTimeSelection)

      if (!isSaved) {
        return
      }

      // 저장이 끝나면 이 레이드의 수정 중 선택을 비운다 (이후엔 저장된 선택이 보인다).
      setDayTimeDrafts((prev) => {
        const nextDrafts = { ...prev }
        delete nextDrafts[scheduleKey]
        return nextDrafts
      })

      const syncedCount = await syncCharacterInfo(nickname, outdatedSchedules)
      showToast(
        `${nickname} · ${formatScheduleKey(scheduleKey)} 저장했어요.${syncedCount > 0 ? `\n다른 신청 ${syncedCount}건에도 캐릭터 정보를 반영했어요.` : ''}`,
        'success',
      )
    } finally {
      setIsSaving(false)
    }
  }

  // '내 캐릭터' 칸(직업 · 전투력 · 리딩)을 다 골랐는지
  const isCharacterInfoComplete = Boolean(profile.className && profile.power && profile.leadReady)

  // 이 캐릭터의 저장된 신청 중 직업 · 전투력 · 리딩이 '내 캐릭터' 칸과 다른 것 (exceptKeys 조합은 뺀다)
  const getOutdatedCharacterSchedules = (exceptKeys = []) => (
    isCharacterInfoComplete
      ? mySavedSchedules.filter((entry) => (
        !exceptKeys.includes(getScheduleKey(entry))
        && (entry.className !== profile.className
          || entry.power !== profile.power
          || entry.leadReady !== normalizeLeadReady(profile.leadReady))
      ))
      : []
  )
  const outdatedCharacterSchedules = getOutdatedCharacterSchedules()

  // 저장된 신청에 지금 '내 캐릭터' 정보를 반영한다. (요일 · 시간과 참여 여부는 그대로) 반영한 건수를 돌려준다.
  const syncCharacterInfo = async (nickname, entries) => {
    let syncedCount = 0

    for (const entry of entries) {
      const info = { attendance: entry.attendance, className: profile.className, power: profile.power, leadReady: profile.leadReady }

      // 실패하면 이미 알림을 띄웠으니 나머지는 멈춘다.
      if (!(await persistSchedule(nickname, info, entry, entry.dayTimeSelection))) {
        break
      }

      syncedCount += 1
    }

    return syncedCount
  }

  const handleCharacterSyncClick = async () => {
    const nickname = currentNickname

    if (!nickname || isSaving || outdatedCharacterSchedules.length === 0) {
      return
    }

    setIsSaving(true)

    try {
      const syncedCount = await syncCharacterInfo(nickname, outdatedCharacterSchedules)

      if (syncedCount > 0) {
        showToast(`저장된 신청 ${syncedCount}건에 캐릭터 정보를 반영했어요.`, 'success')
      }
    } finally {
      setIsSaving(false)
    }
  }

  // 저장하지 않은 변경을 모두 버리고 저장된 상태로 돌아간다. 잘못 눌렀으면 알림에서 되살릴 수 있다.
  const discardUnsavedChanges = () => {
    const discardedDrafts = dayTimeDrafts

    setDayTimeDrafts({})
    showToast('변경을 취소했어요.', 'info', 'discard-drafts', {
      label: '되돌리기',
      onClick: () => setDayTimeDrafts(discardedDrafts),
    })
  }

  // 저장하지 않은 레이드 조합을 한꺼번에 저장한다.
  const handleSaveAllClick = async () => {
    const nickname = currentNickname

    if (!nickname || isSaving) {
      return
    }

    if (!isCharacterInfoComplete) {
      showToast('내 캐릭터의 직업 · 전투력 · 리딩 여부를 먼저 골라 주세요.', 'error')
      return
    }

    const targetKeys = [...unsavedScheduleKeys]
    const skipped = []
    let savedCount = 0

    setIsSaving(true)

    try {
      for (const key of targetKeys) {
        const [raidName, difficulty, mode] = key.split('|')
        const selection = normalizeDayTimeSelection(dayTimeDrafts[key])

        // 시간을 모두 뺀 조합은 저장 대신 삭제를 해야 해서 건너뛴다.
        if (getSelectedDayList(selection).length === 0) {
          skipped.push(formatScheduleKey(key))
          continue
        }

        const info = { attendance: '참', className: profile.className, power: profile.power, leadReady: profile.leadReady }

        if (!(await persistSchedule(nickname, info, { raidName, difficulty, mode }, selection))) {
          break
        }

        savedCount += 1
        setDayTimeDrafts((prev) => {
          const nextDrafts = { ...prev }
          delete nextDrafts[key]
          return nextDrafts
        })
      }

      const syncedCount = savedCount > 0 ? await syncCharacterInfo(nickname, getOutdatedCharacterSchedules(targetKeys)) : 0

      if (savedCount > 0) {
        showToast(`${savedCount}건 저장했어요.${syncedCount > 0 ? `\n다른 신청 ${syncedCount}건에도 캐릭터 정보를 반영했어요.` : ''}`, 'success')
      }
    } finally {
      setIsSaving(false)
    }

    if (skipped.length > 0) {
      showToast(`시간을 모두 뺀 조합은 건너뛰었어요. 그 조합을 폼에 불러와 '신청 삭제'로 지울 수 있어요: ${skipped.join(' / ')}`, 'info')
    }
  }

  // 불러오기 팝업을 열 때는 지난 신청을 모두 고른 상태로 시작한다.
  const openRestoreConfirm = () => {
    setRestoreSelectedKeys(restorableSchedules.map((entry) => getScheduleKey(entry)))
    setRestoreConfirmOpen(true)
  }

  const toggleRestoreKey = (key) => {
    setRestoreSelectedKeys((prev) => (prev.includes(key) ? prev.filter((value) => value !== key) : [...prev, key]))
  }

  // 팝업에서 고른 지난 신청 (목록이 바뀌어 사라진 키는 빼고 센다)
  const selectedRestoreSchedules = restorableSchedules.filter((entry) => restoreSelectedKeys.includes(getScheduleKey(entry)))

  // 고른 지난 신청을 이번 주 신청으로 다시 등록한다. 직업 · 전투력 · 리딩은 지금 '내 캐릭터' 칸 값을 쓴다.
  // 이번 주 다른 신청과 겹치는 시간과 이미 지난 시간은 빼고 등록한다. (앞에서 등록한 것과도 겹치지 않게 차례로 쌓는다)
  const restoreSchedules = async () => {
    setRestoreConfirmOpen(false)

    const nickname = currentNickname

    if (!nickname || isSaving || selectedRestoreSchedules.length === 0) {
      return
    }

    const takenKeys = new Set(
      raidSchedules
        .filter((entry) => entry.attendance === '참' && myCharacters.includes(entry.nickname))
        .flatMap((entry) => getDayTimePairs(entry.dayTimeSelection).map(([day, time]) => `${day}|${time}`)),
    )
    const skipped = []
    const skippedPast = []
    let restoredCount = 0

    setIsSaving(true)

    try {
      for (const entry of selectedRestoreSchedules) {
        const selection = normalizeDayTimeSelection(entry.dayTimeSelection)

        weekdayNames.forEach((day) => {
          selection[day] = selection[day].filter((time) => {
            const slotKey = `${day}|${time}`

            if (isPastSlot(day, time)) {
              skippedPast.push(`${day} ${formatTimeLabel(time)}`)
              return false
            }

            if (takenKeys.has(slotKey)) {
              skipped.push(`${day} ${formatTimeLabel(time)}`)
              return false
            }

            takenKeys.add(slotKey)
            return true
          })
        })

        if (getSelectedDayList(selection).length === 0) {
          continue
        }

        const info = {
          attendance: '참',
          className: profile.className || entry.className,
          power: profile.power || entry.power,
          leadReady: profile.leadReady || entry.leadReady,
        }

        // 실패하면 이미 알림을 띄웠으니 나머지는 멈춘다.
        if (!(await persistSchedule(nickname, info, entry, selection))) {
          break
        }

        restoredCount += 1
      }
    } finally {
      setIsSaving(false)
    }

    if (restoredCount > 0) {
      showToast(`지난 신청 ${restoredCount}건을 이번 주로 다시 등록했어요.`, 'success')
    }

    if (skipped.length > 0) {
      showToast(`이번 주 다른 신청과 겹쳐서 뺀 시간: ${skipped.join(', ')}`, 'info')
    }

    if (skippedPast.length > 0) {
      showToast(`이미 지나서 뺀 시간: ${skippedPast.join(', ')}`, 'info')
    }
  }

  const clearCurrentSchedule = async () => {
    const trimmedNickname = currentNickname

    if (!trimmedNickname) {
      return
    }

    if (supabase && !(await runRemoteDelete(() => deleteAllMemberSchedules(trimmedNickname, sessionPassword)))) {
      return
    }

    setDayTimeDrafts({})
    setMembers((prevMembers) => prevMembers.filter((member) => member.nickname !== trimmedNickname))
    setRaidSchedules((prevSchedules) => prevSchedules.filter((entry) => entry.nickname !== trimmedNickname))

    saveLocalRaidSchedules(
      loadLocalRaidSchedules().filter((entry) => entry.nickname !== trimmedNickname),
    )
    showToast(`${trimmedNickname}의 스케줄을 모두 삭제했어요.`, 'success')
  }

  // 레이드 · 난이도 · 공략 방식이 같은 스케줄 한 건만 삭제한다. 성공하면 true.
  const deleteSchedule = async (target) => {
    const trimmedNickname = currentNickname

    if (!trimmedNickname) {
      return
    }

    const targetKey = getScheduleKey(target)
    const isTargetSchedule = (entry) => entry.nickname === trimmedNickname && getScheduleKey(entry) === targetKey

    const clearedSelection = { days: [], times: [], dayTimeSelection: buildEmptyDayTimeSelection() }

    if (supabase && !(await runRemoteDelete(() => deleteMemberSchedule(trimmedNickname, sessionPassword, target)))) {
      return
    }

    setRaidSchedules((prevSchedules) => prevSchedules.filter((entry) => !isTargetSchedule(entry)))
    setMembers((prevMembers) => prevMembers.map((member) => (isScheduleMember(member, trimmedNickname, target) ? { ...member, ...clearedSelection } : member)))
    setDayTimeDrafts((prev) => {
      const nextDrafts = { ...prev }
      delete nextDrafts[targetKey]
      return nextDrafts
    })
    return true
  }

  // 저장된 스케줄 한 건에서 요일 하나(time이 null) 또는 요일 · 시간 하나만 뺀다.
  // 남은 시간이 없으면 스케줄을 통째로 삭제하고, 남아 있으면 줄인 선택으로 다시 저장한다. 성공하면 true.
  const deleteScheduleSlot = async ({ entry, day, time }) => {
    const trimmedNickname = currentNickname

    if (!trimmedNickname) {
      return
    }

    const removeSlot = (selection) => {
      const nextSelection = normalizeDayTimeSelection(selection)
      nextSelection[day] = time ? nextSelection[day].filter((value) => value !== time) : []
      return nextSelection
    }

    const nextSelection = removeSlot(entry.dayTimeSelection)

    if (getSelectedDayList(nextSelection).length === 0) {
      return deleteSchedule(entry)
    }

    const targetKey = getScheduleKey(entry)
    const nextDays = getSelectedDayList(nextSelection)
    const nextTimes = getCombinedTimes(nextSelection)
    const nowIso = new Date().toISOString()
    let savedEntry = {
      ...entry,
      days: nextDays,
      times: nextTimes,
      dayTimeSelection: nextSelection,
      updatedAt: nowIso,
      slotSignedAt: stampSlotSignedAt(entry, nextSelection, nowIso, weekStartTime),
    }

    if (supabase) {
      // members 행은 캐릭터의 최근 정보라 그대로 다시 넣고, 스케줄 쪽만 시간을 줄인다.
      const savedMember = storedMembers.find((member) => member.nickname === trimmedNickname) ?? entry
      let result

      try {
        result = await saveMemberSchedule(
          trimmedNickname,
          sessionPassword,
          {
            attendance: savedMember.attendance,
            class_name: savedMember.className,
            power: savedMember.power,
            lead_ready: savedMember.leadReady,
          },
          {
            nickname: trimmedNickname,
            raid_name: entry.raidName,
            difficulty: entry.difficulty,
            mode: entry.mode,
            days: nextDays,
            times: nextTimes,
            day_time_selection: nextSelection,
            attendance: entry.attendance,
            class_name: entry.className,
            power: entry.power,
            lead_ready: entry.leadReady,
          },
        )
      } catch (error) {
        showToast(`삭제에 실패했어요. (${error.message})`, 'error')
        return
      }

      if (result?.error) {
        showToast(`삭제에 실패했어요. ${describeAuthResult(result.error)}`, 'error')
        return
      }

      savedEntry = normalizeRaidScheduleEntry(result.schedule)
    }

    setRaidSchedules((prevSchedules) => prevSchedules.map((item) => (
      item.nickname === trimmedNickname && getScheduleKey(item) === targetKey ? savedEntry : item
    )))
    setMembers((prevMembers) => prevMembers.map((member) => (
      isScheduleMember(member, trimmedNickname, entry)
        ? { ...member, days: nextDays, times: nextTimes, dayTimeSelection: nextSelection }
        : member
    )))
    // 수정 중인 선택이 있으면 거기서도 같은 시간을 뺀다.
    setDayTimeDrafts((prev) => (prev[targetKey] ? { ...prev, [targetKey]: removeSlot(prev[targetKey]) } : prev))
    return true
  }

  // 스케줄 한 건(target) 또는 그 안의 요일 · 시간({ entry, day, time })을 확인 창 없이 지우고,
  // 알림의 [되돌리기]로 지우기 전 스케줄을 그대로 다시 저장할 수 있게 한다.
  const deleteWithUndo = async (target) => {
    const nickname = currentNickname
    const entry = target.entry ?? target
    const scheduleLabel = formatScheduleKey(getScheduleKey(entry))
    const isDeleted = target.entry ? await deleteScheduleSlot(target) : await deleteSchedule(target)

    if (!isDeleted) {
      return
    }

    const undoDelete = async () => {
      const info = { attendance: entry.attendance, className: entry.className, power: entry.power, leadReady: entry.leadReady }

      if (await persistSchedule(nickname, info, entry, entry.dayTimeSelection)) {
        showToast(`${scheduleLabel} 스케줄을 되돌렸어요.`, 'success', 'undo-delete')
      }
    }

    showToast(
      target.entry
        ? `${scheduleLabel}에서 ${describePendingSlot(target)} 시간을 삭제했어요.`
        : `${scheduleLabel} 스케줄을 삭제했어요.`,
      'success',
      'undo-delete',
      { label: '되돌리기', onClick: undoDelete },
    )
  }

  // 같은 계정(본캐 + 부캐)이 이번 주에 신청한 모든 시간. 폼에서 고치는 조합도 뺀 takenSlots와 달리 전부 포함한다.
  const myAllTakenSlots = useMemo(() => new Set(
    raidSchedules
      .filter((entry) => entry.attendance === '참' && myCharacters.includes(entry.nickname))
      .flatMap((entry) => getDayTimePairs(entry.dayTimeSelection).map(([day, time]) => `${day}|${time}`)),
  ), [raidSchedules, myCharacters])

  // '나도 참여'를 보여 줄 시간대인지. 지났거나 내 캐릭터가 그 시간에 이미 다른 신청을 했으면 보여 주지 않는다.
  const canJoinSlot = ({ day, time }) => !isPastSlot(day, time) && !myAllTakenSlots.has(`${day}|${time}`)

  // 현황을 보다가 그 시간대에 바로 신청한다. 지금 폼에서 고른 캐릭터로 저장한다.
  const joinSlot = async ({ raidName, difficulty, mode, day, time }) => {
    const nickname = currentNickname

    if (!nickname || isSaving) {
      return
    }

    const target = { raidName, difficulty, mode }
    const scheduleKey = getScheduleKey(target)
    const savedEntry = raidSchedules.find((entry) => entry.nickname === nickname && getScheduleKey(entry) === scheduleKey)
    const characterSource = isCharacterInfoComplete ? profile : savedEntry

    if (!characterSource) {
      showToast('내 캐릭터의 직업 · 전투력 · 리딩 여부를 먼저 골라 주세요.', 'error')
      setCharacterEditOpen(true)
      setMobileSection('form')
      setTimeout(() => {
        document.querySelector('.form-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 0)
      return
    }

    const info = {
      attendance: '참',
      className: characterSource.className,
      power: characterSource.power,
      leadReady: characterSource.leadReady,
    }
    const nextSelection = normalizeDayTimeSelection(savedEntry?.dayTimeSelection)
    nextSelection[day] = [...nextSelection[day], time]

    setIsSaving(true)

    try {
      if (!(await persistSchedule(nickname, info, target, nextSelection))) {
        return
      }
    } finally {
      setIsSaving(false)
    }

    // 이 조합을 폼에서 고치던 중이었으면 거기에도 같은 시간을 넣는다.
    setDayTimeDrafts((prev) => {
      if (!prev[scheduleKey]) {
        return prev
      }

      const nextDraft = normalizeDayTimeSelection(prev[scheduleKey])

      if (!nextDraft[day].includes(time)) {
        nextDraft[day] = [...nextDraft[day], time]
      }

      return { ...prev, [scheduleKey]: nextDraft }
    })

    const undoJoin = async () => {
      const joinedEntry = { ...target, ...info, nickname, dayTimeSelection: nextSelection }

      if (await deleteScheduleSlot({ entry: joinedEntry, day, time })) {
        showToast('신청을 취소했어요.', 'success', 'join-slot')
      }
    }

    showToast(
      `${nickname} · ${formatScheduleKey(scheduleKey)} ${day}요일 ${formatTimeLabel(time)} 신청했어요.`,
      'success',
      'join-slot',
      { label: '취소', onClick: undoJoin },
    )
  }

  // DB 삭제 요청. 성공하면 true, 실패하면 알림을 띄우고 false.
  const runRemoteDelete = async (request) => {
    try {
      const result = await request()

      if (result?.error) {
        showToast(`삭제에 실패했어요. ${describeAuthResult(result.error)}`, 'error')
        return false
      }

      return true
    } catch (error) {
      showToast(`삭제에 실패했어요. (${error.message})`, 'error')
      return false
    }
  }

  // 그 시간대(요일 · 시간 · 레이드 조합)에 참여로 투표한 내 캐릭터. 같은 시간 중복 신청을 막아서 많아야 하나다.
  // 준비 · 클리어 표시는 이 캐릭터 이름으로 남긴다. 없으면 로그인한 본캐.
  const getMySlotNickname = (run) => (
    raidSchedules.find((entry) => (
      entry.attendance === '참'
      && myCharacters.includes(entry.nickname)
      && entry.raidName === run.raidName
      && entry.difficulty === run.difficulty
      && entry.mode === run.mode
      && (entry.dayTimeSelection?.[run.day] ?? []).includes(run.time)
    ))?.nickname ?? loggedInNickname.trim()
  )

  // 클리어 표시를 저장한다. value: 'O' | 'X' | null(표시 지우기)
  // Supabase 모드에서는 DB 함수가 로그인·규칙을 확인하고, O로 바뀌면 디스코드 알림도 보낸다.
  const applyRaidRunStatus = async (run, field, value) => {
    const nickname = loggedInNickname ? getMySlotNickname(run) : ''

    if (!nickname) {
      showToast('로그인한 뒤에 클리어 여부를 표시할 수 있어요.', 'error')
      return
    }

    const runKey = getRaidRunKey(run)

    if (supabase) {
      setSavingRunKey(runKey)

      let result

      try {
        result = await setRaidRunStatus(nickname, sessionPassword, run, field, value)
      } catch (error) {
        showToast(`표시를 저장하지 못했어요. (${error.message})`, 'error')
        return
      } finally {
        setSavingRunKey('')
      }

      if (result?.error) {
        showToast(`표시를 저장하지 못했어요. ${describeAuthResult(result.error)}`, 'error')
        return
      }

      setRaidRuns((prev) => upsertRaidRun(prev, normalizeRaidRun(result.run)))
      showToast(value ? `클리어 ${value}로 표시했어요.` : '클리어 표시를 지웠어요.', 'success')
      return
    }

    // 로컬 모드: DB 함수와 같은 규칙으로 이 브라우저에만 저장한다. (디스코드 알림 없음)
    const current = raidRunByKey.get(runKey)

    if (!current?.gatheredAt) {
      showToast(describeAuthResult('not_gathered'), 'error')
      return
    }

    setRaidRuns((prev) => upsertRaidRun(prev, { ...current, cleared: value, clearedBy: value ? nickname : null }))
    showToast(value ? `클리어 ${value}로 표시했어요.` : '클리어 표시를 지웠어요.', 'success')
  }

  // 준비 호출 / 체크 / 체크 취소 / 호출 취소. slotVoterNicknames는 로컬 모드에서 모두 모였는지 볼 때 쓴다.
  const applyRaidRally = async (run, action, slotVoterNicknames) => {
    const nickname = loggedInNickname ? getMySlotNickname(run) : ''

    if (!nickname) {
      showToast('로그인한 뒤에 준비를 표시할 수 있어요.', 'error')
      return
    }

    const runKey = getRaidRunKey(run)

    if (supabase) {
      setSavingRunKey(runKey)

      let result

      try {
        result = await setRaidRally(nickname, sessionPassword, run, action)
      } catch (error) {
        showToast(`준비 상태를 저장하지 못했어요. (${error.message})`, 'error')
        return
      } finally {
        setSavingRunKey('')
      }

      // 다른 사람이 먼저 호출했거나 취소한 경우에도 최신 상태로 맞춘다.
      if (result?.run) {
        setRaidRuns((prev) => upsertRaidRun(prev, normalizeRaidRun(result.run)))
      }

      if (result?.error) {
        showToast(`준비 상태를 저장하지 못했어요. ${describeAuthResult(result.error)}`, 'error')
      } else if (action === 'remind' && !result?.notified) {
        showToast('디스코드 알림이 연결되어 있지 않아 다시 알림을 보내지 못했어요.', 'error')
      } else {
        showToast(RALLY_SUCCESS_MESSAGES[action], 'success')
      }

      return
    }

    // 로컬 모드: DB 함수와 같은 규칙으로 이 브라우저에만 저장한다. (디스코드 알림 없음)
    const current = raidRunByKey.get(runKey)
      ?? { ...run, rallyCalledBy: null, rallyCalledAt: null, rallyCheckins: [], gatheredAt: null, cleared: null, clearedBy: null }
    let nextRun

    if (action === 'call') {
      if (current.rallyCalledAt) {
        showToast(describeAuthResult('already_called'), 'error')
        return
      }

      nextRun = { ...current, rallyCalledBy: nickname, rallyCalledAt: new Date().toISOString(), rallyCheckins: [nickname], gatheredAt: null }
    } else if (action === 'cancel') {
      nextRun = { ...current, rallyCalledBy: null, rallyCalledAt: null, rallyCheckins: [], gatheredAt: null, cleared: null, clearedBy: null }
    } else if (action === 'start') {
      if (!current.rallyCalledAt) {
        showToast(describeAuthResult('not_called'), 'error')
        return
      }

      nextRun = { ...current, gatheredAt: current.gatheredAt ?? new Date().toISOString() }
    } else {
      if (!current.rallyCalledAt) {
        showToast(describeAuthResult('not_called'), 'error')
        return
      }

      if (action === 'uncheck' && current.gatheredAt) {
        showToast(describeAuthResult('already_gathered'), 'error')
        return
      }

      const others = current.rallyCheckins.filter((name) => name !== nickname)
      nextRun = { ...current, rallyCheckins: action === 'check' ? [...others, nickname] : others }
    }

    if (nextRun.rallyCalledAt && !nextRun.gatheredAt
      && slotVoterNicknames.length > 0 && slotVoterNicknames.every((name) => nextRun.rallyCheckins.includes(name))) {
      nextRun = { ...nextRun, gatheredAt: new Date().toISOString() }
    }

    setRaidRuns((prev) => upsertRaidRun(prev, nextRun))
    showToast(RALLY_SUCCESS_MESSAGES[action], 'success')
  }

  // 같은 값을 다시 누르면 표시를 지운다. O로 바꿀 때는 알림이 가므로 한 번 확인한다.
  const handleRunStatusClick = (run, field, value) => {
    const runRecord = raidRunByKey.get(getRaidRunKey(run))
    const currentValue = runRecord?.[field] ?? null
    const nextValue = currentValue === value ? null : value

    if (nextValue === 'O') {
      setPendingRunStatus({ run, action: 'cleared', alreadyNotified: Boolean(runRecord?.clearedNotified) })
      return
    }

    applyRaidRunStatus(run, field, nextValue)
  }

  // 호출 · 다시 알림은 디스코드 알림이 가고, 호출 취소는 체크 · 클리어 기록이 지워지므로 한 번 확인한다.
  const handleRallyClick = (run, action, slotVoterNicknames) => {
    if (action === 'call' || action === 'cancel' || action === 'remind' || action === 'start') {
      const runRecord = raidRunByKey.get(getRaidRunKey(run))
      setPendingRunStatus({ run, action, slotVoterNicknames, alreadyNotified: (runRecord?.rallyNotifyCount ?? 0) >= 2 })
      return
    }

    applyRaidRally(run, action, slotVoterNicknames)
  }

  const confirmPendingRunStatus = () => {
    const target = pendingRunStatus
    setPendingRunStatus(null)

    if (target.action === 'cleared') {
      applyRaidRunStatus(target.run, 'cleared', 'O')
      return
    }

    applyRaidRally(target.run, target.action, target.slotVoterNicknames)
  }

  const confirmClearAll = async () => {
    setClearAllConfirmOpen(false)
    await clearCurrentSchedule()
  }

  if (!loggedInNickname && isAutoLoggingIn) {
    return (
      <div className="login-screen">
        <div className="login-card auto-login-card" role="status">
          <p className="eyebrow centered">그루 레기온의 설원 스케줄</p>
          <h1>자동 로그인 중…</h1>
        </div>
      </div>
    )
  }

  if (!loggedInNickname && passwordSetup) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handlePasswordSetup}>
          <p className="eyebrow centered">그루 레기온의 설원 스케줄</p>
          <h1>비밀번호 설정</h1>

          <p className="login-subtitle">
            <strong className="save-confirm-nickname">{passwordSetup.nickname}</strong>님, 처음 로그인하셨어요.
            앞으로 사용할 본인 비밀번호를 정해 주세요. (숫자 4자리 이상)
          </p>

          <label htmlFor="setupNewPassword" className="login-label">새 비밀번호</label>
          <input
            id="setupNewPassword"
            className="login-input"
            type="password"
            inputMode="numeric"
            value={passwordForm.next}
            onChange={(event) => updatePasswordForm('next', event.target.value)}
            placeholder="숫자 4자리 이상"
            autoComplete="new-password"
          />

          <label htmlFor="setupConfirmPassword" className="login-label">새 비밀번호 확인</label>
          <input
            id="setupConfirmPassword"
            className="login-input"
            type="password"
            inputMode="numeric"
            value={passwordForm.confirm}
            onChange={(event) => updatePasswordForm('confirm', event.target.value)}
            placeholder="한 번 더 입력하세요"
            autoComplete="new-password"
          />

          <label htmlFor="setupHintQuestion" className="login-label">비밀번호 찾기 질문</label>
          <select
            id="setupHintQuestion"
            className="login-input"
            value={passwordForm.hintQuestion}
            onChange={(event) => updatePasswordForm('hintQuestion', event.target.value)}
          >
            <option value="" disabled>질문을 골라 주세요</option>
            {HINT_QUESTIONS.map((question) => (
              <option key={question} value={question}>
                {question}
              </option>
            ))}
          </select>

          <label htmlFor="setupHintAnswer" className="login-label">답</label>
          <input
            id="setupHintAnswer"
            className="login-input"
            type="text"
            value={passwordForm.hintAnswer}
            onChange={(event) => updatePasswordForm('hintAnswer', event.target.value)}
            placeholder="비밀번호를 잊었을 때 입력할 답 (띄어쓰기 무시)"
            autoComplete="off"
          />

          {passwordForm.error && <p className="login-error" role="alert">{passwordForm.error}</p>}

          <button type="submit" className="primary-button login-button">
            비밀번호 정하고 시작하기
          </button>
          <button type="button" className="secondary-button login-back-button" onClick={cancelPasswordSetup}>
            처음으로
          </button>
        </form>
      </div>
    )
  }

  if (!loggedInNickname && passwordReset) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={passwordReset.question ? handlePasswordReset : handlePasswordResetLookup}>
          <p className="eyebrow centered">그루 레기온의 설원 스케줄</p>
          <h1>비밀번호 찾기</h1>

          {!passwordReset.question ? (
            <>
              <p className="login-subtitle">닉네임을 입력하면 비밀번호를 정할 때 고른 질문을 보여 드려요.</p>

              <label htmlFor="resetNickname" className="login-label">닉네임</label>
              <input
                id="resetNickname"
                className="login-input"
                type="text"
                value={passwordReset.nickname}
                onChange={(event) => {
                  const nickname = event.target.value
                  setPasswordReset((prev) => ({ ...prev, nickname }))
                  updatePasswordForm('error', '')
                }}
                placeholder="본인 닉네임을 입력하세요"
                autoComplete="nickname"
              />
            </>
          ) : (
            <>
              <p className="login-subtitle">
                <strong className="save-confirm-nickname">{passwordReset.nickname}</strong>님의 질문에 답하고 새 비밀번호를 정해 주세요.
              </p>

              <p className="login-label">{passwordReset.question}</p>
              <input
                id="resetHintAnswer"
                className="login-input"
                type="text"
                aria-label={passwordReset.question}
                value={passwordForm.hintAnswer}
                onChange={(event) => updatePasswordForm('hintAnswer', event.target.value)}
                placeholder="답 (띄어쓰기 무시)"
                autoComplete="off"
              />

              <label htmlFor="resetNewPassword" className="login-label">새 비밀번호</label>
              <input
                id="resetNewPassword"
                className="login-input"
                type="password"
                inputMode="numeric"
                value={passwordForm.next}
                onChange={(event) => updatePasswordForm('next', event.target.value)}
                placeholder="숫자 4자리 이상"
                autoComplete="new-password"
              />

              <label htmlFor="resetConfirmPassword" className="login-label">새 비밀번호 확인</label>
              <input
                id="resetConfirmPassword"
                className="login-input"
                type="password"
                inputMode="numeric"
                value={passwordForm.confirm}
                onChange={(event) => updatePasswordForm('confirm', event.target.value)}
                placeholder="한 번 더 입력하세요"
                autoComplete="new-password"
              />
            </>
          )}

          {passwordForm.error && <p className="login-error" role="alert">{passwordForm.error}</p>}

          <button type="submit" className="primary-button login-button">
            {passwordReset.question ? '새 비밀번호로 바꾸고 시작하기' : '질문 확인'}
          </button>
          <button type="button" className="secondary-button login-back-button" onClick={cancelPasswordReset}>
            처음으로
          </button>
        </form>
      </div>
    )
  }

  if (!loggedInNickname) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <p className="eyebrow centered">그루 레기온의 설원 스케줄</p>
          <h1>닉네임 로그인</h1>

          {!isSharedMode && (
            <p className="login-warning">
              공유 캘린더 모드가 비활성화되어 있어요. 다른 PC/IP에서 스케줄을 보려면 Supabase 환경 변수를 연결해야 합니다.
            </p>
          )}

          <p className="login-subtitle">
            로그인한 닉네임으로 자신의 레이드 가능 시간을 저장하고 조회할 수 있어요.
            처음 로그인할 때는 안내받은 초기 비밀번호를 입력한 뒤 본인 비밀번호를 정해요.
          </p>

          <label htmlFor="loginNickname" className="login-label">닉네임</label>
          <input
            id="loginNickname"
            className="login-input"
            type="text"
            value={loginNickname}
            onChange={(event) => setLoginNickname(event.target.value)}
            placeholder="본인 닉네임을 입력하세요"
            autoComplete="nickname"
          />

          <label htmlFor="loginPassword" className="login-label">비밀번호</label>
          <input
            id="loginPassword"
            className="login-input"
            type="password"
            inputMode="numeric"
            value={loginPassword}
            onChange={(event) => {
              setLoginPassword(event.target.value)
              setLoginError('')
            }}
            placeholder="비밀번호를 입력하세요"
            autoComplete="current-password"
          />

          {loginError && <p className="login-error" role="alert">{loginError}</p>}

          <div className="remember-options">
            <label className="remember-row" htmlFor="rememberMe">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe || savePassword}
                disabled={savePassword}
                onChange={(event) => setRememberMe(event.target.checked)}
              />
              <span>닉네임 기억하기</span>
            </label>

            <label className="remember-row" htmlFor="savePassword">
              <input
                id="savePassword"
                type="checkbox"
                checked={savePassword}
                onChange={(event) => setSavePassword(event.target.checked)}
              />
              <span>비밀번호 저장</span>
            </label>
          </div>

          {savePassword && (
            <p className="remember-hint">개인 기기에서만 사용하세요. 로그아웃하면 저장된 비밀번호도 지워져요.</p>
          )}

          <button type="submit" className="primary-button login-button" disabled={isLoginPending}>
            {isLoginPending ? '확인 중...' : '로그인'}
          </button>
          <button type="button" className="text-link-button" onClick={openPasswordReset}>
            비밀번호를 잊으셨나요?
          </button>
        </form>
      </div>
    )
  }

  // '내 다음 레이드' 카드에 보여 줄 시간대 정보 (인원 · 리딩 · 준비 확인 상태)
  const myUpcomingSlotDetails = myUpcomingSlots.map((slot) => {
    const run = { weekStart: weekStartKey, day: slot.day, time: slot.time, raidName: slot.raidName, difficulty: slot.difficulty, mode: slot.mode }
    const runKey = getRaidRunKey(run)
    const runRecord = raidRunByKey.get(runKey)
    const people = memberByRaidDateTime.get(`${slot.day}-${slot.time}`)?.[`${slot.raidName} ${slot.difficulty} ${slot.mode}`] ?? []
    const { partyA, partyB, waiting } = buildBalancedParties(people)
    const isInParty = (party) => party.some((person) => person.nickname === slot.nickname)
    const waitingIndex = waiting.findIndex((person) => person.nickname === slot.nickname)
    // 준비 확인은 정원에 든 사람만 센다. (DB의 _raid_slot_roster와 같은 기준)
    const voterNicknames = [...new Set(people.slice(0, RAID_FULL_SIZE).map((person) => person.nickname))]
    const rallyCheckins = runRecord?.rallyCheckins ?? []

    return {
      ...slot,
      run,
      runKey,
      people,
      voterNicknames,
      leaderCount: people.filter((person) => person.leadReady === 'O').length,
      isRallyCalled: Boolean(runRecord?.rallyCalledAt),
      isGathered: Boolean(runRecord?.gatheredAt),
      checkedCount: voterNicknames.filter((name) => rallyCheckins.includes(name)).length,
      isMeChecked: rallyCheckins.includes(slot.nickname),
      isWaitlisted: waitingIndex >= 0,
      partyLabel: waitingIndex >= 0 ? `대기 ${waitingIndex + 1}번` : isInParty(partyA) ? 'A파티' : isInParty(partyB) ? 'B파티' : '',
      canCallRally: slot.startTime - currentTime.getTime() <= RALLY_OPEN_BEFORE_MS,
    }
  })
  // '내 레이드만 보기'를 켜면 내 캐릭터(본캐 + 부캐)가 투표한 시간대만 남긴다.
  const visibleDayRaidSummary = showOnlyMine
    ? dayRaidSummary.map(({ day, raidGroups }) => ({
      day,
      raidGroups: raidGroups
        .map((group) => ({
          ...group,
          times: group.times.filter((time) => (
            (group.timeMembers[time] ?? []).some((memberKey) => myCharacters.includes(memberKey.split('|')[0]))
          )),
        }))
        .filter((group) => group.times.length > 0),
    }))
    : dayRaidSummary

  const toggleShowOnlyMine = () => {
    setShowOnlyMine((prev) => {
      try {
        localStorage.setItem(ONLY_MINE_STORAGE_KEY, prev ? '0' : '1')
      } catch {
        // Ignore storage errors.
      }

      return !prev
    })
  }

  // 아직 안 지난 시간 중 모이기 좋은 시간 TOP 3. (targets: 볼 레이드 조합 목록)
  // 정원이 차고 리더가 있어 갈 수 있는 시간을 먼저, 그다음 인원이 많은 순(정원 초과는 같은 인원으로 본다),
  // 같으면 리더가 있는 시간, 그래도 같으면 이른 시간 순이다.
  const isConfirmedSlot = (slot) => slot.people.length >= RAID_FULL_SIZE && slot.leaderCount > 0

  const buildRecommendedSlots = (targets) => targets
    .flatMap(({ raidName, difficulty, mode }) => weekdayNames.flatMap((day) => timeSlots.map((time) => {
      const people = memberByRaidDateTime.get(`${day}-${time}`)?.[`${raidName} ${difficulty} ${mode}`] ?? []
      return { raidName, difficulty, mode, day, time, people, leaderCount: people.filter((person) => person.leadReady === 'O').length }
    })))
    .filter((slot) => slot.people.length > 0 && !isPastSlot(slot.day, slot.time))
    .sort((a, b) => (
      isConfirmedSlot(b) - isConfirmedSlot(a)
      || Math.min(b.people.length, RAID_FULL_SIZE) - Math.min(a.people.length, RAID_FULL_SIZE)
      || (b.leaderCount > 0) - (a.leaderCount > 0)
      || getSlotStartDate(weekDates, a.day, a.time) - getSlotStartDate(weekDates, b.day, b.time)
    ))
    .slice(0, 3)

  // 주간 레이드 슬롯 제목 아래에 보여 줄 추천 시간. 모든 레이드 조합을 통틀어 고른다.
  const recommendedSlots = buildRecommendedSlots(
    visibleRaidTabs.flatMap((tab) => modeOptions.map((mode) => ({ raidName: tab.raid, difficulty: tab.difficulty, mode }))),
  )

  // 추천 시간을 누르면 그 레이드 탭으로 바꾸고 캘린더의 그 칸으로 스크롤해 잠깐 강조한다. (모바일은 캘린더 화면 · 그 요일로 넘어간다)
  const focusCalendarSlot = ({ raidName, difficulty, mode, day, time }) => {
    const slotKey = `${day}-${time}`

    showScheduleInCalendar({ raidName, difficulty, mode })
    setMobileSection('calendar')
    setMobileCalendarDayIndex(weekdayNames.indexOf(day))

    if (hiddenWeekdayTimeSlots.includes(time)) {
      setShowDaytimeSlots(true)
    }

    setHighlightedSlotKey(slotKey)
    // 페이지는 세로로만 움직이고, 가로는 캘린더 안에서만 스크롤한다. (scrollIntoView는 페이지까지 옆으로 밀 수 있다)
    setTimeout(() => {
      const cell = document.getElementById(`calendar-slot-${slotKey}`)
      const grid = cell?.closest('.calendar-grid')

      if (!cell || !grid) {
        return
      }

      const cellRect = cell.getBoundingClientRect()
      const gridRect = grid.getBoundingClientRect()

      window.scrollTo({ top: window.scrollY + cellRect.top - Math.max(0, (window.innerHeight - cellRect.height) / 2), behavior: 'smooth' })
      grid.scrollTo({ left: grid.scrollLeft + cellRect.left - gridRect.left - (grid.clientWidth - cellRect.width) / 2, behavior: 'smooth' })
    }, 0)
    setTimeout(() => {
      setHighlightedSlotKey((prev) => (prev === slotKey ? '' : prev))
    }, 2500)
  }

  // 내가 준비 완료를 눌러야 하는 시간대가 있으면 그것을 먼저, 없으면 가장 가까운 시간대를 보여 준다.
  const isWaitingForMe = (slot) => slot.isRallyCalled && !slot.isGathered && !slot.isMeChecked && !slot.isWaitlisted
  const nextRaidSlot = myUpcomingSlotDetails.find(isWaitingForMe) ?? myUpcomingSlotDetails[0] ?? null
  const nextRaidNeedsMe = Boolean(nextRaidSlot && isWaitingForMe(nextRaidSlot))
  const laterRaidSlots = myUpcomingSlotDetails.filter((slot) => slot !== nextRaidSlot)

  // 비어 있는 목록의 문구. 아직 못 불러온 상태를 '신청 없음'으로 보여 주지 않는다.
  const getEmptyText = (text) => {
    if (dataLoadState === 'loading') {
      return '불러오는 중…'
    }

    return dataLoadState === 'error' ? '불러오지 못했어요' : text
  }

  const renderJoinButton = (slot, peopleCount, extraClass = '') => (
    canJoinSlot(slot) ? (
      <button
        type="button"
        className={`join-slot-button ${extraClass}`}
        disabled={isSaving}
        title={`${currentNickname}(으)로 ${slot.day}요일 ${formatTimeLabel(slot.time)}에 신청해요.`}
        onClick={() => joinSlot(slot)}
      >
        {peopleCount >= RAID_FULL_SIZE ? '+ 대기 신청' : '+ 나도 참여'}
      </button>
    ) : null
  )

  return (
    <div className="app-shell" data-mobile-section={mobileSection}>
      <header className="topbar">
        <div className="topbar-title">
          <p className="eyebrow">그루 레기온의 설원</p>
          <h1>스케줄</h1>
          <span className="mobile-section-name">{mobileSectionLabel}</span>
        </div>
        <button
          type="button"
          className="mobile-menu-button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="메뉴 열기"
          aria-expanded={mobileMenuOpen}
        >
          <span />
          <span />
          <span />
        </button>
        <div className="user-header-actions">
          {!isSharedMode && (
            <div className="shared-mode-warning">
              공유 저장소가 비활성화됨 · 다른 IP에서 보이지 않음
            </div>
          )}
          <div className="live-clock">
            <span>실시간</span>
            <LiveClock />
          </div>
          <div className="user-badge-wrap">
            <span className="user-badge" title={loggedInNickname}>
              <span className="user-badge-name">{loggedInNickname}</span>
            </span>
            <button type="button" className="secondary-button small-logout" onClick={openPasswordChange}>
              비밀번호 변경
            </button>
            <button type="button" className="secondary-button small-logout" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      {/* 모바일 하단 탭: 메뉴를 열지 않고 한 번에 화면을 바꾼다. (PC에서는 숨김) */}
      <nav className="mobile-tabbar" aria-label="화면 이동">
        {MOBILE_SECTIONS.map((section) => (
          <button
            key={section.id}
            type="button"
            className={`mobile-tab ${mobileSection === section.id ? 'active' : ''}`}
            onClick={() => selectMobileSection(section.id)}
            aria-current={mobileSection === section.id ? 'page' : undefined}
            aria-label={section.id === 'form' && hasUnsavedChanges ? `${section.label} (저장하지 않은 변경 있음)` : section.label}
          >
            <MobileTabIcon id={section.id} />
            <span>{section.short}</span>
            {section.id === 'form' && hasUnsavedChanges && <i className="mobile-tab-dot" aria-hidden="true" />}
          </button>
        ))}
      </nav>

      {mobileMenuOpen && (
        <div className="mobile-nav-backdrop" onClick={() => setMobileMenuOpen(false)}>
          <nav className="mobile-nav-drawer" aria-label="메뉴" onClick={(event) => event.stopPropagation()}>
            <div className="mobile-nav-head">
              <span className="user-badge">{loggedInNickname}</span>
              <button type="button" className="mobile-nav-close" onClick={() => setMobileMenuOpen(false)} aria-label="메뉴 닫기">
                ✕
              </button>
            </div>
            <div className="mobile-nav-clock">
              <span>실시간</span>
              <LiveClock />
            </div>
            {!isSharedMode && (
              <div className="shared-mode-warning">
                공유 저장소가 비활성화됨 · 다른 IP에서 보이지 않음
              </div>
            )}
            <div className="mobile-nav-actions">
              <button type="button" className="secondary-button" onClick={openPasswordChangeFromMenu}>
                비밀번호 변경
              </button>
              {supabase && (
                <button type="button" className="secondary-button" onClick={openAltManager}>
                  부캐 관리
                </button>
              )}
              <button type="button" className="secondary-button" onClick={handleLogout}>
                로그아웃
              </button>
            </div>
          </nav>
        </div>
      )}

      {altManagerOpen && (
        <div className="save-confirm-backdrop" onClick={() => setAltManagerOpen(false)}>
          <form className="save-confirm-modal password-change-modal" onClick={(event) => event.stopPropagation()} onSubmit={handleLinkAlt}>
            <h3>부캐 관리</h3>
            <p className="alt-manager-desc">
              부캐를 연결하면 <strong>{loggedInNickname}</strong>(으)로 로그인한 채 신청 폼에서 캐릭터를 바꿔 신청할 수 있어요.
              부캐 닉네임으로는 따로 로그인하지 않고, 본캐와 부캐는 같은 요일 · 시간에 함께 신청할 수 없어요.
            </p>

            {myAltNicknames.length > 0 ? (
              <ul className="alt-list">
                {myAltNicknames.map((altNickname) => (
                  <li key={altNickname} className="alt-list-item">
                    <span>{altNickname}</span>
                    <button type="button" className="alt-unlink-button" onClick={() => handleUnlinkAlt(altNickname)}>
                      연결 해제
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="field-hint">아직 연결한 부캐가 없어요.</p>
            )}

            <label htmlFor="altNickname" className="login-label">부캐 닉네임</label>
            <input
              id="altNickname"
              className="login-input"
              type="text"
              value={altForm.nickname}
              onChange={(event) => setAltForm((prev) => ({ ...prev, nickname: event.target.value, error: '' }))}
              autoComplete="off"
            />

            <label htmlFor="altPassword" className="login-label">부캐 비밀번호 (부캐로 비밀번호를 정해 둔 경우만)</label>
            <input
              id="altPassword"
              className="login-input"
              type="password"
              inputMode="numeric"
              value={altForm.password}
              onChange={(event) => setAltForm((prev) => ({ ...prev, password: event.target.value, error: '' }))}
              placeholder="처음 쓰는 닉네임이면 비워 두세요"
              autoComplete="off"
            />

            {altForm.error && <p className="login-error" role="alert">{altForm.error}</p>}

            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setAltManagerOpen(false)}>
                닫기
              </button>
              <button type="submit" className="primary-button" disabled={altForm.pending}>
                {altForm.pending ? '연결 중…' : '부캐 연결'}
              </button>
            </div>
          </form>
        </div>
      )}

      {passwordChangeOpen && (
        <div className="save-confirm-backdrop" onClick={() => setPasswordChangeOpen(false)}>
          <form className="save-confirm-modal password-change-modal" onClick={(event) => event.stopPropagation()} onSubmit={handlePasswordChange}>
            <h3>비밀번호 변경</h3>

            <label htmlFor="currentPassword" className="login-label">지금 비밀번호</label>
            <input
              id="currentPassword"
              className="login-input"
              type="password"
              inputMode="numeric"
              value={passwordForm.current}
              onChange={(event) => updatePasswordForm('current', event.target.value)}
              autoComplete="current-password"
            />

            <label htmlFor="changeNewPassword" className="login-label">새 비밀번호</label>
            <input
              id="changeNewPassword"
              className="login-input"
              type="password"
              inputMode="numeric"
              value={passwordForm.next}
              onChange={(event) => updatePasswordForm('next', event.target.value)}
              placeholder="숫자 4자리 이상"
              autoComplete="new-password"
            />

            <label htmlFor="changeConfirmPassword" className="login-label">새 비밀번호 확인</label>
            <input
              id="changeConfirmPassword"
              className="login-input"
              type="password"
              inputMode="numeric"
              value={passwordForm.confirm}
              onChange={(event) => updatePasswordForm('confirm', event.target.value)}
              autoComplete="new-password"
            />

            {passwordForm.error && <p className="login-error" role="alert">{passwordForm.error}</p>}
            {passwordForm.message && <p className="password-success" role="status">{passwordForm.message}</p>}

            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setPasswordChangeOpen(false)}>
                닫기
              </button>
              <button type="submit" className="primary-button">
                변경
              </button>
            </div>
          </form>
        </div>
      )}

      {restoreConfirmOpen && (
        <div className="save-confirm-backdrop" onClick={() => setRestoreConfirmOpen(false)}>
          <div className="save-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>지난 신청을 다시 등록할까요?</h3>
            <p>
              <span className="save-confirm-nickname">{currentNickname}</span>
              의 지난 신청 중 고른 것을 이번 주 신청으로 저장해요. 이번 주 다른 신청과 겹치는 시간은 빼고 등록해요.
            </p>
            <div className="restore-list-head">
              <span>{selectedRestoreSchedules.length} / {restorableSchedules.length}건 선택</span>
              <button
                type="button"
                className="restore-select-all"
                onClick={() => setRestoreSelectedKeys(
                  selectedRestoreSchedules.length === restorableSchedules.length
                    ? []
                    : restorableSchedules.map((entry) => getScheduleKey(entry)),
                )}
              >
                {selectedRestoreSchedules.length === restorableSchedules.length ? '전체 해제' : '전체 선택'}
              </button>
            </div>
            <ul className="restore-list">
              {restorableSchedules.map((entry) => {
                const key = getScheduleKey(entry)
                const savedDate = new Date(entry.updatedAt)
                const isSelected = restoreSelectedKeys.includes(key)

                return (
                  <li key={key}>
                    <label className={`restore-item${isSelected ? ' selected' : ''}`}>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRestoreKey(key)} />
                      <span className="restore-item-text">
                        <strong>{formatScheduleKey(key)}</strong>
                        <span>{formatDayTimeSelection(entry.dayTimeSelection)}</span>
                        {!Number.isNaN(savedDate.getTime()) && (
                          <small>{savedDate.getMonth() + 1}/{savedDate.getDate()} 저장</small>
                        )}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setRestoreConfirmOpen(false)}>
                취소
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={restoreSchedules}
                disabled={selectedRestoreSchedules.length === 0}
              >
                {selectedRestoreSchedules.length > 0 ? `${selectedRestoreSchedules.length}건 다시 등록` : '골라 주세요'}
              </button>
            </div>
          </div>
        </div>
      )}

      {memberDetail && (
        <div className="save-confirm-backdrop" onClick={() => setMemberDetail(null)}>
          <div className="save-confirm-modal member-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="member-detail-head">
              <img src={getClassIconPath(memberDetail.className)} alt="" className="member-detail-icon" />
              <div>
                <h3>{memberDetail.nickname}</h3>
                <span>{memberDetail.className}</span>
              </div>
            </div>
            <dl className="member-detail-list">
              <dt>전투력</dt>
              <dd>{memberDetail.power}</dd>
              <dt>리딩</dt>
              <dd>{memberDetail.leadReady === 'O' ? '가능' : '불가'}</dd>
              {altOwnerByNickname.has(memberDetail.nickname) && (
                <>
                  <dt>본캐</dt>
                  <dd>{altOwnerByNickname.get(memberDetail.nickname)}</dd>
                </>
              )}
            </dl>
            <button type="button" className="secondary-button member-detail-close" onClick={() => setMemberDetail(null)}>
              닫기
            </button>
          </div>
        </div>
      )}

      <div className="toast-stack" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast is-${toast.type}`}
            role={toast.type === 'error' ? 'alert' : 'status'}
            onClick={() => dismissToast(toast.id)}
          >
            <span className="toast-message">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="toast-action"
                disabled={isSaving}
                onClick={(event) => {
                  event.stopPropagation()
                  dismissToast(toast.id)
                  toast.action.onClick()
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>

      {pendingRunStatus && (
        <div className="save-confirm-backdrop" onClick={() => setPendingRunStatus(null)}>
          <div className="save-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>
              {pendingRunStatus.action === 'call' ? '준비 확인을 시작할까요?'
                : pendingRunStatus.action === 'cancel' ? '준비 확인을 취소할까요?'
                : pendingRunStatus.action === 'remind' ? '준비 확인을 다시 알릴까요?'
                : pendingRunStatus.action === 'start' ? '이 인원으로 시작할까요?'
                : '클리어로 표시할까요?'}
            </h3>
            <p>
              <span className="save-confirm-nickname">
                {pendingRunStatus.run.raidName} · {pendingRunStatus.run.difficulty} · {pendingRunStatus.run.mode}
              </span>
              {` ${pendingRunStatus.run.day}요일 ${formatTimeLabel(pendingRunStatus.run.time)} 레이드`}
              {pendingRunStatus.action === 'call' && '의 준비 확인을 시작합니다. 정원에 든 사람이 모두 준비 완료를 누르면 전원 준비가 돼요.'}
              {pendingRunStatus.action === 'start' && '를 지금 준비한 인원으로 시작합니다. 아직 준비하지 않은 사람을 기다리지 않고 전원 준비로 넘어가요.'}
              {pendingRunStatus.action === 'cancel' && '의 준비 확인을 취소합니다. 지금까지의 준비 완료와 클리어 표시도 함께 지워져요.'}
              {pendingRunStatus.action === 'remind' && '의 준비 확인을 디스코드로 한 번 더 알립니다. 지금 신청한 인원과 아직 준비 안 한 인원이 함께 가요. (시간대마다 두 번까지)'}
              {pendingRunStatus.action === 'cleared' && '를 클리어(O)로 표시합니다.'}
              {supabase && pendingRunStatus.action === 'start' && ' 디스코드 알림이 연결되어 있으면 채널에 알림이 가요.'}
              {supabase && (pendingRunStatus.action === 'call' || pendingRunStatus.action === 'cleared') && (pendingRunStatus.alreadyNotified
                ? ' 이 시간대는 이미 디스코드로 알렸기 때문에 다시 알리지 않아요.'
                : ' 디스코드 알림이 연결되어 있으면 채널에 알림이 가요.')}
            </p>
            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingRunStatus(null)}>
                {pendingRunStatus.action === 'cancel' ? '닫기' : '취소'}
              </button>
              <button type="button" className="primary-button" onClick={confirmPendingRunStatus}>
                {pendingRunStatus.action === 'call' ? '호출'
                  : pendingRunStatus.action === 'cancel' ? '호출 취소'
                  : pendingRunStatus.action === 'remind' ? '다시 알림'
                  : pendingRunStatus.action === 'start' ? '시작' : '표시'}
              </button>
            </div>
          </div>
        </div>
      )}

      {clearAllConfirmOpen && (
        <div className="save-confirm-backdrop" onClick={() => setClearAllConfirmOpen(false)}>
          <div className="save-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>내 스케줄을 전부 삭제할까요?</h3>
            <p>
              <span className="save-confirm-nickname">{currentNickname || '현재 프로필'}</span>
              의 모든 레이드 시간 정보를 삭제하시겠습니까
            </p>
            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setClearAllConfirmOpen(false)}>
                취소
              </button>
              <button type="button" className="primary-button" onClick={confirmClearAll}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      {dataLoadState === 'error' && (
        <div className="data-load-banner" role="alert">
          <span>최신 현황을 불러오지 못했어요. 지금 보이는 내용이 오래됐을 수 있어요.</span>
          <button type="button" className="secondary-button small-toggle" onClick={loadRemoteData}>
            다시 불러오기
          </button>
        </div>
      )}

      <section className="summary-grid">
        <article className="summary-card accent" data-section="form">
          <span className="label">다음 리셋</span>
          <ResetCountdown />
        </article>

        <article className={`summary-card next-raid-card ${nextRaidNeedsMe ? 'needs-action' : ''}`}>
          <span className="label">{nextRaidNeedsMe ? '준비 확인 요청이 왔어요' : '내 다음 레이드'}</span>
          {nextRaidSlot ? (
            <>
              <strong>
                {nextRaidSlot.day}요일 {formatTimeLabel(nextRaidSlot.time)} · {nextRaidSlot.raidName} {nextRaidSlot.difficulty} {nextRaidSlot.mode}
              </strong>
              <small>
                {formatTimeUntil(nextRaidSlot.startTime - currentTime.getTime())}
                {` · ${nextRaidSlot.people.length}/${RAID_FULL_SIZE}명 · 리딩 ${nextRaidSlot.leaderCount}명`}
                {nextRaidSlot.partyLabel && ` · ${nextRaidSlot.partyLabel}`}
                {nextRaidSlot.nickname !== loggedInNickname && ` · ${nextRaidSlot.nickname}`}
              </small>
              <div className="next-raid-actions">
                {!nextRaidSlot.isRallyCalled ? (
                  nextRaidSlot.canCallRally ? (
                    <button
                      type="button"
                      className="day-raid-rally-button"
                      disabled={savingRunKey === nextRaidSlot.runKey}
                      onClick={() => handleRallyClick(nextRaidSlot.run, 'call', nextRaidSlot.voterNicknames)}
                    >
                      📣 준비 확인 시작
                    </button>
                  ) : (
                    <span className="next-raid-hint">시작 1시간 전부터 준비 확인을 할 수 있어요</span>
                  )
                ) : nextRaidSlot.isGathered ? (
                  <span className="next-raid-status is-yes">
                    전원 준비 {nextRaidSlot.checkedCount}/{nextRaidSlot.voterNicknames.length}
                  </span>
                ) : (
                  <>
                    <span className="next-raid-status is-pending">
                      준비 {nextRaidSlot.checkedCount}/{nextRaidSlot.voterNicknames.length}
                    </span>
                    {!nextRaidSlot.isWaitlisted && (
                      <button
                        type="button"
                        className={`day-raid-rally-button ${nextRaidSlot.isMeChecked ? 'active' : 'is-primary'}`}
                        aria-pressed={nextRaidSlot.isMeChecked}
                        disabled={savingRunKey === nextRaidSlot.runKey}
                        onClick={() => handleRallyClick(nextRaidSlot.run, nextRaidSlot.isMeChecked ? 'uncheck' : 'check', nextRaidSlot.voterNicknames)}
                      >
                        {nextRaidSlot.isMeChecked ? '준비 취소' : '✓ 준비 완료'}
                      </button>
                    )}
                  </>
                )}
                <button type="button" className="next-raid-link" onClick={() => openSlotInDaySummary(nextRaidSlot)}>
                  현황 보기
                </button>
              </div>
              {laterRaidSlots.length > 0 && (
                <small className="next-raid-later">
                  이후: {laterRaidSlots.slice(0, 2).map((slot) => `${slot.day} ${formatTimeLabel(slot.time)} ${slot.raidName} ${slot.difficulty}`).join(' / ')}
                  {laterRaidSlots.length > 2 && ` 외 ${laterRaidSlots.length - 2}건`}
                </small>
              )}
            </>
          ) : (
            <>
              <strong>{getEmptyText('이번 주 남은 신청 없음')}</strong>
              {dataLoadState === 'ready' && (
                <small>
                  {restorableSchedules.length > 0
                    ? '내 시간 등록에서 지난 신청을 불러와 다시 등록할 수 있어요.'
                    : '내 시간 등록에서 가능한 시간을 골라 주세요.'}
                </small>
              )}
            </>
          )}
        </article>
      </section>

      <main className="content-grid">
        <section className="panel form-panel" data-section="form">
          <div className="panel-header">
            <h2>나의 레이드 가능 시간</h2>
            <button
              type="button"
              className="help-toggle"
              onClick={() => setHelpOpen((prev) => !prev)}
              aria-label="사용 방법 보기"
              aria-expanded={helpOpen}
            >
              ?
            </button>
          </div>

          {helpOpen && (
            <div className="help-panel">
              <p>1. '내 캐릭터'에서 직업 · 전투력 · 리딩 여부를 정해요. 캐릭터마다 한 번 정해 두면 계속 쓰여요.</p>
              <p>2. 신청할 레이드 · 난이도 · 공략 방식을 골라요. 요일 · 시간은 레이드 조합마다 따로 저장돼요.</p>
              <p>3. 시간표에서 가능한 칸을 누르거나 끌어서 골라요. 요일 · 시간 머리를 누르면 그 줄 전체가 골라져요. 24:00은 그 요일 밤 12시예요.</p>
              <p>4. 저장하면 주간 캘린더와 요일별 현황에 바로 반영돼요. 직업 · 전투력 · 리딩을 바꿨으면 저장할 때 이 캐릭터의 다른 신청에도 함께 반영돼요.</p>
              <p>5. 못 가는 시간은 시간표에서 빼고 저장해요. 시간을 모두 빼면 저장 버튼이 '신청 삭제'로 바뀌어요.</p>
              <p>6. 현황을 보다가 '나도 참여'를 누르면 그 시간대에 바로 신청돼요. 시간대마다 먼저 신청한 10명이 정원이고, 시간을 다시 저장해도 순서는 그대로예요.</p>
              <p>7. 수요일 리셋 뒤에는 '지난 신청 불러오기'로 지난 신청을 골라 다시 등록할 수 있어요. 다시 등록한 뒤 지운 신청도 다시 불러올 수 있어요.</p>
            </div>
          )}

          {restorableSchedules.length > 0 && (
            <div className="restore-callout">
              <div className="restore-callout-text">
                <strong>지난 신청 {restorableSchedules.length}건이 있어요</strong>
                <span>{restorableSchedules.map((entry) => formatScheduleKey(getScheduleKey(entry))).join(' / ')}</span>
              </div>
              <button
                type="button"
                className="secondary-button small-toggle"
                onClick={openRestoreConfirm}
                disabled={isSaving}
              >
                불러오기
              </button>
            </div>
          )}

          <div className="form-section">
            <h3 className="form-section-title">내 캐릭터</h3>

            {isCharacterInfoComplete && !characterEditOpen ? (
              <div className="character-summary">
                <img src={getClassIconPath(profile.className)} alt="" className="character-summary-icon" />
                <span className="character-summary-text">
                  <strong>{currentNickname}</strong>
                  <span>{profile.className} · {profile.power} · {profile.leadReady === 'O' ? '리딩 가능' : '리딩 불가'}</span>
                </span>
                <button type="button" className="secondary-button small-toggle" onClick={() => setCharacterEditOpen(true)}>
                  {myAltNicknames.length > 0 ? '캐릭터 · 정보 변경' : '정보 수정'}
                </button>
              </div>
            ) : (
              <>
            <div className="field-group">
              <div className="field-label-row">
                <label htmlFor="nickname">{myAltNicknames.length > 0 ? '캐릭터' : '닉네임'}</label>
                {supabase && (
                  <button type="button" className="alt-manage-button" onClick={openAltManager}>
                    부캐 관리{myAltNicknames.length > 0 ? ` (${myAltNicknames.length})` : ''}
                  </button>
                )}
              </div>
              {myAltNicknames.length > 0 ? (
                <select
                  id="nickname"
                  value={currentNickname}
                  onChange={(event) => confirmDiscardUnsaved() && switchCharacter(event.target.value)}
                  title="신청할 캐릭터를 골라요. 부캐도 본캐 비밀번호로 저장돼요."
                >
                  {myCharacters.map((nickname) => (
                    <option key={nickname} value={nickname}>
                      {nickname === loggedInNickname ? `${nickname} (본캐)` : `${nickname} (부캐)`}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="nickname"
                  type="text"
                  value={profile.nickname}
                  readOnly
                  title="닉네임은 로그인한 닉네임으로 고정돼요."
                />
              )}
            </div>

            <div className="two-column">
              <div className="field-group">
                <label htmlFor="className">직업</label>
                <select
                  id="className"
                  value={profile.className}
                  onChange={(event) => updateCharacterField('className', event.target.value)}
                >
                  <option value="" disabled>선택</option>
                  {classOptions.map((className) => (
                    <option key={className} value={className}>
                      {className}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-group">
                <label htmlFor="power">전투력</label>
                <select
                  id="power"
                  value={profile.power}
                  onChange={(event) => updateCharacterField('power', event.target.value)}
                >
                  <option value="" disabled>선택</option>
                  {powerOptions.map((power) => (
                    <option key={power} value={power}>
                      {power}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="field-group">
              <label>리딩 여부</label>
              <div className="chip-grid segmented" role="group" aria-label="리딩 여부">
                {[['O', '리딩 가능'], ['X', '리딩 불가']].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={profile.leadReady === value ? 'chip active' : 'chip'}
                    aria-pressed={profile.leadReady === value}
                    onClick={() => updateCharacterField('leadReady', value)}
                  >
                    <span className="chip-lead-mark"><LeadMark value={value} /></span>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {isCharacterInfoComplete && (
              <button type="button" className="text-link-button character-collapse-button" onClick={() => setCharacterEditOpen(false)}>
                한 줄로 접기
              </button>
            )}
              </>
            )}

            {/* 신청마다 직업 · 전투력 · 리딩이 따로 저장되므로, 바꾼 값이 아직 안 들어간 신청이 있으면 한 번에 반영할 수 있게 한다. */}
            {outdatedCharacterSchedules.length > 0 && (
              <div className="character-sync-notice">
                <span>
                  저장된 신청 {outdatedCharacterSchedules.length}건이 예전 캐릭터 정보예요.
                </span>
                <button
                  type="button"
                  className="secondary-button small-toggle"
                  onClick={handleCharacterSyncClick}
                  disabled={isSaving}
                >
                  모두 반영
                </button>
              </div>
            )}
          </div>

          <div className="form-section" id="schedule-target-field">
            <h3 className="form-section-title">신청할 레이드</h3>

            {/* 신청이 여러 개면 여기서 바로 바꿔 가며 고친다. (하나뿐이면 로그인할 때 이미 불러와 있다) */}
            {mySavedSchedules.length > 1 && (
              <div className="field-group">
                <label>내 신청 불러오기</label>
                <div className="chip-grid" role="group" aria-label="내 신청 불러오기">
                  {mySavedSchedules.map((entry) => {
                    const entryKey = getScheduleKey(entry)

                    return (
                      <button
                        key={entryKey}
                        type="button"
                        className={entryKey === currentScheduleKey ? 'chip active' : 'chip'}
                        aria-pressed={entryKey === currentScheduleKey}
                        onClick={() => loadScheduleIntoForm(entry)}
                      >
                        {entry.raidName} {entry.difficulty} {entry.mode}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <div className={`field-group ${showTargetWarning && !selectedRaidLabel ? 'is-missing' : ''}`}>
              <label>레이드</label>
              <div className="chip-grid segmented" role="group" aria-label="레이드">
                {raidOptions.map((raid) => (
                  <button
                    key={raid.id}
                    type="button"
                    className={selectedRaidLabel === raid.label ? 'chip active' : 'chip'}
                    aria-pressed={selectedRaidLabel === raid.label}
                    onClick={() => setProfile((prev) => ({ ...prev, raidFocus: raid.id }))}
                  >
                    {raid.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="two-column">
              <div className={`field-group ${showTargetWarning && !profile.difficulty ? 'is-missing' : ''}`}>
                <label>난이도</label>
                <div className="chip-grid segmented" role="group" aria-label="난이도">
                  {difficultyOptions.map((difficulty) => (
                    <button
                      key={difficulty}
                      type="button"
                      className={profile.difficulty === difficulty ? 'chip active' : 'chip'}
                      aria-pressed={profile.difficulty === difficulty}
                      onClick={() => setProfile((prev) => ({ ...prev, difficulty }))}
                    >
                      {difficulty}
                    </button>
                  ))}
                </div>
              </div>

              <div className={`field-group ${showTargetWarning && !profile.mode ? 'is-missing' : ''}`}>
                <label>공략 방식</label>
                <div className="chip-grid segmented" role="group" aria-label="공략 방식">
                  {modeOptions.map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={profile.mode === mode ? 'chip active' : 'chip'}
                      aria-pressed={profile.mode === mode}
                      onClick={() => setProfile((prev) => ({ ...prev, mode }))}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

          </div>

          <div className="form-section" id="schedule-day-field">
            <div className="field-label-row">
              <h3 className="form-section-title">요일 · 시간</h3>
              {/* 주말 · 공휴일 낮시간(12~16시)은 켰을 때만 시간표에 줄이 생긴다. */}
              <button
                type="button"
                className="secondary-button small-toggle"
                onClick={() => setShowDaytimeSlots((prev) => !prev)}
                aria-pressed={showDaytimeSlots}
              >
                {showDaytimeSlots ? '낮시간 숨기기' : '주말 · 공휴일 낮시간 보기'}
              </button>
            </div>
            <p className="field-hint">
              {isScheduleTargetSelected
                ? '칸을 눌러 골라요. (PC는 끌어서 여러 칸) 요일 · 시간 머리를 누르면 그 줄 전체를 고르거나 지워요. 24:00은 그 요일 밤 12시예요.'
                : '레이드, 난이도, 공략 방식을 먼저 선택해 주세요.'}
            </p>
            <div className="time-pick-wrap">
              {/* 레이드 조합을 고르기 전에는 시간표 위에 안내를 덮어, 눌러도 왜 안 되는지 바로 알 수 있게 한다. */}
              {!isScheduleTargetSelected && (
                <button type="button" className="time-pick-overlay" onClick={warnScheduleTargetMissing}>
                  <span className="time-pick-overlay-card">
                    <strong>레이드 · 난이도 · 공략 방식을 먼저 골라 주세요</strong>
                    <span>누르면 고르는 곳으로 이동해요 ↑</span>
                  </span>
                </button>
              )}
              <div className={`time-pick-grid ${isScheduleTargetSelected ? '' : 'is-disabled'}`} aria-label="요일 · 시간 선택">
                <span className="time-pick-corner" aria-hidden="true" />
                {weekdayNames.map((day, dayIndex) => (
                  <button
                    key={day}
                    type="button"
                    className={`time-pick-head${day === '토' ? ' is-sat' : ''}${day === '일' || holidaySet.has(formatIsoDate(weekDates[dayIndex])) ? ' is-sun' : ''}`}
                    onClick={() => toggleTimeLine(formTimeRows.map((time) => [day, time]))}
                    title={`${day}요일 전체 고르기 / 지우기`}
                  >
                    {day}
                  </button>
                ))}
                {formTimeRows.map((time) => (
                  <Fragment key={time}>
                    <button
                      type="button"
                      className="time-pick-head is-row"
                      onClick={() => toggleTimeLine(weekdayNames.map((day) => [day, time]))}
                      title={`매일 ${formatTimeLabel(time)} 고르기 / 지우기`}
                    >
                      {formatTimeLabel(time)}
                    </button>
                    {weekdayNames.map((day) => {
                      if (!getSelectableTimesForSelectedDay(day).includes(time)) {
                        return <span key={`${day}-${time}`} className="time-pick-cell is-unavailable" aria-hidden="true" />
                      }

                      const isSelected = (currentDayTimeSelection[day] ?? []).includes(time)
                      // 같은 계정의 다른 신청이 있는 시간. 이미 골라 둔 시간이면 뺄 수 있게 눌리도록 둔다.
                      const takenBy = takenSlots.get(`${day}|${time}`)
                      // 막힌 칸도 눌리게 두어(disabled 대신 aria-disabled), 누르면 이유를 알림으로 띄운다.
                      const blockReason = getSlotBlockReason(day, time, isSelected)

                      return (
                        <button
                          key={`${day}-${time}`}
                          type="button"
                          className={`time-pick-cell${isSelected ? ' is-selected' : ''}${takenBy ? ' is-taken' : ''}${isPastSlot(day, time) ? ' is-past' : ''}${blockReason ? ' is-blocked' : ''}`}
                          aria-pressed={isSelected}
                          aria-label={`${day}요일 ${formatTimeLabel(time)}`}
                          aria-disabled={Boolean(blockReason)}
                          title={blockReason || `${day}요일 ${formatTimeLabel(time)}`}
                          onPointerDown={(event) => startTimeDrag(event, day, time, isSelected)}
                          onPointerEnter={(event) => continueTimeDrag(event, day, time)}
                          onClick={(event) => handleTimeCellClick(event, day, time, isSelected)}
                        >
                          {isSelected ? '✓' : ''}
                        </button>
                      )
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
            <div className="field-hint time-pick-legend">
              <span><i className="time-pick-legend-swatch is-selected" aria-hidden="true" />고른 시간</span>
              {takenSlots.size > 0 && (
                <span><i className="time-pick-legend-swatch is-taken" aria-hidden="true" />다른 캐릭터 · 레이드로 신청함</span>
              )}
              <span><i className="time-pick-legend-swatch is-past" aria-hidden="true" />지난 시간</span>
              <span><i className="time-pick-legend-swatch is-unavailable" aria-hidden="true" />없는 시간</span>
            </div>
          </div>

          {/* 저장하지 않은 변경이 있으면 저장 영역을 화면 아래에 붙여, 스크롤해도 저장 버튼을 놓치지 않게 한다. */}
          <div className={`save-bar${hasUnsavedChanges ? ' is-pending' : ''}`}>
            {/* 저장 버튼은 지금 폼의 레이드 조합만 저장하므로, 저장 안 된 다른 조합이 있으면 함께 알려 준다. */}
            {hasUnsavedChanges && (
              <div className="unsaved-notice" role="status">
                <div className="unsaved-notice-text">
                  <strong>저장하지 않은 변경이 있어요</strong>
                  <span>{unsavedScheduleKeys.map(formatScheduleKey).join(' / ')}</span>
                </div>
                <div className="unsaved-notice-actions">
                  <button
                    type="button"
                    className="secondary-button small-toggle"
                    onClick={discardUnsavedChanges}
                    disabled={isSaving}
                  >
                    변경 취소
                  </button>
                  {/* 저장 버튼은 지금 폼의 조합만 저장하므로, 다른 조합도 고쳐 뒀으면 한꺼번에 저장할 수 있게 한다. */}
                  {unsavedScheduleKeys.some((key) => key !== currentScheduleKey) && (
                    <button
                      type="button"
                      className="secondary-button small-toggle"
                      onClick={handleSaveAllClick}
                      disabled={isSaving}
                    >
                      모두 저장
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="member-actions">
              <button type="button" className="primary-button" onClick={handleSaveClick} disabled={isSaving}>
                {isSaving ? '저장 중…' : isClearingSavedSchedule ? '이 신청 삭제' : '캘린더에 저장'}
              </button>
            </div>
          </div>

          <div className="selected-summary saved-schedule-list">
            <div className="saved-schedule-head">
              <h3>내 저장된 스케줄</h3>
              {mySavedSchedules.length > 0 && <span className="saved-schedule-count">{mySavedSchedules.length}건</span>}
            </div>
            {mySavedSchedules.length > 0 ? (
              <>
                <p className="saved-schedule-hint">시간을 누르면 그 시간만, 요일을 누르면 그 요일 전체를 지울 수 있어요.</p>
                <ul>
                  {mySavedSchedules.map((entry) => {
                    const entryKey = getScheduleKey(entry)
                    const isEditing = entryKey === currentScheduleKey
                    const isUnsaved = unsavedScheduleKeys.includes(entryKey)

                    return (
                      <li
                        key={entryKey}
                        className={`saved-schedule-item ${entry.raidName === '비탄의 설원' ? 'raid-snow' : 'raid-muspel'}${entry.attendance !== '참' ? ' is-absent' : ''}${isEditing ? ' is-editing' : ''}`}
                      >
                        <div className="saved-schedule-top">
                          <div className="saved-schedule-title">
                            <strong>{entry.raidName}</strong>
                            <span className={`saved-schedule-tag ${entry.difficulty === '어려움' ? 'tag-hard' : 'tag-normal'}`}>{entry.difficulty}</span>
                            <span className="saved-schedule-tag">{entry.mode}</span>
                            {entry.attendance !== '참' && <span className="saved-schedule-tag tag-absent">불참</span>}
                            {isUnsaved && <span className="saved-schedule-tag tag-unsaved">저장 안 됨</span>}
                          </div>
                          <div className="saved-schedule-actions">
                            <button
                              type="button"
                              className="saved-schedule-edit"
                              onClick={() => editSavedSchedule(entry)}
                              disabled={isEditing}
                              aria-label={`${entry.raidName} ${entry.difficulty} ${entry.mode} 스케줄 수정`}
                            >
                              {isEditing ? '수정 중' : '수정'}
                            </button>
                            <button
                              type="button"
                              className="saved-schedule-delete"
                              onClick={() => deleteWithUndo(entry)}
                              aria-label={`${entry.raidName} ${entry.difficulty} ${entry.mode} 스케줄 삭제`}
                            >
                              삭제
                            </button>
                          </div>
                        </div>
                        <div className="saved-slot-days">
                          {weekdayNames
                            .filter((day) => (entry.dayTimeSelection?.[day] ?? []).length > 0)
                            .map((day) => (
                              <div key={day} className="saved-slot-day">
                                <button
                                  type="button"
                                  className={`saved-slot-day-label${day === '토' ? ' is-sat' : ''}${day === '일' ? ' is-sun' : ''}`}
                                  onClick={() => deleteWithUndo({ entry, day, time: null })}
                                  title={`${day}요일 시간 전체 삭제`}
                                  aria-label={`${day}요일 시간 전체 삭제`}
                                >
                                  {day}
                                </button>
                                <div className="saved-slot-times">
                                  {[...entry.dayTimeSelection[day]]
                                    .sort((a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b))
                                    .map((time) => (
                                      <button
                                        key={time}
                                        type="button"
                                        className="saved-slot-chip"
                                        onClick={() => deleteWithUndo({ entry, day, time })}
                                        aria-label={`${day}요일 ${formatTimeLabel(time)} 삭제`}
                                      >
                                        <span className="saved-slot-chip-time">{formatTimeLabel(time)}</span>
                                        <span className="saved-slot-chip-x" aria-hidden="true">×</span>
                                      </button>
                                    ))}
                                </div>
                              </div>
                            ))}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <button type="button" className="secondary-button saved-schedule-clear" onClick={() => setClearAllConfirmOpen(true)}>
                  내 스케줄 전체 삭제
                </button>
              </>
            ) : (
              <p className="saved-schedule-empty">저장된 스케줄이 없어요.</p>
            )}
          </div>
        </section>

        <section className="panel calendar-panel">
          <div className="panel-header" data-section="calendar">
            <div className="panel-header-title-wrap">
              <h2>주간 레이드 슬롯</h2>
              <button
                type="button"
                className="help-toggle small"
                onClick={() => setCalendarHelpOpen((prev) => !prev)}
                aria-label="캘린더 사용 방법 보기"
                aria-expanded={calendarHelpOpen}
              >
                ?
              </button>
            </div>
            <div className="slot-legend" aria-label="리딩 여부 범례">
              <button
                type="button"
                className="secondary-button small-toggle"
                onClick={() => setShowDaytimeSlots((prev) => !prev)}
                title={showDaytimeSlots ? '주말/공휴일 낮시간을 숨깁니다.' : '주말/공휴일 낮시간을 보여줍니다.'}
              >
                낮시간 설정
              </button>
              <span className="legend-item"><span className="legend-badge lead-yes"><LeadMark value="O" /></span> 리딩 가능</span>
              <span className="legend-item"><span className="legend-badge lead-no"><LeadMark value="X" /></span> 리딩 불가</span>
            </div>
          </div>

          {/* 모든 레이드 조합에서 아직 안 지난 시간 중 모이기 좋은 시간 TOP 3. 누르면 그 탭 · 그 칸으로 간다. */}
          <div className="recommend-row" data-section="calendar">
            <span className="recommend-label">추천 레이드 시간 TOP 3</span>
            {recommendedSlots.length > 0 ? (
              <div className="recommend-list">
                {recommendedSlots.map((slot, index) => {
                  const isConfirmed = isConfirmedSlot(slot)
                  const remaining = RAID_FULL_SIZE - slot.people.length
                  const overflow = slot.people.length - RAID_FULL_SIZE

                  return (
                    <div key={`${slot.raidName}-${slot.difficulty}-${slot.mode}-${slot.day}-${slot.time}`} className="recommend-item">
                      <button
                        type="button"
                        className={`recommend-card ${slot.leaderCount === 0 ? 'no-leader' : ''}`}
                        onClick={() => focusCalendarSlot(slot)}
                        title="주간 캘린더에서 이 시간 보기"
                      >
                        <span className="recommend-rank">{index + 1}</span>
                        <span className="recommend-raid">{slot.raidName} {slot.difficulty} {slot.mode}</span>
                        <strong className="recommend-time">{slot.day}요일 {formatTimeLabel(slot.time)}</strong>
                        <span className={`recommend-status ${isConfirmed ? 'is-confirmed' : ''}`}>
                          {isConfirmed ? '성사' : remaining > 0 ? `모집 중 · ${remaining}명 더` : '리더 필요'}
                        </span>
                        <span className="recommend-meta">
                          {Math.min(slot.people.length, RAID_FULL_SIZE)}/{RAID_FULL_SIZE}명{overflow > 0 ? ` · 대기 ${overflow}` : ''} · {slot.leaderCount > 0 ? `리딩 ${slot.leaderCount}` : '리더 없음'}
                        </span>
                      </button>
                      {renderJoinButton(slot, slot.people.length, 'is-block')}
                    </div>
                  )
                })}
              </div>
            ) : (
              <span className="recommend-empty">{getEmptyText('이번 주에 아직 남은 신청이 없어요')}</span>
            )}
          </div>

          {calendarHelpOpen && (
            <div className="help-panel compact" data-section="calendar">
              <p>• 탭을 누르면 레이드 · 난이도 · 공략 방식을 바꿀 수 있어요.</p>
              <p>• 각 시간칸은 해당 조건의 인원이 저장한 시간대를 보여줘요. 먼저 신청한 10명이 정원이고, 넘는 인원은 신청 순서대로 대기로 표시돼요. A/B 파티는 리딩 가능자와 치유성을 양쪽에 나누고 전투력이 비슷하도록 자동으로 나눠요.</p>
              <p>• 추천 레이드 시간은 모든 레이드에서 아직 안 지난 시간 중 정원이 차고 리더가 있는 '성사' 시간을 먼저, 그다음 인원이 많은 순서로 보여 줘요. 누르면 그 레이드 탭과 칸으로 이동해요.</p>
              <p>• 한 타임에 한 포스, 한 파티당 5명씩 총 10명이 기준이며, O는 리딩 가능, X는 리딩 불가를 뜻해요.</p>
              <p>• 요일별 신청 현황에서는 해당 요일에 어떤 레이드와 시간대가 신청됐는지 한눈에 확인할 수 있어요.</p>
            </div>
          )}

          <div className="day-raid-summary-panel" data-section="day">
            <div className="day-raid-summary-head">
              <h3>요일별 레이드 신청 현황</h3>
              <button
                type="button"
                className={`day-raid-past-toggle ${showOnlyMine ? 'active' : ''}`}
                aria-pressed={showOnlyMine}
                onClick={toggleShowOnlyMine}
              >
                {showOnlyMine ? '✓ 내 레이드만' : '내 레이드만'}
              </button>
              {pastDayNames.length > 0 && (
                <button
                  type="button"
                  className="day-raid-past-toggle"
                  onClick={() => setExpandedPastDays(
                    areAllPastDaysExpanded ? {} : Object.fromEntries(pastDayNames.map((day) => [day, true])),
                  )}
                >
                  {areAllPastDaysExpanded ? '지난 요일 접기' : `지난 요일 펼치기 (${pastDayNames.length})`}
                </button>
              )}
            </div>
            <div className="day-raid-summary-grid">
              {visibleDayRaidSummary.map(({ day, raidGroups }, dayIndex) => {
                // weekdayNames와 weekDates는 둘 다 수요일부터 시작한다.
                const isPastCard = weekDates[dayIndex].getTime() < todayStartTime
                const isCardCollapsed = isPastCard && !expandedPastDays[day]
                const isTodayCard = weekDates[dayIndex].getTime() === todayStartTime
                const headerContent = (
                  <>
                    <span>
                      {day}요일
                      {isTodayCard && <span className="day-raid-today-chip">오늘</span>}
                    </span>
                    <span className="day-raid-date">
                      {weekDates[dayIndex].getMonth() + 1}/{weekDates[dayIndex].getDate()}
                    </span>
                  </>
                )

                return (
                <div key={day} className={`day-raid-card ${isPastCard ? 'is-past' : ''} ${isCardCollapsed ? 'is-collapsed' : ''} ${isTodayCard ? 'is-today' : ''}`}>
                  {isPastCard ? (
                    <button
                      type="button"
                      className="day-raid-header day-raid-header-toggle"
                      aria-expanded={!isCardCollapsed}
                      title={isCardCollapsed
                        ? `${day}요일 펼치기${raidGroups.length > 0 ? ` · 레이드 ${raidGroups.length}개` : ' · 신청 없음'}`
                        : `${day}요일 접기`}
                      onClick={() => setExpandedPastDays((prev) => ({ ...prev, [day]: !prev[day] }))}
                    >
                      {headerContent}
                      {isCardCollapsed && raidGroups.length > 0 && (
                        <span className="day-raid-collapsed-count">{raidGroups.length}</span>
                      )}
                      <span className="day-raid-toggle-arrow" aria-hidden="true">{isCardCollapsed ? '▸' : '◂'}</span>
                    </button>
                  ) : (
                    <div className="day-raid-header">{headerContent}</div>
                  )}
                  {isCardCollapsed ? null : raidGroups.length > 0 ? (
                    <div className="day-raid-list">
                      {raidGroups.map(({ label, raidName, difficulty, mode, times, timeMembers, members }) => {
                        const groupKey = `${day}-${label}`
                        // rallyState: 준비 호출 중일 때 'checked' | 'waiting', 아니면 undefined
                        const renderMember = (member, keyPrefix, rallyState) => (
                          <span
                            key={`${keyPrefix}-${member.nickname}-${member.className}`}
                            className={`day-raid-member has-hover-tooltip ${member.leadReady === 'O' ? 'is-leader' : ''} ${rallyState ? `rally-${rallyState}` : ''}`}
                            {...getMemberPillProps(member)}
                          >
                            {rallyState && (
                              <span className="day-raid-member-check" title={rallyState === 'checked' ? '준비 완료' : '아직 준비 안 함'}>
                                {rallyState === 'checked' ? '✓' : '·'}
                              </span>
                            )}
                            <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                            <span className={`member-name-wrap ${getNicknameClassName(member.nickname)}`}>
                              <span>{member.nickname}</span>
                              <span className="member-power-inline">{member.power}</span>
                            </span>
                            <MemberTooltip member={member} ownerNickname={altOwnerByNickname.get(member.nickname)} showLead />
                          </span>
                        )

                        return (
                        <div key={groupKey} className="day-raid-bundle">
                          <strong>{label}</strong>
                          {times.length > 0 ? (
                            // 시간대마다 한 줄: [시간 · 인원 수 · 직업 아이콘]. 누르면 인원 목록이 펼쳐진다.
                            <div className="day-raid-time-rows">
                              {times.map((time) => {
                                const rowKey = `${groupKey}-${time}`
                                const voters = timeMembers[time] ?? []
                                // 리딩 가능자를 앞쪽에 두어 접힌 상태의 아이콘에도 먼저 보이게 한다.
                                const timeVoters = members
                                  .filter((member) => voters.includes(`${member.nickname}|${member.className}`))
                                  .sort((a, b) => (b.leadReady === 'O') - (a.leadReady === 'O'))
                                const isExpanded = Boolean(expandedSummaryRows[rowKey])
                                const previewVoters = timeVoters.slice(0, SUMMARY_ICON_PREVIEW_LIMIT)
                                const hiddenCount = timeVoters.length - previewVoters.length
                                // 신청 순서로 정렬된 이 시간대 인원. 앞의 10명이 정원이고 나머지는 대기다.
                                const slotPeople = memberByRaidDateTime.get(`${day}-${time}`)?.[`${raidName} ${difficulty} ${mode}`] ?? []
                                const rosterNicknames = [...new Set(slotPeople.slice(0, RAID_FULL_SIZE).map((member) => member.nickname))]
                                const overflowCount = Math.max(0, slotPeople.length - RAID_FULL_SIZE)
                                const run = { weekStart: weekStartKey, day, time, raidName, difficulty, mode }
                                const runKey = getRaidRunKey(run)
                                const runRecord = raidRunByKey.get(runKey)
                                const isSavingRun = savingRunKey === runKey
                                // 이 시간대에 투표한 사람만 표시할 수 있다. (DB 함수도 같은 규칙으로 막는다)
                                // 부캐로 투표했으면 그 부캐로 표시한다. (같은 시간 중복 신청이 막혀 있어 내 캐릭터는 많아야 하나)
                                const mySlotNickname = timeVoters.find((member) => myCharacters.includes(member.nickname))?.nickname ?? ''
                                const isSlotVoter = Boolean(mySlotNickname)
                                const isMeWaitlisted = isSlotVoter && !rosterNicknames.includes(mySlotNickname)
                                const canEditRun = Boolean(loggedInNickname) && isSlotVoter && !isSavingRun
                                const editDisabledReason = !loggedInNickname
                                  ? '로그인한 뒤에 표시할 수 있어요.'
                                  : !isSlotVoter ? describeAuthResult('not_participant') : ''
                                // 준비: 이 시간대 정원에 든 닉네임 중 몇 명이 체크했는지
                                const slotVoterNicknames = rosterNicknames
                                const isRallyCalled = Boolean(runRecord?.rallyCalledAt)
                                const isGathered = Boolean(runRecord?.gatheredAt)
                                const rallyCheckins = runRecord?.rallyCheckins ?? []
                                const checkedCount = slotVoterNicknames.filter((name) => rallyCheckins.includes(name)).length
                                const waitingNicknames = slotVoterNicknames.filter((name) => !rallyCheckins.includes(name))
                                const isMeChecked = rallyCheckins.includes(mySlotNickname)
                                const isFullSlot = timeVoters.length >= RAID_FULL_SIZE
                                // 시작 1시간 전부터 준비 확인을 시작할 수 있다. (지난 시간은 기록용으로 그대로 둔다)
                                const canCallRally = getSlotStartDate(weekDates, day, time).getTime() - currentTime.getTime() <= RALLY_OPEN_BEFORE_MS
                                const hasLeader = timeVoters.some((member) => member.leadReady === 'O')
                                // 어제까지의 요일인데 준비 호출이 없으면 점선으로 흐리게 보여 준다. (DB에는 저장하지 않음)
                                const isPastDay = weekDates[dayIndex].getTime() < todayStartTime
                                const renderRally = () => {
                                  if (!isRallyCalled && !canCallRally) {
                                    return <span className="day-raid-rally-hint">시작 1시간 전부터 준비 확인</span>
                                  }

                                  if (!isRallyCalled) {
                                    return (
                                      <span
                                        className={`day-raid-run-status day-raid-rally ${isPastDay ? 'is-auto' : ''}`}
                                        title={editDisabledReason || (isPastDay ? '준비 확인 없이 지난 요일이에요.' : '누르면 이 시간대 인원에게 준비 확인을 보내요.')}
                                      >
                                        <button
                                          type="button"
                                          className="day-raid-rally-button"
                                          disabled={!canEditRun}
                                          onClick={() => handleRallyClick(run, 'call', slotVoterNicknames)}
                                        >
                                          📣 준비 확인
                                        </button>
                                      </span>
                                    )
                                  }

                                  return (
                                    <span
                                      className={`day-raid-run-status day-raid-rally ${isGathered ? 'is-yes' : 'is-pending'}`}
                                      title={isGathered
                                        ? `전원 준비 · 확인 시작 ${runRecord.rallyCalledBy ?? '-'}`
                                        : `확인 시작 ${runRecord.rallyCalledBy ?? '-'} · 기다리는 중: ${waitingNicknames.join(', ') || '없음'}`}
                                    >
                                      <span className="day-raid-run-label">
                                        {isGathered ? '전원 준비' : '준비'} {checkedCount}/{slotVoterNicknames.length}
                                      </span>
                                      {!isGathered && isSlotVoter && !isMeWaitlisted && (
                                        <button
                                          type="button"
                                          className={`day-raid-rally-button ${isMeChecked ? 'active' : ''}`}
                                          aria-pressed={isMeChecked}
                                          disabled={!canEditRun}
                                          onClick={() => handleRallyClick(run, isMeChecked ? 'uncheck' : 'check', slotVoterNicknames)}
                                        >
                                          {isMeChecked ? '준비 취소' : '✓ 준비 완료'}
                                        </button>
                                      )}
                                      {/* 안 오는 사람이 있어도 클리어 표시까지 막히지 않게 한다. */}
                                      {!isGathered && isSlotVoter && !isMeWaitlisted && checkedCount > 0 && waitingNicknames.length > 0 && (
                                        <button
                                          type="button"
                                          className="day-raid-rally-button"
                                          title="아직 준비하지 않은 사람을 기다리지 않고 전원 준비로 넘어가요."
                                          disabled={!canEditRun}
                                          onClick={() => handleRallyClick(run, 'start', slotVoterNicknames)}
                                        >
                                          ▶ 이 인원으로 시작
                                        </button>
                                      )}
                                      {/* 인원이 늘었을 때 디스코드로 한 번 더 알린다. (시간대마다 준비 확인 알림 최대 2번) */}
                                      {supabase && !isGathered && (runRecord.rallyNotifyCount ?? 0) < 2 && (
                                        <button
                                          type="button"
                                          className="day-raid-rally-button"
                                          title={editDisabledReason || '디스코드로 준비 확인을 한 번 더 보내요.'}
                                          disabled={!canEditRun}
                                          onClick={() => handleRallyClick(run, 'remind', slotVoterNicknames)}
                                        >
                                          📣 다시 알림
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="day-raid-run-button"
                                        aria-label={`${formatTimeLabel(time)} 준비 확인 취소`}
                                        title={editDisabledReason || '준비 확인 취소'}
                                        disabled={!canEditRun}
                                        onClick={() => handleRallyClick(run, 'cancel', slotVoterNicknames)}
                                      >
                                        ×
                                      </button>
                                    </span>
                                  )
                                }
                                const renderRunStatus = (field, fieldLabel) => {
                                  const value = runRecord?.[field] ?? null
                                  const changedBy = runRecord?.clearedBy
                                  const isLocked = !isGathered
                                  const disabledReason = editDisabledReason || (isLocked ? describeAuthResult('not_gathered') : '')

                                  return (
                                    <span
                                      className={`day-raid-run-status ${value ? `is-${value === 'O' ? 'yes' : 'no'}` : ''}`}
                                      title={disabledReason || (value && changedBy ? `${fieldLabel} ${value} · ${changedBy}` : `${fieldLabel} 여부`)}
                                    >
                                      <span className="day-raid-run-label">{fieldLabel}</span>
                                      {['O', 'X'].map((option) => (
                                        <button
                                          key={option}
                                          type="button"
                                          className={`day-raid-run-button ${value === option ? 'active' : ''}`}
                                          aria-pressed={value === option}
                                          aria-label={`${formatTimeLabel(time)} ${fieldLabel} ${option}`}
                                          disabled={!canEditRun || isLocked}
                                          onClick={() => handleRunStatusClick(run, field, option)}
                                        >
                                          <LeadMark value={option} />
                                        </button>
                                      ))}
                                    </span>
                                  )
                                }

                                return (
                                  <div key={rowKey} id={`day-raid-row-${rowKey}`} className={`day-raid-time-row ${isExpanded ? 'expanded' : ''}`}>
                                    <button
                                      type="button"
                                      className="day-raid-time-toggle"
                                      aria-expanded={isExpanded}
                                      title={isExpanded ? '접기' : `${formatTimeLabel(time)} 인원 펼치기`}
                                      onClick={() => setExpandedSummaryRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))}
                                    >
                                      <span className={`day-raid-time-tag ${isFullSlot ? 'is-full' : ''}`}>
                                        {formatTimeLabel(time)}
                                        <span className="day-raid-time-count">
                                          {Math.min(timeVoters.length, RAID_FULL_SIZE)}/{RAID_FULL_SIZE}{overflowCount > 0 ? ` +${overflowCount}` : ''}
                                        </span>
                                      </span>
                                      {!hasLeader && <span className="slot-warn">리더 없음</span>}
                                      {!isExpanded && (
                                        <span className="day-raid-icon-stack" aria-hidden="true">
                                          {previewVoters.map((member) => (
                                            <img
                                              key={`${rowKey}-${member.nickname}-${member.className}`}
                                              src={getClassIconPath(member.className)}
                                              alt=""
                                              className={`day-raid-stack-icon ${member.leadReady === 'O' ? 'is-leader' : ''}`}
                                            />
                                          ))}
                                          {hiddenCount > 0 && <span className="day-raid-stack-more">+{hiddenCount}</span>}
                                        </span>
                                      )}
                                      <span className="day-raid-toggle-arrow" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
                                    </button>
                                    {/* 버튼은 내가 신청한 시간대에만 보인다. 남의 시간대는 이미 진행된 준비 · 클리어 기록만 보여 준다.
                                        클리어는 전원 준비가 끝나야 고를 수 있어서 그 전에는 숨긴다. */}
                                    {(isSlotVoter || isRallyCalled || runRecord?.cleared || canJoinSlot(run)) && (
                                      <div className="day-raid-run-row">
                                        {(isSlotVoter || isRallyCalled) && renderRally()}
                                        {(isGathered || runRecord?.cleared) && renderRunStatus('cleared', '클리어')}
                                        {renderJoinButton(run, slotPeople.length)}
                                      </div>
                                    )}
                                    {/* 호출 중에는 아직 체크하지 않은 인원을 펼치지 않아도 보이게 한다. (모바일은 마우스 올리기가 없음) */}
                                    {isRallyCalled && !isGathered && waitingNicknames.length > 0 && (
                                      <div className="day-raid-rally-waiting">
                                        <span className="day-raid-rally-waiting-label">아직 {waitingNicknames.length}명</span>
                                        {waitingNicknames.map((name) => (
                                          <span
                                            key={`${rowKey}-waiting-${name}`}
                                            className={`day-raid-rally-waiting-name ${myCharacters.includes(name) ? 'is-me' : ''}`}
                                          >
                                            {name}
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                    {isExpanded && (
                                      <div className="day-raid-members">
                                        {timeVoters.filter((member) => rosterNicknames.includes(member.nickname)).map((member) => renderMember(
                                          member,
                                          rowKey,
                                          isRallyCalled ? (rallyCheckins.includes(member.nickname) ? 'checked' : 'waiting') : undefined,
                                        ))}
                                        {overflowCount > 0 && (
                                          <span className="day-raid-overflow-label">대기 (신청 순)</span>
                                        )}
                                        {slotPeople.slice(RAID_FULL_SIZE).map((member) => renderMember(member, `${rowKey}-overflow`))}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          ) : (
                            <>
                              <div className="day-raid-times">
                                <span className="empty-role">시간 없음</span>
                              </div>
                              <div className="day-raid-members">
                                {members.map((member) => renderMember(member, groupKey))}
                              </div>
                            </>
                          )}
                        </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="empty-role">{getEmptyText(showOnlyMine ? '내 신청 없음' : '신청 인원 없음')}</div>
                  )}
                </div>
                )
              })}
            </div>
          </div>

          <div className="raid-tab-group" data-section="calendar">
            <div className="raid-tab-bar" role="tablist" aria-label="레이드 난이도 선택">
              {visibleRaidTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`raid-tab ${activeRaidTab === tab.label ? 'active' : ''}`}
                  onClick={() => {
                    setActiveRaidTab(tab.label)
                    setActiveModeTab((prev) => (
                      prev === '반숙이상' ? prev : '트라이'
                    ))
                  }}
                  role="tab"
                  aria-selected={activeRaidTab === tab.label}
                >
                  {tab.label}
                  <TabCount count={countTabMembers(tab.raid, tab.difficulty, modeOptions)} />
                </button>
              ))}
            </div>

            <div className="subtab-bar" role="tablist" aria-label="레이드 공략 방식 선택">
              {modeOptions.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`subtab ${activeModeTab === mode ? 'active' : ''}`}
                  onClick={() => setActiveModeTab(mode)}
                  role="tab"
                  aria-selected={activeModeTab === mode}
                >
                  {mode}
                  <TabCount count={countTabMembers(activeTabMeta.raid, activeTabMeta.difficulty, [mode])} />
                </button>
              ))}
            </div>
          </div>

          {/* 모바일은 7일을 가로로 넘기는 대신 요일 하나씩 본다. */}
          <div className="mobile-day-tabs" data-section="calendar" role="tablist" aria-label="요일 선택">
            {weekDates.map((date, dayIndex) => {
              const day = weekdayNames[dayIndex]
              const tabKey = `${activeTabMeta.raid} ${activeTabMeta.difficulty} ${activeModeTab}`
              const hasPeople = timeSlots.some((time) => (memberByRaidDateTime.get(`${day}-${time}`)?.[tabKey] ?? []).length > 0)

              return (
                <button
                  key={day}
                  type="button"
                  role="tab"
                  aria-selected={mobileCalendarDayIndex === dayIndex}
                  className={`mobile-day-tab${mobileCalendarDayIndex === dayIndex ? ' active' : ''}${date.getTime() < todayStartTime ? ' is-past' : ''}${date.getTime() === todayStartTime ? ' is-today' : ''}${holidaySet.has(formatIsoDate(date)) ? ' is-holiday' : ''}`}
                  onClick={() => setMobileCalendarDayIndex(dayIndex)}
                >
                  <span>{day}</span>
                  <small>{date.getTime() === todayStartTime ? '오늘' : date.getDate()}</small>
                  {hasPeople && <span className="mobile-day-tab-dot" aria-hidden="true" />}
                </button>
              )
            })}
          </div>

          <div className="calendar-grid" data-section="calendar" data-mobile-day={mobileCalendarDayIndex}>
            <div className="calendar-corner">시간</div>
            {weekDates.map((date, dayIndex) => {
              const label = date.toLocaleDateString('ko-KR', { weekday: 'short' })
              const isToday = date.getTime() === todayStartTime
              const isHoliday = holidaySet.has(formatIsoDate(date))

              return (
                <div
                  key={date.toISOString()}
                  className={`day-header${isToday ? ' is-today' : ''}${isHoliday ? ' is-holiday' : ''}`}
                  data-day-index={dayIndex}
                >
                  <span className="day-name">{label}{isToday && <span className="day-raid-today-chip">오늘</span>}</span>
                  <strong>{date.getDate()}일</strong>
                  {isHoliday && <small className="day-holiday-label">공휴일</small>}
                </div>
              )
            })}

            {timeSlots.map((time) => {
              // 낮시간을 숨기면 그 줄을 아예 그리지 않는다. (그리면 빈 줄 사이 간격이 남는다)
              if (!showDaytimeSlots && hiddenWeekdayTimeSlots.includes(time)) {
                return null
              }

              // 모바일은 하루씩 보므로, 그 요일에 없는 시간 줄은 시간 칸까지 통째로 숨긴다. (off-day-N 클래스로 표시)
              const offDayClasses = weekDates
                .map((date, dayIndex) => (getDayTimeSlots(date).includes(time) ? '' : ` off-day-${dayIndex}`))
                .join('')

              return (
                <Fragment key={time}>
                  <div className={`time-label${offDayClasses}`}>{formatTimeLabel(time)}</div>
                  {weekDates.map((date, dayIndex) => {
                    const currentDaySlots = getDayTimeSlots(date)
                    const isVisibleTime = currentDaySlots.includes(time)
                    const dayLabel = date.toLocaleDateString('ko-KR', { weekday: 'short' })
                    const raidPeople = memberByRaidDateTime.get(`${dayLabel}-${time}`) ?? {}
                    const tabKey = `${activeTabMeta.raid} ${activeTabMeta.difficulty} ${activeModeTab}`
                    const people = raidPeople[tabKey] ?? []
                    const isMySlot = myScheduleSet.has(`${dayLabel}-${time}`)
                    const slotKey = `${dayLabel}-${time}`
                    // 이미 지난 시간은 흐리게, 추천 시간을 눌러 온 칸은 잠깐 강조한다.
                    const slotStateClass = `${isVisibleTime && isPastSlot(dayLabel, time) ? ' is-past' : ''}${highlightedSlotKey === slotKey ? ' is-highlighted' : ''}`

                    if (!isVisibleTime) {
                      return <div key={`${date.toISOString()}-${time}-empty`} className="slot-cell empty muted-slot" data-day-index={dayIndex} />
                    }

                    // 신청이 없는 칸은 흐린 '-'만 남겨 신청이 있는 칸이 눈에 띄게 한다.
                    if (people.length === 0) {
                      return (
                        <div
                          key={`${date.toISOString()}-${time}`}
                          id={`calendar-slot-${slotKey}`}
                          data-day-index={dayIndex}
                          className={`slot-cell empty is-vacant ${isMySlot ? 'my-schedule-slot' : ''}${slotStateClass}`}
                        >
                          {isMySlot && <span className="my-slot-badge">내 시간</span>}
                          <span className="empty-text">-</span>
                        </div>
                      )
                    }

                    // 인원이 많을수록 진하게 칠하고, 정원이 찼는지 · 리딩 가능자가 있는지 칸 위쪽에 표시한다.
                    const fillLevel = people.length >= RAID_FULL_SIZE ? 3 : people.length >= RAID_FULL_SIZE / 2 ? 2 : 1
                    const hasLeader = people.some((member) => member.leadReady === 'O')
                    const { partyA, partyB, waiting } = buildBalancedParties(people)

                    return (
                      <div
                        key={`${date.toISOString()}-${time}`}
                        id={`calendar-slot-${slotKey}`}
                        data-day-index={dayIndex}
                        className={`slot-cell occupied fill-${fillLevel} ${isMySlot ? 'my-schedule-slot' : ''}${slotStateClass}`}
                      >
                        <div className="slot-cell-head">
                          {isMySlot && <span className="my-slot-badge">내 시간</span>}
                          <span className={`slot-count ${fillLevel === 3 ? 'is-full' : ''}`}>
                            {people.length}/{RAID_FULL_SIZE}
                          </span>
                          {!hasLeader && <span className="slot-warn">리더 없음</span>}
                          {renderJoinButton(
                            { raidName: activeTabMeta.raid, difficulty: activeTabMeta.difficulty, mode: activeModeTab, day: dayLabel, time },
                            people.length,
                          )}
                        </div>

                        <div className="raid-group-list">
                          <div className="raid-group-item selected-raid-item">
                            <div className="party-split">
                              {[['A', partyA], ['B', partyB]].map(([partyName, partyMembers]) => (
                                <div key={partyName} className="party-column">
                                  <span className="party-label">{partyName}</span>
                                  {partyMembers.length > 0 ? (
                                    <div className="time-member-list vertical">
                                      {partyMembers.map((member) => (
                                        <span key={`${slotKey}-${tabKey}-${partyName}-${member.nickname}`} className="time-member-pill has-hover-tooltip" {...getMemberPillProps(member)}>
                                          <span className="nickname-with-icon">
                                            <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                                            <span className={`member-name-wrap ${getNicknameClassName(member.nickname)}`}>
                                              <span>{member.nickname}</span>
                                              <span className="member-power-inline">{member.power}</span>
                                            </span>
                                            {member.leadReady === 'O' && <span className="lead-badge" role="img" aria-label="리딩 가능"><LeadMark value="O" /></span>}
                                          </span>
                                          <MemberTooltip member={member} ownerNickname={altOwnerByNickname.get(member.nickname)} />
                                        </span>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="empty-raid-text">-</span>
                                  )}
                                </div>
                              ))}
                            </div>
                            {waiting.length > 0 && (
                              <div className="party-waiting" title={waiting.map((member) => member.nickname).join(', ')}>
                                대기 {waiting.length}명: {waiting.map((member) => member.nickname).join(', ')}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </Fragment>
              )
            })}
          </div>

          <div className="member-day-summary" data-section="members">
            <h3>보스 난이도별 선택인원</h3>
            <div className="weekday-list">
              {memberByRaidDifficulty.length ? (
                memberByRaidDifficulty.map(({ raidName, difficulty, mode, members }) => (
                  <div key={`${raidName}-${difficulty}-${mode}`} className="weekday-card">
                    <span className="weekday-title">{raidName} · {difficulty} · {mode}</span>
                    <div className="member-tags">
                      {members.map((member) => (
                        <span key={`${raidName}-${difficulty}-${mode}-${member.nickname}`} className="member-tag has-hover-tooltip" {...getMemberPillProps(member)}>
                          <span className="nickname-with-icon small">
                            <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                            <span className={`member-name-wrap ${getNicknameClassName(member.nickname)}`}>
                              <span>{member.nickname}</span>
                              <span className="member-power-inline">{member.power}</span>
                            </span>
                            {member.leadReady === 'O' && <span className="lead-badge" role="img" aria-label="리딩 가능"><LeadMark value="O" /></span>}
                          </span>
                          <MemberTooltip member={member} ownerNickname={altOwnerByNickname.get(member.nickname)} />
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <span className="empty-role">{getEmptyText('선택 인원 없음')}</span>
              )}
            </div>
          </div>

        </section>
      </main>
    </div>
  )
}

export default App

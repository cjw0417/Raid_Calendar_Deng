import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import {
  HINT_QUESTIONS,
  PASSWORD_RULE,
  deleteAllMemberSchedules,
  deleteMemberSchedule,
  describeAuthResult,
  memberGetHintQuestion,
  memberLogin,
  memberResetPassword,
  memberSetPassword,
  memberSetupPassword,
  normalizeHintAnswer,
  saveMemberSchedule,
  setRaidRunStatus,
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
const LOGIN_STORAGE_KEY = 'raid-calendar-login-v1'
const RAID_RUNS_STORAGE_KEY = 'raid-calendar-raid-runs-v1'

// 모바일에서 햄버거 메뉴로 한 번에 하나씩 보여주는 영역 (data-section 값과 맞춘다)
const MOBILE_SECTIONS = [
  { id: 'form', label: '내 시간 등록' },
  { id: 'day', label: '요일별 신청 현황' },
  { id: 'calendar', label: '주간 레이드 슬롯' },
  { id: 'members', label: '난이도별 선택인원' },
]
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

const sampleSlotData = []

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
      ? [...new Set(times.filter((time) => typeof time === 'string' && timeSlots.includes(time)))]
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

// 요일별 시간 선택을 "목 19:00 / 금 20:00, 21:00" 형태로 표시한다.
function formatDayTimeSelection(dayTimeSelection) {
  return weekdayNames
    .filter((day) => (dayTimeSelection?.[day] ?? []).length > 0)
    .map((day) => `${day} ${[...dayTimeSelection[day]].sort((a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b)).join(', ')}`)
    .join(' / ')
}

// 요일별 시간 선택을 [요일, 시간] 쌍 목록으로 펼친다.
function getDayTimePairs(dayTimeSelection) {
  return Object.entries(dayTimeSelection ?? {}).flatMap(([day, times]) =>
    Array.isArray(times) ? times.map((time) => [day, time]) : [],
  )
}

function buildDefaultMember(overrides = {}) {
  const initialSelection = buildEmptyDayTimeSelection()

  return {
    id: `member-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nickname: '나의닉네임',
    days: [],
    times: [],
    dayTimeSelection: initialSelection,
    // 로그인 직후 폼에는 아무것도 선택되지 않은 상태로 시작한다.
    attendance: '',
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

// 시간대별 출발 / 클리어 기록 (raid_runs)
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
    departed: entry.departed ?? null,
    cleared: entry.cleared ?? null,
    departedBy: entry.departed_by ?? entry.departedBy ?? null,
    clearedBy: entry.cleared_by ?? entry.clearedBy ?? null,
    // 디스코드 알림을 이미 보냈는지 (시간대마다 한 번만 보낸다)
    departedNotified: Boolean(entry.departed_notified_at ?? entry.departedNotified),
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

function buildEmptyPasswordForm() {
  return { current: '', next: '', confirm: '', hintQuestion: '', hintAnswer: '', error: '', message: '' }
}

// 리딩 O/X 표시. 글꼴·화면 배율에 따라 글자가 틀어지지 않도록 SVG로 그린다.
function LeadMark({ value }) {
  return (
    <svg className="lead-mark" viewBox="0 0 10 10" aria-hidden="true">
      {value === 'O' ? <circle cx="5" cy="5" r="3.1" /> : <path d="M2.5 2.5 7.5 7.5 M7.5 2.5 2.5 7.5" />}
    </svg>
  )
}

function App() {
  const [currentTime, setCurrentTime] = useState(new Date())
  // 페이지를 켜 둔 채 수요일 00시가 지나면 새 주로 넘어가도록 현재 시각에서 주 시작을 다시 계산한다.
  const weekStartTime = getWeekStart(currentTime).getTime()
  const weekDates = useMemo(() => getWeekDates(weekStartTime), [weekStartTime])
  const [nextReset, setNextReset] = useState(() => getNextResetDate())
  const [holidaySet, setHolidaySet] = useState(() => buildFallbackHolidaySet(new Date().getFullYear()))
  const [activeRaidTab, setActiveRaidTab] = useState('무스펠 보통')
  const [activeModeTab, setActiveModeTab] = useState('트라이')
  const [helpOpen, setHelpOpen] = useState(false)
  const [calendarHelpOpen, setCalendarHelpOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState(MOBILE_SECTIONS[0].id)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // 요일별 신청 현황에서 펼쳐 둔 시간 줄 ("요일-레이드조합-시간" → true)
  const [expandedSummaryRows, setExpandedSummaryRows] = useState({})
  const [loggedInNickname, setLoggedInNickname] = useState('')
  const [loginNickname, setLoginNickname] = useState(() => readStoredLoginNickname())
  const [rememberMe, setRememberMe] = useState(() => Boolean(readStoredLoginNickname()))
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [isLoginPending, setIsLoginPending] = useState(false)
  // 로그인한 사람의 비밀번호. 저장·삭제할 때 DB가 다시 확인하므로 메모리에만 들고 있는다.
  const [sessionPassword, setSessionPassword] = useState('')
  // 초기 비밀번호로 들어온 경우의 개인 비밀번호 설정 단계: { nickname, currentPassword }
  const [passwordSetup, setPasswordSetup] = useState(null)
  // 비밀번호 찾기 단계: { nickname, question } (question이 null이면 닉네임 입력 단계)
  const [passwordReset, setPasswordReset] = useState(null)
  // 개인 비밀번호 설정 · 변경 · 찾기 폼 (세 화면이 같이 쓴다)
  const [passwordForm, setPasswordForm] = useState(() => buildEmptyPasswordForm())
  const [passwordChangeOpen, setPasswordChangeOpen] = useState(false)
  const [selectedDayForTimes, setSelectedDayForTimes] = useState('')
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
  // 현재 집계: 이번 주에 저장하고 참여로 표시한 인원
  const participantCount = useMemo(
    () => storedMembers.filter((member) => member.attendance === '참' && isSavedThisWeek(member, weekStartTime)).length,
    [storedMembers, weekStartTime],
  )
  const [showDaytimeSlots, setShowDaytimeSlots] = useState(false)
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false)
  // 삭제 확인 팝업 대상: 'all'(전체 삭제) 또는 삭제할 스케줄 한 건
  const [pendingDelete, setPendingDelete] = useState(null)
  // 저장 전 수정 중인 요일/시간 선택 (레이드 · 난이도 · 공략 방식 조합별)
  const [dayTimeDrafts, setDayTimeDrafts] = useState({})
  // 이번 주(수요일 시작) 시간대별 출발 / 클리어 기록
  const weekStartKey = useMemo(() => formatDateKey(weekDates[0]), [weekDates])
  const [raidRuns, setRaidRuns] = useState(() => (supabase ? [] : loadLocalRaidRuns()))
  // O로 바꾸기 전 확인 팝업 대상: { run, field }
  const [pendingRunStatus, setPendingRunStatus] = useState(null)
  // 저장 중인 기록 키 (중복 클릭 방지)
  const [savingRunKey, setSavingRunKey] = useState('')

  useEffect(() => {
    let isMounted = true

    const year = new Date().getFullYear()

    getHolidaySetForYear(year)
      .then((nextHolidaySet) => {
        if (isMounted) {
          setHolidaySet(nextHolidaySet)
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

  useEffect(() => {
    if (!supabase) {
      saveLocalMembers(storedMembers)
      saveLocalRaidSchedules(storedRaidSchedules)
      return
    }

    const loadRemoteMembers = async () => {
      const { data, error } = await supabase.from('members').select('*').order('updated_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        const normalized = data
          .map((member) => normalizeMemberRecord(member))
          .filter(Boolean)

        setMembers(normalized)
      }
    }

    const loadRemoteRaidSchedules = async () => {
      const { data, error } = await supabase.from('raid_schedules').select('*').order('updated_at', { ascending: false })

      if (!error && Array.isArray(data)) {
        const normalized = data
          .map((entry) => normalizeRaidScheduleEntry(entry))
          .filter(Boolean)

        setRaidSchedules(normalized)
      }
    }

    loadRemoteMembers()
    loadRemoteRaidSchedules()

    const memberChannel = supabase
      .channel('members-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'members' },
        (payload) => {
          const nextMember = normalizeMemberRecord(payload.new ?? payload.old)

          if (!nextMember) {
            setMembers((prev) => prev.filter((member) => member.nickname !== (payload.old?.nickname ?? '')))
            return
          }

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
          const nextEntry = normalizeRaidScheduleEntry(payload.new ?? payload.old)

          if (!nextEntry) {
            setRaidSchedules((prev) => prev.filter((entry) => !(entry.nickname === (payload.old?.nickname ?? '') && entry.raidName === (payload.old?.raid_name ?? '') && entry.difficulty === (payload.old?.difficulty ?? '') && entry.mode === (payload.old?.mode ?? ''))))
            return
          }

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
  }, [])

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

  // 이번 주 출발 / 클리어 기록을 불러오고, 다른 사람이 바꾸면 바로 반영한다.
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
      isMounted = false
      supabase.removeChannel(raidRunChannel)
    }
  }, [weekStartKey])

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
      setNextReset(getNextResetDate())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

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

  const countdown = useMemo(() => {
    const diff = nextReset.getTime() - currentTime.getTime()
    const totalSeconds = Math.max(0, Math.floor(diff / 1000))
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return { days, hours, minutes, seconds }
  }, [currentTime, nextReset])

  const getSelectableTimesForSelectedDay = (day) => {
    if (!day || !weekdayNames.includes(day)) {
      return weekdayTimeSlots
    }

    if (day === '토' || day === '일') {
      return showDaytimeSlots ? timeSlots : timeSlots.filter((time) => !hiddenWeekdayTimeSlots.includes(time))
    }

    return weekdayTimeSlots
  }

  const visibleTimeSlots = getSelectableTimesForSelectedDay(selectedDayForTimes)

  // 폼에서 고른 레이드 · 난이도 · 공략 방식. 요일/시간 선택은 이 조합마다 따로 관리한다.
  const currentNickname = (loggedInNickname || profile.nickname).trim()
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

  const toggleTimeSelection = (time) => {
    const targetDay = selectedDayForTimes

    if (!currentScheduleKey || !targetDay || !getSelectableTimesForSelectedDay(targetDay).includes(time)) {
      return
    }

    const nextSelection = normalizeDayTimeSelection(currentDayTimeSelection)
    const currentTimes = nextSelection[targetDay] ?? []
    nextSelection[targetDay] = currentTimes.includes(time)
      ? currentTimes.filter((item) => item !== time)
      : [...currentTimes, time]

    setDayTimeDrafts((prev) => ({ ...prev, [currentScheduleKey]: nextSelection }))
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

  const getDayTimeSlots = (date) => {
    const day = date.getDay()
    const isoKey = formatIsoDate(date)
    const isHoliday = holidaySet.has(isoKey)
    const isWeekendOrHoliday = day === 0 || day === 6 || isHoliday

    if (!isWeekendOrHoliday) {
      return weekdayTimeSlots
    }

    if (!showDaytimeSlots) {
      return weekendTimeSlots.filter((time) => !hiddenWeekdayTimeSlots.includes(time))
    }

    return weekendTimeSlots
  }

  const isWeekendOrHoliday = (date) => {
    const day = date.getDay()
    const isoKey = formatIsoDate(date)
    return day === 0 || day === 6 || holidaySet.has(isoKey)
  }

  const isSharedMode = Boolean(supabase)

  const memberByDay = useMemo(() => {
    const map = Object.fromEntries(weekdayNames.map((day) => [day, []]))

    allScheduleEntries.forEach((entry) => {
      if (!hasActiveScheduleSelection(entry)) return

      entry.days.forEach((day) => {
        if (!map[day]) return

        const exists = map[day].some(
          (member) => member.nickname === entry.nickname && member.className === entry.className,
        )

        if (!exists) {
          map[day].push({
            nickname: entry.nickname,
            className: entry.className,
            power: entry.power,
            leadReady: entry.leadReady,
          })
        }
      })
    })

    return map
  }, [allScheduleEntries])

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
          })
        }

        target[tabKey] = existing
        map.set(key, target)
      })
    })

    return map
  }, [members, raidSchedules])

  // 내가 저장한 스케줄 목록 (레이드 → 난이도 → 공략 방식 순).
  const mySavedSchedules = useMemo(() => {
    const trimmedNickname = (loggedInNickname || profile.nickname).trim()
    const raidOrder = { 무스펠: 0, '비탄의 설원': 1 }
    const difficultyOrder = { 보통: 0, 어려움: 1 }

    return raidSchedules
      .filter((entry) => entry.nickname === trimmedNickname && entry.days.length > 0)
      .sort((a, b) =>
        (raidOrder[a.raidName] ?? 99) - (raidOrder[b.raidName] ?? 99)
        || (difficultyOrder[a.difficulty] ?? 99) - (difficultyOrder[b.difficulty] ?? 99)
        || (a.mode ?? '').localeCompare(b.mode ?? ''),
      )
  }, [loggedInNickname, profile.nickname, raidSchedules])

  const activeRaidScheduleEntries = useMemo(() => {
    const tabKey = `${activeTabMeta.raid} ${activeTabMeta.difficulty} ${activeModeTab}`

    return weekdayNames.flatMap((day) =>
      timeSlots.map((time) => {
        const people = memberByRaidDateTime.get(`${day}-${time}`)?.[tabKey] ?? []
        return people.length > 0 ? { day, time, people } : null
      }).filter(Boolean),
    )
  }, [activeModeTab, activeTabMeta, memberByRaidDateTime])

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

    if (rememberMe) {
      writeStoredLoginNickname(nickname)
    } else {
      writeStoredLoginNickname('')
    }

    setProfile(buildDefaultMember({ nickname }))
    setSelectedDayForTimes('')
    await loadCurrentProfileByNickname(nickname)
  }

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
    setLoggedInNickname('')
    setLoginNickname('')
    setLoginPassword('')
    setSessionPassword('')
    setPasswordSetup(null)
    setPasswordReset(null)
    setPasswordChangeOpen(false)
    resetPasswordForm()
    setRememberMe(false)
    writeStoredLoginNickname('')
    setProfile(buildDefaultMember({ nickname: '' }))
    setSelectedDayForTimes('')
    setDayTimeDrafts({})
    setMobileMenuOpen(false)
  }

  const selectMobileSection = (sectionId) => {
    setMobileSection(sectionId)
    setMobileMenuOpen(false)
    window.scrollTo({ top: 0 })
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
      attendance: member.attendance,
      className: member.className,
      power: member.power,
      leadReady: member.leadReady,
    }))
  }

  const saveCurrentProfile = async () => {
    const trimmedNickname = (loggedInNickname || profile.nickname).trim()

    if (!trimmedNickname) {
      return
    }

    setLoggedInNickname(trimmedNickname)
    writeStoredLoginNickname(trimmedNickname)

    const savedScheduleKey = currentScheduleKey
    const savedSelection = normalizeDayTimeSelection(currentDayTimeSelection)

    const nextMember = {
      ...profile,
      nickname: trimmedNickname,
      className: profile.className,
      raidFocus: profile.raidFocus,
      leadReady: normalizeLeadReady(profile.leadReady),
      days: getSelectedDayList(savedSelection),
      times: getCombinedTimes(savedSelection),
      dayTimeSelection: savedSelection,
    }

    // 저장이 끝나면 이 레이드의 수정 중 선택을 비운다 (이후엔 저장된 선택이 보인다).
    const clearSavedDraft = () => {
      setDayTimeDrafts((prev) => {
        const nextDrafts = { ...prev }
        delete nextDrafts[savedScheduleKey]
        return nextDrafts
      })
    }

    const scheduleEntry = {
      nickname: trimmedNickname,
      raid_name: currentScheduleTarget.raidName,
      difficulty: currentScheduleTarget.difficulty,
      mode: currentScheduleTarget.mode,
      days: nextMember.days,
      times: nextMember.times,
      day_time_selection: normalizeDayTimeSelection(nextMember.dayTimeSelection),
      attendance: nextMember.attendance,
      class_name: nextMember.className,
      power: nextMember.power,
      lead_ready: nextMember.leadReady,
    }

    if (supabase) {
      let result

      try {
        result = await saveMemberSchedule(
          trimmedNickname,
          sessionPassword,
          {
            attendance: nextMember.attendance,
            class_name: nextMember.className,
            power: nextMember.power,
            lead_ready: nextMember.leadReady,
          },
          scheduleEntry,
        )
      } catch (error) {
        window.alert(`스케줄 저장에 실패했어요. (${error.message})`)
        return
      }

      if (result?.error) {
        window.alert(`스케줄 저장에 실패했어요. ${describeAuthResult(result.error)}`)
        return
      }

      const savedMember = normalizeMemberRecord(result.member)
      const savedEntry = normalizeRaidScheduleEntry(result.schedule)

      setMembers((prevMembers) => {
        const index = prevMembers.findIndex((member) => member.nickname === trimmedNickname)

        if (index >= 0) {
          const nextMembers = [...prevMembers]
          nextMembers[index] = savedMember
          return nextMembers
        }

        return [...prevMembers, savedMember]
      })

      setRaidSchedules((prevSchedules) => {
        const index = prevSchedules.findIndex((entry) => entry.nickname === trimmedNickname && getScheduleKey(entry) === getScheduleKey(savedEntry))

        if (index >= 0) {
          const nextSchedules = [...prevSchedules]
          nextSchedules[index] = savedEntry
          return nextSchedules
        }

        return [...prevSchedules, savedEntry]
      })
      clearSavedDraft()
      return
    }

    const nextLocalMember = {
      ...nextMember,
      id: `member-${Date.now()}`,
      days: nextMember.days,
      times: nextMember.times,
      raidFocus: getRaidLabel(nextMember.raidFocus),
      difficulty: nextMember.difficulty ?? getDifficultyForRaid(getRaidLabel(nextMember.raidFocus)),
      mode: nextMember.mode ?? '트라이',
    }
    setMembers((prevMembers) => {
      const targetIndex = prevMembers.findIndex((member) => member.nickname === trimmedNickname)

      if (targetIndex >= 0) {
        const nextMembers = [...prevMembers]
        nextMembers[targetIndex] = { ...nextMembers[targetIndex], ...nextLocalMember, nickname: trimmedNickname }
        return nextMembers
      }

      return [...prevMembers, { ...nextLocalMember, nickname: trimmedNickname }]
    })

    const localEntry = normalizeRaidScheduleEntry({
      ...scheduleEntry,
      className: scheduleEntry.class_name,
      leadReady: scheduleEntry.lead_ready,
      raidName: scheduleEntry.raid_name,
      updatedAt: new Date().toISOString(),
    })

    setRaidSchedules((prevSchedules) => {
      const nextSchedules = [...prevSchedules]
      const index = nextSchedules.findIndex((entry) => entry.nickname === trimmedNickname && entry.raidName === localEntry.raidName && entry.difficulty === localEntry.difficulty && entry.mode === localEntry.mode)

      if (index >= 0) {
        nextSchedules[index] = localEntry
        return nextSchedules
      }

      return [...nextSchedules, localEntry]
    })
    clearSavedDraft()
  }

  // 저장 전에 선택하지 않은 항목이 있으면 알려준다.
  const openSaveConfirm = () => {
    const missingFields = [
      [selectedRaidLabel, '주요 레이드'],
      [profile.difficulty, '난이도'],
      [profile.mode, '공략 방식'],
      [profile.leadReady, '리딩 여부'],
      [currentSelectedDays.length > 0, '요일 · 시간대'],
      [profile.attendance, '참여 가능 여부'],
      [profile.className, '본인 직업'],
      [profile.power, '전투력'],
    ]
      .filter(([value]) => !value)
      .map(([, label]) => label)

    if (missingFields.length > 0) {
      window.alert(`다음 항목을 선택해 주세요.\n\n${missingFields.join(', ')}`)
      return
    }

    setSaveConfirmOpen(true)
  }

  const confirmSaveCurrentProfile = async () => {
    setSaveConfirmOpen(false)
    await saveCurrentProfile()
  }

  const clearCurrentSchedule = async () => {
    const trimmedNickname = (loggedInNickname || profile.nickname).trim()

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
  }

  // 레이드 · 난이도 · 공략 방식이 같은 스케줄 한 건만 삭제한다.
  const deleteSchedule = async (target) => {
    const trimmedNickname = (loggedInNickname || profile.nickname).trim()

    if (!trimmedNickname) {
      return
    }

    const targetKey = getScheduleKey(target)
    const isTargetSchedule = (entry) => entry.nickname === trimmedNickname && getScheduleKey(entry) === targetKey

    // members 쪽에 남은 같은 스케줄도 비워야 캘린더에서 사라진다.
    const isTargetMember = (member) =>
      member.nickname === trimmedNickname
      && getRaidLabel(member.raidFocus) === target.raidName
      && (member.difficulty ?? getDifficultyForRaid(target.raidName)) === target.difficulty
      && (member.mode ?? '트라이') === target.mode

    const clearedSelection = { days: [], times: [], dayTimeSelection: buildEmptyDayTimeSelection() }

    if (supabase && !(await runRemoteDelete(() => deleteMemberSchedule(trimmedNickname, sessionPassword, target)))) {
      return
    }

    setRaidSchedules((prevSchedules) => prevSchedules.filter((entry) => !isTargetSchedule(entry)))
    setMembers((prevMembers) => prevMembers.map((member) => (isTargetMember(member) ? { ...member, ...clearedSelection } : member)))
    setDayTimeDrafts((prev) => {
      const nextDrafts = { ...prev }
      delete nextDrafts[targetKey]
      return nextDrafts
    })
  }

  // DB 삭제 요청. 성공하면 true, 실패하면 알림을 띄우고 false.
  const runRemoteDelete = async (request) => {
    try {
      const result = await request()

      if (result?.error) {
        window.alert(`삭제에 실패했어요. ${describeAuthResult(result.error)}`)
        return false
      }

      return true
    } catch (error) {
      window.alert(`삭제에 실패했어요. (${error.message})`)
      return false
    }
  }

  // 출발 / 클리어 표시를 저장한다. value: 'O' | 'X' | null(표시 지우기)
  // Supabase 모드에서는 DB 함수가 로그인·규칙을 확인하고, O로 바뀌면 디스코드 알림도 보낸다.
  const applyRaidRunStatus = async (run, field, value) => {
    const nickname = loggedInNickname.trim()

    if (!nickname) {
      window.alert('로그인한 뒤에 출발 · 클리어 여부를 표시할 수 있어요.')
      return
    }

    const runKey = getRaidRunKey(run)

    if (supabase) {
      setSavingRunKey(runKey)

      let result

      try {
        result = await setRaidRunStatus(nickname, sessionPassword, run, field, value)
      } catch (error) {
        window.alert(`표시를 저장하지 못했어요. (${error.message})`)
        return
      } finally {
        setSavingRunKey('')
      }

      if (result?.error) {
        window.alert(`표시를 저장하지 못했어요. ${describeAuthResult(result.error)}`)
        return
      }

      setRaidRuns((prev) => upsertRaidRun(prev, normalizeRaidRun(result.run)))
      return
    }

    // 로컬 모드: DB 함수와 같은 규칙으로 이 브라우저에만 저장한다. (디스코드 알림 없음)
    const current = raidRunByKey.get(runKey) ?? { ...run, departed: null, cleared: null, departedBy: null, clearedBy: null }

    if (field === 'cleared' && current.departed !== 'O') {
      window.alert(describeAuthResult('not_departed'))
      return
    }

    const nextRun = field === 'departed'
      ? {
          ...current,
          departed: value,
          departedBy: value ? nickname : null,
          ...(value === 'O' ? {} : { cleared: null, clearedBy: null }),
        }
      : { ...current, cleared: value, clearedBy: value ? nickname : null }

    setRaidRuns((prev) => upsertRaidRun(prev, nextRun))
  }

  // 같은 값을 다시 누르면 표시를 지운다. O로 바꿀 때는 알림이 가므로 한 번 확인한다.
  const handleRunStatusClick = (run, field, value) => {
    const runRecord = raidRunByKey.get(getRaidRunKey(run))
    const currentValue = runRecord?.[field] ?? null
    const nextValue = currentValue === value ? null : value

    if (nextValue === 'O') {
      const alreadyNotified = Boolean(field === 'departed' ? runRecord?.departedNotified : runRecord?.clearedNotified)
      setPendingRunStatus({ run, field, alreadyNotified })
      return
    }

    applyRaidRunStatus(run, field, nextValue)
  }

  const confirmPendingRunStatus = () => {
    const target = pendingRunStatus
    setPendingRunStatus(null)
    applyRaidRunStatus(target.run, target.field, 'O')
  }

  const confirmPendingDelete = async () => {
    const target = pendingDelete
    setPendingDelete(null)

    if (target === 'all') {
      await clearCurrentSchedule()
      return
    }

    if (target) {
      await deleteSchedule(target)
    }
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

          <label className="remember-row" htmlFor="rememberMe">
            <input
              id="rememberMe"
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <span>기억하기</span>
          </label>

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
            <strong>{currentTime.toLocaleString('ko-KR')}</strong>
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
              <strong>{currentTime.toLocaleString('ko-KR')}</strong>
            </div>
            {!isSharedMode && (
              <div className="shared-mode-warning">
                공유 저장소가 비활성화됨 · 다른 IP에서 보이지 않음
              </div>
            )}
            <ul className="mobile-nav-list">
              {MOBILE_SECTIONS.map((section) => (
                <li key={section.id}>
                  <button
                    type="button"
                    className={`mobile-nav-item ${mobileSection === section.id ? 'active' : ''}`}
                    onClick={() => selectMobileSection(section.id)}
                    aria-current={mobileSection === section.id ? 'page' : undefined}
                  >
                    {section.label}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mobile-nav-actions">
              <button type="button" className="secondary-button" onClick={openPasswordChangeFromMenu}>
                비밀번호 변경
              </button>
              <button type="button" className="secondary-button" onClick={handleLogout}>
                로그아웃
              </button>
            </div>
          </nav>
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

      {saveConfirmOpen && (
        <div className="save-confirm-backdrop" onClick={() => setSaveConfirmOpen(false)}>
          <div className="save-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>캘린더에 저장할까요?</h3>
            <p>
              <span className="save-confirm-nickname">{(loggedInNickname || profile.nickname).trim() || '현재 프로필'}</span>
              의 레이드 시간 정보를 저장하시겠습니까
            </p>
            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setSaveConfirmOpen(false)}>
                취소
              </button>
              <button type="button" className="primary-button" onClick={confirmSaveCurrentProfile}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRunStatus && (
        <div className="save-confirm-backdrop" onClick={() => setPendingRunStatus(null)}>
          <div className="save-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{pendingRunStatus.field === 'departed' ? '출발로 표시할까요?' : '클리어로 표시할까요?'}</h3>
            <p>
              <span className="save-confirm-nickname">
                {pendingRunStatus.run.raidName} · {pendingRunStatus.run.difficulty} · {pendingRunStatus.run.mode}
              </span>
              {` ${pendingRunStatus.run.day}요일 ${pendingRunStatus.run.time} 레이드를 ${pendingRunStatus.field === 'departed' ? '출발' : '클리어'}(O)로 표시합니다.`}
              {supabase && (pendingRunStatus.alreadyNotified
                ? ' 이 시간대는 이미 디스코드로 알렸기 때문에 다시 알리지 않아요.'
                : ' 디스코드 알림이 연결되어 있으면 채널에 알림이 가요.')}
            </p>
            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingRunStatus(null)}>
                취소
              </button>
              <button type="button" className="primary-button" onClick={confirmPendingRunStatus}>
                표시
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <div className="save-confirm-backdrop" onClick={() => setPendingDelete(null)}>
          <div className="save-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>{pendingDelete === 'all' ? '내 스케줄을 전부 삭제할까요?' : '이 스케줄을 삭제할까요?'}</h3>
            <p>
              <span className="save-confirm-nickname">{(loggedInNickname || profile.nickname).trim() || '현재 프로필'}</span>
              {pendingDelete === 'all'
                ? '의 모든 레이드 시간 정보를 삭제하시겠습니까'
                : `의 ${pendingDelete.raidName} · ${pendingDelete.difficulty} · ${pendingDelete.mode} 레이드 시간 정보를 삭제하시겠습니까`}
            </p>
            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingDelete(null)}>
                취소
              </button>
              <button type="button" className="primary-button" onClick={confirmPendingDelete}>
                삭제
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="summary-grid" data-section="form">
        <article className="summary-card accent">
          <span className="label">다음 리셋</span>
          <strong>{nextReset.toLocaleString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
          <small>
            {countdown.days}일 {countdown.hours}시간 {countdown.minutes}분 {countdown.seconds}초 후
          </small>
        </article>

        <article className="summary-card">
          <span className="label">현재 집계</span>
          <strong>{participantCount}명 참여</strong>
          <small>{getDayTimePairs(currentDayTimeSelection).length}개 타임 선택 · {currentSelectedDays.length}개 요일</small>
        </article>

        <article className="summary-card">
          <span className="label">파티 조건</span>
          <strong>2파티 / 10명</strong>
          <small>각 파티 5명 기준</small>
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
              <p>1. 레이드와 난이도/공략 방식을 먼저 선택해요. 요일·시간은 레이드마다 따로 저장돼요.</p>
              <p>2. 닉네임과 리딩 여부를 입력해요.</p>
              <p>3. 가능한 요일과 시간대를 선택해요.</p>
              <p>4. 저장하면 주간 캘린더에서 해당 시간대에 자동으로 집계돼요.</p>
              <p>5. 레이드 탭과 난이도/공략 방식을 선택하면 파티 인원을 확인할 수 있어요.</p>
            </div>
          )}

          <div className="field-group">
            <label>주요 레이드</label>
            <div className="chip-grid raid-option-grid">
              {raidOptions.map((raid) => (
                <button
                  key={raid.id}
                  type="button"
                  className={selectedRaidLabel === raid.label ? 'chip active' : 'chip'}
                  onClick={() => setProfile((prev) => ({ ...prev, raidFocus: raid.id }))}
                >
                  <span>{raid.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="two-column">
            <div className="field-group">
              <label htmlFor="difficulty">난이도</label>
              <select
                id="difficulty"
                value={profile.difficulty}
                onChange={(event) => setProfile((prev) => ({ ...prev, difficulty: event.target.value }))}
              >
                <option value="" disabled>선택</option>
                {difficultyOptions.map((difficulty) => (
                  <option key={difficulty} value={difficulty}>
                    {difficulty}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="mode">공략 방식</label>
              <select
                id="mode"
                value={profile.mode}
                onChange={(event) => setProfile((prev) => ({ ...prev, mode: event.target.value }))}
              >
                <option value="" disabled>선택</option>
                {modeOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-group">
            <div className="field-label-row">
              <label htmlFor="nickname">닉네임</label>
              <span className="lead-label-inline">리딩 여부</span>
            </div>
            <div className="nickname-row">
              <input
                id="nickname"
                type="text"
                value={profile.nickname}
                readOnly
                title="닉네임은 로그인한 닉네임으로 고정돼요."
              />
              <div className="lead-toggle" aria-label="리딩 가능 여부">
                {['O', 'X'].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={profile.leadReady === value ? 'lead-button active' : 'lead-button'}
                    onClick={() => setProfile((prev) => ({ ...prev, leadReady: value }))}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="field-group">
            <label>요일 선택</label>
            {!isScheduleTargetSelected && (
              <p className="field-hint">레이드, 난이도, 공략 방식을 먼저 선택해 주세요.</p>
            )}
            <div className="chip-grid">
              {weekdayNames.map((day) => {
                // active: 시간이 선택된 요일, editing: 지금 시간을 고르고 있는 요일
                const hasTimes = (currentDayTimeSelection[day] ?? []).length > 0
                const isEditing = isScheduleTargetSelected && selectedDayForTimes === day

                return (
                  <button
                    key={day}
                    type="button"
                    className={`chip ${hasTimes ? 'active' : ''} ${isEditing ? 'editing' : ''} ${isScheduleTargetSelected ? '' : 'disabled'}`}
                    onClick={() => setSelectedDayForTimes(day)}
                    disabled={!isScheduleTargetSelected}
                  >
                    {day}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="field-group">
            <label>{selectedDayForTimes ? `${selectedDayForTimes}요일 시간대 선택` : '시간대 선택'}</label>
            {isScheduleTargetSelected && !selectedDayForTimes && (
              <p className="field-hint">요일을 먼저 선택해 주세요.</p>
            )}
            <div className="chip-grid time-grid">
              {visibleTimeSlots.map((time) => {
                const isSelected = (currentDayTimeSelection[selectedDayForTimes] ?? []).includes(time)
                const isHiddenDaytime = !getSelectableTimesForSelectedDay(selectedDayForTimes).includes(time)
                const isDisabled = !isScheduleTargetSelected || !selectedDayForTimes || isHiddenDaytime

                return (
                  <button
                    key={time}
                    type="button"
                    className={`${isSelected ? 'chip active' : 'chip'} ${isDisabled ? 'disabled' : ''}`}
                    onClick={() => toggleTimeSelection(time)}
                    disabled={isDisabled}
                    title={isHiddenDaytime ? '낮시간을 숨기면 12:00~16:00은 선택할 수 없어요.' : ''}
                  >
                    {time}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="two-column">
            <div className="field-group">
              <label htmlFor="attendance">참여 가능 여부</label>
              <select
                id="attendance"
                value={profile.attendance}
                onChange={(event) => setProfile((prev) => ({ ...prev, attendance: event.target.value }))}
              >
                <option value="" disabled>선택</option>
                <option value="참">참</option>
                <option value="불참">불참</option>
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="className">본인 직업</label>
              <select
                id="className"
                value={profile.className}
                onChange={(event) => setProfile((prev) => ({ ...prev, className: event.target.value }))}
              >
                <option value="" disabled>선택</option>
                {classOptions.map((className) => (
                  <option key={className} value={className}>
                    {className}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-group">
            <label htmlFor="power">전투력</label>
            <select
              id="power"
              value={profile.power}
              onChange={(event) => setProfile((prev) => ({ ...prev, power: event.target.value }))}
            >
              <option value="" disabled>선택</option>
              {powerOptions.map((power) => (
                <option key={power} value={power}>
                  {power}
                </option>
              ))}
            </select>
          </div>

          <div className="selected-summary">
            <h3>내 선택 요약</h3>
            <ul>
              <li>닉네임: {profile.nickname || '미입력'}</li>
              <li>가능 시간: {formatDayTimeSelection(currentDayTimeSelection) || '선택 없음'}</li>
              <li>참여 여부: {profile.attendance || '미선택'}</li>
              <li>직업: {profile.className || '미선택'}</li>
              <li>전투력: {profile.power || '미선택'}</li>
              <li>리딩 가능 여부: {profile.leadReady || '미선택'}</li>
              <li>
                우선 레이드:{' '}
                {[selectedRaidLabel, profile.difficulty, profile.mode].map((value) => value || '미선택').join(' · ')}
              </li>
            </ul>
          </div>

          <div className="selected-summary saved-schedule-list">
            <h3>내 저장된 스케줄</h3>
            {mySavedSchedules.length > 0 ? (
              <ul>
                {mySavedSchedules.map((entry) => (
                  <li key={`${entry.raidName}-${entry.difficulty}-${entry.mode}`} className="saved-schedule-item">
                    <div className="saved-schedule-info">
                      <strong>
                        {entry.raidName} · {entry.difficulty} · {entry.mode}
                        {entry.attendance !== '참' && ' (불참)'}
                      </strong>
                      <span>{formatDayTimeSelection(entry.dayTimeSelection)}</span>
                    </div>
                    <button type="button" className="saved-schedule-delete" onClick={() => setPendingDelete(entry)}>
                      삭제
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="saved-schedule-empty">저장된 스케줄이 없어요.</p>
            )}
          </div>

          <div className="member-actions">
            <button type="button" className="primary-button" onClick={openSaveConfirm}>
              캘린더에 저장
            </button>
            <button type="button" className="secondary-button" onClick={() => setPendingDelete('all')}>
              내 스케줄 전체 삭제
            </button>
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

          {calendarHelpOpen && (
            <div className="help-panel compact" data-section="calendar">
              <p>• 탭을 누르면 레이드 · 난이도 · 공략 방식을 바꿀 수 있어요.</p>
              <p>• 각 시간칸은 해당 조건의 인원이 저장한 시간대를 보여주고, A/B 파티로 나뉘어 집계됩니다.</p>
              <p>• 한 타임에 한 포스, 한 파티당 5명씩 총 10명이 기준이며, O는 리딩 가능, X는 리딩 불가를 뜻해요.</p>
              <p>• 요일별 신청 현황에서는 해당 요일에 어떤 레이드와 시간대가 신청됐는지 한눈에 확인할 수 있어요.</p>
            </div>
          )}

          <div className="day-raid-summary-panel" data-section="day">
            <h3>요일별 레이드 신청 현황</h3>
            <div className="day-raid-summary-grid">
              {dayRaidSummary.map(({ day, raidGroups }, dayIndex) => (
                <div key={day} className="day-raid-card">
                  <div className="day-raid-header">
                    <span>{day}요일</span>
                    {/* weekdayNames와 weekDates는 둘 다 수요일부터 시작한다. */}
                    <span className="day-raid-date">
                      {weekDates[dayIndex].getMonth() + 1}/{weekDates[dayIndex].getDate()}
                    </span>
                  </div>
                  {raidGroups.length > 0 ? (
                    <div className="day-raid-list">
                      {raidGroups.map(({ label, raidName, difficulty, mode, times, timeMembers, members }) => {
                        const groupKey = `${day}-${label}`
                        const renderMember = (member, keyPrefix) => (
                          <span
                            key={`${keyPrefix}-${member.nickname}-${member.className}`}
                            className={`day-raid-member has-hover-tooltip ${member.leadReady === 'O' ? 'is-leader' : ''}`}
                          >
                            <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                            <span className={`member-name-wrap ${getNicknameClassName(member.nickname)}`}>
                              <span>{member.nickname}</span>
                              <span className="member-power-inline">{member.power}</span>
                            </span>
                            <span className="member-hover-tooltip" aria-hidden="true">
                              <span className="tooltip-header-row">
                                <img src={getClassIconPath(member.className)} alt={member.className} className="tooltip-icon" />
                                <strong>{member.nickname}</strong>
                                {member.leadReady === 'O' && <span className="tooltip-lead-label">리딩 가능</span>}
                              </span>
                              <span className="tooltip-power">{member.power}</span>
                            </span>
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
                                const run = { weekStart: weekStartKey, day, time, raidName, difficulty, mode }
                                const runKey = getRaidRunKey(run)
                                const runRecord = raidRunByKey.get(runKey)
                                const isSavingRun = savingRunKey === runKey
                                // 이 시간대에 투표한 사람만 표시할 수 있다. (DB 함수도 같은 규칙으로 막는다)
                                const isSlotVoter = timeVoters.some((member) => member.nickname === loggedInNickname)
                                const canEditRun = Boolean(loggedInNickname) && isSlotVoter && !isSavingRun
                                const renderRunStatus = (field, fieldLabel) => {
                                  const value = runRecord?.[field] ?? null
                                  const changedBy = field === 'departed' ? runRecord?.departedBy : runRecord?.clearedBy
                                  const isLocked = field === 'cleared' && runRecord?.departed !== 'O'
                                  const disabledReason = !loggedInNickname
                                    ? '로그인한 뒤에 표시할 수 있어요.'
                                    : !isSlotVoter ? describeAuthResult('not_participant')
                                    : isLocked ? '출발(O)로 표시한 뒤에 정할 수 있어요.' : ''

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
                                          aria-label={`${time} ${fieldLabel} ${option}`}
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
                                  <div key={rowKey} className={`day-raid-time-row ${isExpanded ? 'expanded' : ''}`}>
                                    <button
                                      type="button"
                                      className="day-raid-time-toggle"
                                      aria-expanded={isExpanded}
                                      title={isExpanded ? '접기' : `${time} 인원 펼치기`}
                                      onClick={() => setExpandedSummaryRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))}
                                    >
                                      <span className="day-raid-time-tag">
                                        {time}
                                        <span className="day-raid-time-count">{timeVoters.length}명</span>
                                      </span>
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
                                    <div className="day-raid-run-row">
                                      {renderRunStatus('departed', '출발')}
                                      {renderRunStatus('cleared', '클리어')}
                                    </div>
                                    {isExpanded && (
                                      <div className="day-raid-members">
                                        {timeVoters.map((member) => renderMember(member, rowKey))}
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
                    <div className="empty-role">신청 인원 없음</div>
                  )}
                </div>
              ))}
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
                </button>
              ))}
            </div>
          </div>

          <div className="calendar-grid" data-section="calendar">
            <div className="calendar-corner">시간</div>
            {weekDates.map((date) => {
              const label = date.toLocaleDateString('ko-KR', { weekday: 'short' })

              return (
                <div key={date.toISOString()} className="day-header">
                  <span className="day-name">{label}</span>
                  <strong>{date.getDate()}일</strong>
                </div>
              )
            })}

            {timeSlots.map((time) => {
              const shouldCollapseRow = !showDaytimeSlots && hiddenWeekdayTimeSlots.includes(time)

              return (
                <Fragment key={time}>
                  <div className={`time-label ${shouldCollapseRow ? 'accordion-collapsed' : ''}`}>{time}</div>
                  {weekDates.map((date, dayIndex) => {
                    const currentDaySlots = getDayTimeSlots(date)
                    const isVisibleTime = currentDaySlots.includes(time)
                    const dayLabel = date.toLocaleDateString('ko-KR', { weekday: 'short' })
                    const slot = sampleSlotData.find(
                      (entry) => entry.dayIndex === dayIndex && entry.time === time,
                    )
                    const raidPeople = memberByRaidDateTime.get(`${dayLabel}-${time}`) ?? {}
                    const tabKey = `${activeTabMeta.raid} ${activeTabMeta.difficulty} ${activeModeTab}`
                    const people = raidPeople[tabKey] ?? []
                    const partyA = people.slice(0, 5)
                    const partyB = people.slice(5, 10)

                    if (!isVisibleTime || shouldCollapseRow) {
                      return <div key={`${date.toISOString()}-${time}-empty`} className={`slot-cell empty muted-slot ${shouldCollapseRow ? 'accordion-collapsed' : ''}`} />
                    }

                    return (
                      <div
                        key={`${date.toISOString()}-${time}`}
                        className={`slot-cell ${slot ? 'occupied' : 'empty'} ${myScheduleSet.has(`${dayLabel}-${time}`) ? 'my-schedule-slot' : ''}`}
                      >
                        {myScheduleSet.has(`${dayLabel}-${time}`) && (
                          <span className="my-slot-badge">내 시간</span>
                        )}
                        {slot ? (
                          <>
                            <strong>{activeTabMeta.raid}</strong>
                            <span>{activeTabMeta.difficulty} · {activeModeTab}</span>
                            <small>
                              A {partyA.length}/5 · B {partyB.length}/5
                            </small>
                          </>
                        ) : (
                          <span className="empty-text">비어 있음</span>
                        )}

                        <div className="raid-group-list">
                          <div className="raid-group-item selected-raid-item">
                            <span className="raid-group-label">{activeTabMeta.label}</span>
                            <div className="party-split">
                              <div className="party-column">
                                <span className="party-label">A</span>
                                {partyA.length > 0 ? (
                                  <div className="time-member-list vertical">
                                    {partyA.map((member) => (
                                      <span key={`${dayLabel}-${time}-${tabKey}-A-${member.nickname}`} className="time-member-pill has-hover-tooltip">
                                        <span className="nickname-with-icon">
                                          <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                                          <span className={`member-name-wrap ${getNicknameClassName(member.nickname)}`}>
                                            <span>{member.nickname}</span>
                                            <span className="member-power-inline">{member.power}</span>
                                          </span>
                                          {member.leadReady === 'O' && <span className="lead-badge" role="img" aria-label="리딩 가능"><LeadMark value="O" /></span>}
                                        </span>
                                        <span className="member-hover-tooltip" aria-hidden="true">
                                          <span className="tooltip-header-row">
                                            <img src={getClassIconPath(member.className)} alt={member.className} className="tooltip-icon" />
                                            <strong>{member.nickname}</strong>
                                          </span>
                                          <span className="tooltip-power">{member.power}</span>
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="empty-raid-text">-</span>
                                )}
                              </div>
                              <div className="party-column">
                                <span className="party-label">B</span>
                                {partyB.length > 0 ? (
                                  <div className="time-member-list vertical">
                                    {partyB.map((member) => (
                                      <span key={`${dayLabel}-${time}-${tabKey}-B-${member.nickname}`} className="time-member-pill has-hover-tooltip">
                                        <span className="nickname-with-icon">
                                          <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                                          <span className={`member-name-wrap ${getNicknameClassName(member.nickname)}`}>
                                            <span>{member.nickname}</span>
                                            <span className="member-power-inline">{member.power}</span>
                                          </span>
                                          {member.leadReady === 'O' && <span className="lead-badge" role="img" aria-label="리딩 가능"><LeadMark value="O" /></span>}
                                        </span>
                                        <span className="member-hover-tooltip" aria-hidden="true">
                                          <span className="tooltip-header-row">
                                            <img src={getClassIconPath(member.className)} alt={member.className} className="tooltip-icon" />
                                            <strong>{member.nickname}</strong>
                                          </span>
                                          <span className="tooltip-power">{member.power}</span>
                                        </span>
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="empty-raid-text">-</span>
                                )}
                              </div>
                            </div>
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
                memberByRaidDifficulty.map(({ raidName, difficulty, mode, members, days, times }) => (
                  <div key={`${raidName}-${difficulty}-${mode}`} className="weekday-card">
                    <span className="weekday-title">{raidName} · {difficulty} · {mode}</span>
                    <div className="member-tags">
                      {members.map(({ nickname, className, power, leadReady }) => (
                        <span key={`${raidName}-${difficulty}-${mode}-${nickname}`} className="member-tag has-hover-tooltip">
                          <span className="nickname-with-icon small">
                            <img src={getClassIconPath(className)} alt={className} className="nickname-icon" />
                            <span className={`member-name-wrap ${getNicknameClassName(nickname)}`}>
                              <span>{nickname}</span>
                              <span className="member-power-inline">{power}</span>
                            </span>
                            {leadReady === 'O' && <span className="lead-badge" role="img" aria-label="리딩 가능"><LeadMark value="O" /></span>}
                          </span>
                          <span className="member-hover-tooltip" aria-hidden="true">
                            <span className="tooltip-header-row">
                              <img src={getClassIconPath(className)} alt={className} className="tooltip-icon" />
                              <strong>{nickname}</strong>
                            </span>
                            <span className="tooltip-power">{power}</span>
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <span className="empty-role">선택 인원 없음</span>
              )}
            </div>
          </div>

        </section>
      </main>
    </div>
  )
}

export default App

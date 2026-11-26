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
  adjustRaidEntries,
  setRaidRally,
  setRaidRunStatus,
  setRaidClearCount,
  saveSlotLayout,
  unlinkMemberAlt,
} from './lib/memberApi'
import {
  MobileTabIcon,
  LeadMark,
  TabCount,
  LiveClock,
  ResetCountdown,
  MemberTooltip,
  useIsMobile,
} from './components/common'
import {
  raidOptions,
  upcomingRaids,
  getUpcomingRaidMessage,
  getRaidDifficulties,
  compareRaidTarget,
  getRaidWeeklyLimit,
  countWeeklyEntries,
  getRunClears,
  SUMMARY_ICON_PREVIEW_LIMIT,
  getRaidFullSize,
  getRaidSlotCapacity,
  getPartyGroupLabel,
  arrangeSlot,
  formatArrangementHeadcount,
  getArrangedMembers,
  buildMovedLayout,
  getSlotLayoutKey,
  normalizeSlotLayout,
  upsertSlotLayout,
  loadLocalSlotLayouts,
  saveLocalSlotLayouts,
  isSinglePartyRaid,
  RAID_ONGOING_MS,
  RALLY_OPEN_BEFORE_MS,
  REFRESH_MIN_INTERVAL_MS,
  LATE_NIGHT_GRACE_MS,
  TOAST_DURATION,
  TOAST_ACTION_DURATION,
  ONLY_MINE_STORAGE_KEY,
  RALLY_SUCCESS_MESSAGES,
  modeOptions,
  raidTabOptions,
  raidDifficultyAvailability,
  MOBILE_GUIDE_STORAGE_KEY,
  MOBILE_SECTIONS,
  weekdayNames,
  weekdayTimeSlots,
  weekendTimeSlots,
  hiddenWeekdayTimeSlots,
  timeSlots,
  formatIsoDate,
  buildFallbackHolidaySet,
  getHolidaySetForYear,
  classOptions,
  parsePowerInput,
  POWER_MIN_K,
  POWER_MAX_K,
  getRaidLabel,
  normalizeLeadReady,
  getClassIconPath,
  getNicknameClassName,
  getWeekStart,
  getWeekDates,
  isResetOverlapSlot,
  formatTimeLabel,
  formatHeadcount,
  buildEmptyDayTimeSelection,
  normalizeDayTimeSelection,
  getSelectedDayList,
  getCombinedTimes,
  getScheduleKey,
  isScheduleMember,
  formatScheduleKey,
  describePendingSlot,
  formatDayTimeSelection,
  getDayTimePairs,
  getSlotStartDate,
  formatTimeUntil,
  compareSchedules,
  buildDefaultMember,
  normalizeMemberRecord,
  isSavedThisWeek,
  getSlotSignedTime,
  compareSlotPeople,
  stampSlotSignedAt,
  normalizeRaidScheduleEntry,
  loadLocalMembers,
  saveLocalMembers,
  loadLocalRaidSchedules,
  saveLocalRaidSchedules,
  loadLocalArchivedSchedules,
  saveLocalArchivedSchedules,
  mergeArchivedSchedules,
  formatDateKey,
  getRaidRunKey,
  normalizeRaidRun,
  loadLocalRaidRuns,
  saveLocalRaidRuns,
  upsertRaidRun,
  normalizeEntryAdjustment,
  upsertEntryAdjustment,
  loadLocalEntryAdjustments,
  saveLocalEntryAdjustments,
  readStoredLoginNickname,
  writeStoredLoginNickname,
  readStoredLoginPassword,
  writeStoredLoginPassword,
  buildEmptyPasswordForm,
  fetchMemberAlts,
} from './lib/schedule'
import './App.css'

function App() {
  // 모바일과 PC는 시간표 · 탭의 생김새가 달라서 화면 폭에 따라 다르게 그린다.
  const isMobile = useIsMobile()
  // 모바일 첫 사용 안내
  const [guideOpen, setGuideOpen] = useState(false)
  // 모바일 이번 주 화면의 추천 시간은 접어 두고 요일별 현황을 먼저 보여 준다.
  const [recommendOpen, setRecommendOpen] = useState(false)
  // 모바일에서 다 고른 '신청할 레이드'는 한 줄로 접어 둔다. '변경'을 누르면 펼친다.
  const [targetEditOpen, setTargetEditOpen] = useState(false)
  // 모바일 뒤로 가기: 현재 기록의 탭, 기록에 쌓아 둔 팝업 수, 코드가 직접 되돌린 기록을 무시할지
  const historySectionRef = useRef(null)
  const historyPopupCountRef = useRef(0)
  const ignoreNextPopRef = useRef(false)
  const autoSectionMoveRef = useRef(false)
  // 화면 계산에 쓰는 현재 시각. 1분마다만 바뀐다. (초 단위 시계는 LiveClock · ResetCountdown이 따로 그린다)
  const [currentTime, setCurrentTime] = useState(() => new Date())
  // 페이지를 켜 둔 채 수요일 00시가 지나면 새 주로 넘어가도록 현재 시각에서 주 시작을 다시 계산한다.
  const weekStartTime = getWeekStart(currentTime).getTime()
  const weekDates = useMemo(() => getWeekDates(weekStartTime), [weekStartTime])
  const todayStartTime = new Date(currentTime).setHours(0, 0, 0, 0)
  // 지난 요일로 접는 기준. 새벽에는 전날을 아직 지나지 않은 것으로 본다.
  const activeDayStartTime = new Date(currentTime.getTime() - LATE_NIGHT_GRACE_MS).setHours(0, 0, 0, 0)
  // 수요일 새벽: 리셋은 지났지만 지난주 화요일 레이드를 아직 마무리할 수 있는 시간
  const isResetNight = currentTime.getTime() - weekStartTime < LATE_NIGHT_GRACE_MS
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
  const pastDayNames = weekdayNames.filter((_, index) => weekDates[index].getTime() < activeDayStartTime)
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
  // 전투력 칸에 입력 중인 글자. 입력 중이 아니면 null이고 저장 형식(profile.power)을 보여준다.
  const [powerDraft, setPowerDraft] = useState(null)
  const [powerError, setPowerError] = useState(false)
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
  // 오픈 예정 레이드를 눌렀을 때 가운데 띄우는 안내 (누른 레이드)
  const [upcomingRaidNotice, setUpcomingRaidNotice] = useState(null)
  // 요일별 신청 현황에서 내가 신청한 시간대만 보기 (이 브라우저에 기억)
  const [showOnlyMine, setShowOnlyMine] = useState(() => {
    try {
      return localStorage.getItem(ONLY_MINE_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  // 모바일 주간 캘린더에서 보고 있는 요일 (weekdayNames 순서, 기본은 오늘)
  const [mobileCalendarDayIndex, setMobileCalendarDayIndex] = useState(() => {
    const now = new Date()
    const activeDay = new Date(now.getTime() - LATE_NIGHT_GRACE_MS)

    // 수요일 새벽은 전날이 지난주라서 이번 주 첫날을 보여 준다.
    return getWeekStart(activeDay).getTime() === getWeekStart(now).getTime() ? (activeDay.getDay() + 4) % 7 : 0
  })
  // 추천 시간을 눌러 잠깐 강조할 캘린더 칸 ("요일-시간")
  const [highlightedSlotKey, setHighlightedSlotKey] = useState('')
  // 저장 전 수정 중인 요일/시간 선택 (레이드 · 난이도 · 공략 방식 조합별)
  const [dayTimeDrafts, setDayTimeDrafts] = useState({})
  // 이번 주(수요일 시작) 시간대별 준비 / 클리어 기록
  const weekStartKey = useMemo(() => formatDateKey(weekDates[0]), [weekDates])
  const lastWeekStartKey = useMemo(() => {
    const lastWeekStart = new Date(weekStartTime)
    lastWeekStart.setDate(lastWeekStart.getDate() - 7)
    return formatDateKey(lastWeekStart)
  }, [weekStartTime])
  const [raidRuns, setRaidRuns] = useState(() => (supabase ? [] : loadLocalRaidRuns()))
  // 횟수 제한 레이드(에라쿠스 주 5회)의 쓴 횟수 직접 조정 기록 (레기온 밖에서 쓴 횟수 등)
  const [entryAdjustments, setEntryAdjustments] = useState(() => (supabase ? [] : loadLocalEntryAdjustments()))
  const [isAdjustingEntries, setIsAdjustingEntries] = useState(false)
  // 시간대별 직접 배치 (리딩 가능자가 끌어서 옮긴 공대 · A/B · 대기)
  const [slotLayouts, setSlotLayouts] = useState(() => (supabase ? [] : loadLocalSlotLayouts()))
  // 배치를 바꾸는 중인 칸 { key: 직접 배치 키, picked: 고른 닉네임 }. 모바일은 끌기 대신 눌러서 고르고 옮긴다.
  const [arrangingSlot, setArrangingSlot] = useState(null)
  const [savingLayoutKey, setSavingLayoutKey] = useState('')
  // 디스코드 알림이 가거나 기록이 지워지는 동작 전 확인 팝업 대상: { run, action: 'call' | 'cancel' | 'start' | 'members' | 'cleared' | 'clear-count', alreadyNotified }
  // 'start' · 'members'는 candidates(고를 수 있는 사람)와 picked(고른 닉네임)를 함께 둔다.
  const [pendingRunStatus, setPendingRunStatus] = useState(null)
  // 모바일 인원 탭에서 보는 목록: 'signup'(신청 인원) | 'clear'(이번 주 클리어)
  const [membersView, setMembersView] = useState('signup')
  // 모바일 파티 탭에서 신청이 없는 시간도 보는지
  const [showVacantTimes, setShowVacantTimes] = useState(false)
  // PC 오른쪽 영역에서 보는 탭: 'day'(이번 주) | 'calendar'(파티) | 'clear'(클리어) | 'members'(인원)
  const [pcTab, setPcTab] = useState('day')
  // 같은 시간 겹친 신청 안내에서 '그대로 두기'를 누른 것
  const [dismissedOverlaps, setDismissedOverlaps] = useState(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('raid-calendar-overlap-dismissed-v1') ?? '[]')
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
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

  useEffect(() => {
    if (!supabase) {
      saveLocalEntryAdjustments(entryAdjustments)
    }
  }, [entryAdjustments])

  useEffect(() => {
    if (!supabase) {
      saveLocalSlotLayouts(slotLayouts)
    }
  }, [slotLayouts])

  // 이번 주 직접 배치를 불러오고, 다른 사람이 바꾸면 바로 반영한다.
  // SQL을 아직 실행하지 않아 표가 없으면 모두 신청순 자동 배치로 보인다. (구독 오류가 다른 구독에 번지지 않게 채널을 따로 둔다)
  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    let isMounted = true

    supabase
      .from('raid_slot_layouts')
      .select('*')
      .eq('week_start', weekStartKey)
      .then(({ data, error }) => {
        if (isMounted && !error && Array.isArray(data)) {
          setSlotLayouts(data.map((entry) => normalizeSlotLayout(entry)).filter(Boolean))
        }
      })

    const layoutChannel = supabase
      .channel('raid-slot-layouts-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'raid_slot_layouts' },
        (payload) => {
          const next = normalizeSlotLayout(payload.new)

          if (next?.weekStart === weekStartKey) {
            setSlotLayouts((prev) => upsertSlotLayout(prev, next))
          }
        },
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(layoutChannel)
    }
  }, [weekStartKey, raidRunsReloadTick])

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
      .in('week_start', isResetNight ? [weekStartKey, lastWeekStartKey] : [weekStartKey])
      .then(({ data, error }) => {
        if (isMounted && !error && Array.isArray(data)) {
          setRaidRuns(data.map((entry) => normalizeRaidRun(entry)).filter(Boolean))
        }
      })

    return () => {
      isMounted = false
    }
  }, [weekStartKey, lastWeekStartKey, isResetNight, raidRunsReloadTick])

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

          if (nextRun?.weekStart === weekStartKey || nextRun?.weekStart === lastWeekStartKey) {
            setRaidRuns((prev) => upsertRaidRun(prev, nextRun))
          }
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(raidRunChannel)
    }
  }, [weekStartKey, lastWeekStartKey])

  // 이번 주 쓴 횟수 조정 기록을 불러오고, 다른 사람이 바꾸면 바로 반영한다.
  // supabase_raid_entries.sql을 아직 실행하지 않았으면 표가 없어 조정 없이(자동 집계만) 보인다.
  // 표가 없을 때 실시간 구독 오류가 다른 구독에 번지지 않게 채널을 따로 둔다.
  useEffect(() => {
    if (!supabase) {
      return undefined
    }

    let isMounted = true

    supabase
      .from('raid_entry_adjustments')
      .select('*')
      .eq('week_start', weekStartKey)
      .then(({ data, error }) => {
        if (isMounted && !error && Array.isArray(data)) {
          setEntryAdjustments(data.map((entry) => normalizeEntryAdjustment(entry)).filter(Boolean))
        }
      })

    const adjustmentChannel = supabase
      .channel('raid-entry-adjustments-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'raid_entry_adjustments' },
        (payload) => {
          const next = normalizeEntryAdjustment(payload.new)

          if (next?.weekStart === weekStartKey) {
            setEntryAdjustments((prev) => upsertEntryAdjustment(prev, next))
          }
        },
      )
      .subscribe()

    return () => {
      isMounted = false
      supabase.removeChannel(adjustmentChannel)
    }
  }, [weekStartKey, raidRunsReloadTick])

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

  // 오픈 전 레이드 버튼을 누르면 선택은 바꾸지 않고 오픈 날짜만 가운데 팝업으로 알린다.
  const notifyUpcomingRaid = (raid) => {
    setUpcomingRaidNotice(raid)
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
  const isWeekendOrHolidayDate = (date) => date.getDay() === 0 || date.getDay() === 6 || holidaySet.has(formatIsoDate(date))

  const getDayTimeSlots = (date) => {
    const day = date.getDay()
    const slots = !isWeekendOrHolidayDate(date)
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

  // 캐릭터가 바뀌면 전투력 칸에 쓰다 만 글자를 버린다. (새 캐릭터의 저장값을 보여준다)
  useEffect(() => {
    setPowerDraft(null)
    setPowerError(false)
  }, [currentNickname])
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

  // 같은 계정(본캐 + 부캐)이 이번 주에 이미 참여로 신청한 시간 ("요일|시간" 기준).
  //   takenSlots: 다른 캐릭터가 지금 고른 것과 같은 레이드 조합으로 신청한 시간. 한 사람이 두 자리를 차지하므로 막는다.
  //               DB의 _schedule_time_conflict와 같은 기준이다.
  //   otherRaidSlots: 다른 레이드 조합으로 신청한 시간. 함께 신청할 수 있고, 겹친다는 표시만 한다. (값은 신청 목록)
  const { takenSlots, otherRaidSlots } = useMemo(() => {
    const taken = new Map()
    const others = new Map()

    raidSchedules.forEach((entry) => {
      if (entry.attendance !== '참' || !myCharacters.includes(entry.nickname)) {
        return
      }

      const isSameTarget = getScheduleKey(entry) === currentScheduleKey

      // 지금 고치고 있는 스케줄은 덮어쓸 것이라 뺀다.
      if (isSameTarget && entry.nickname === currentNickname) {
        return
      }

      getDayTimePairs(entry.dayTimeSelection).forEach(([day, time]) => {
        const slotKey = `${day}|${time}`

        if (!isSameTarget) {
          others.set(slotKey, [...(others.get(slotKey) ?? []), entry])
        } else if (!taken.has(slotKey)) {
          taken.set(slotKey, entry)
        }
      })
    })

    return { takenSlots: taken, otherRaidSlots: others }
  }, [raidSchedules, myCharacters, currentNickname, currentScheduleKey])

  // "부캐명 · 무스펠 보통 트라이" 처럼 겹친 신청을 알려 주는 문구
  const describeTakenSlot = (entry) => (
    `${entry.nickname === currentNickname ? '이 캐릭터' : entry.nickname} · ${entry.raidName} ${entry.difficulty} ${entry.mode}`
  )

  // 같은 시간에 신청해 둔 다른 레이드를 알려 주는 문구
  const describeOtherRaids = (entries) => `같은 시간 다른 신청: ${entries.map(describeTakenSlot).join(' / ')}`

  // 시간표 칸 여러 개를 한꺼번에 고르거나(shouldSelect) 지운다.
  // 그 요일에 없는 시간대, 이미 지난 시간, 내 다른 캐릭터가 같은 레이드로 신청한 시간은 새로 고를 수 없다. (골라 둔 것을 빼는 것은 된다)
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

        if (isCurrentEntriesExhausted) {
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
      return `다른 캐릭터로 이미 신청한 시간이에요: ${describeTakenSlot(takenBy)}`
    }

    if (isPastSlot(day, time)) {
      return '이미 지난 시간이라 고를 수 없어요.'
    }

    return isCurrentEntriesExhausted ? entriesExhaustedMessage : ''
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

  // 신청은 raid_schedules에만 있다. (members는 캐릭터 정보만 쓴다. 옛 시간 값이 유령 신청으로 되살아나지 않게 읽지 않는다)
  const allScheduleEntries = useMemo(
    () => raidSchedules
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
    [raidSchedules],
  )

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

    return [...map.values()].sort(compareRaidTarget)
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
    () => new Map(
      raidRuns
        .filter((run) => run.weekStart === weekStartKey || run.weekStart === lastWeekStartKey)
        .map((run) => [getRaidRunKey(run), run]),
    ),
    [raidRuns, weekStartKey, lastWeekStartKey],
  )

  const memberByRaidDateTime = useMemo(() => {
    const map = new Map()

    raidSchedules.forEach((entry) => {
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
  }, [raidSchedules])

  // 그 시간대(이번 주)의 신청 인원. 신청 순서대로.
  const getRunPeople = useMemo(() => (run) => (
    memberByRaidDateTime.get(`${run.day}-${run.time}`)?.[`${run.raidName} ${run.difficulty} ${run.mode}`] ?? []
  ), [memberByRaidDateTime])

  // 이번 주 직접 배치 (getSlotLayoutKey → 기록)
  const slotLayoutByKey = useMemo(
    () => new Map(slotLayouts.filter((entry) => entry.weekStart === weekStartKey).map((entry) => [getSlotLayoutKey(entry), entry])),
    [slotLayouts, weekStartKey],
  )

  // 그 시간대(이번 주)의 공대 · A/B · 대기 배치. 직접 배치가 있으면 반영한다. (DB의 _raid_slot_assignment와 같은 기준)
  const getSlotArrangement = useCallback((slot) => arrangeSlot(
    getRunPeople(slot),
    getRaidFullSize(slot.raidName),
    slotLayoutByKey.get(getSlotLayoutKey({ ...slot, weekStart: weekStartKey }))?.layout,
  ), [getRunPeople, slotLayoutByKey, weekStartKey])

  // 횟수 제한 레이드(에라쿠스 유적 주 5회)의 이번 주 사용 횟수. 클리어할 때마다 남긴 명단으로 센다.
  const weeklyEntryCounts = useMemo(
    () => countWeeklyEntries(raidRuns, weekStartKey, getRunPeople),
    [raidRuns, weekStartKey, getRunPeople],
  )

  // 이번 주 클리어 기록 (요일 · 시간 순). people: 클리어한 사람과 그 시간대에서 클리어한 횟수
  const weeklyClears = useMemo(() => (
    raidRuns
      .filter((run) => run.weekStart === weekStartKey)
      .map((run) => {
        const clears = getRunClears(run, getRunPeople)
        const counts = new Map()
        clears.forEach(({ members: names }) => names.forEach((name) => counts.set(name, (counts.get(name) ?? 0) + 1)))
        return { run, count: clears.length, people: [...counts].map(([nickname, count]) => ({ nickname, count })) }
      })
      .filter(({ count }) => count > 0)
      .sort((a, b) => (
        weekdayNames.indexOf(a.run.day) - weekdayNames.indexOf(b.run.day)
        || timeSlots.indexOf(a.run.time) - timeSlots.indexOf(b.run.time)
        || compareSchedules(a.run, b.run)
      ))
  ), [raidRuns, weekStartKey, getRunPeople])

  // 클리어 목록의 직업 아이콘. 신청을 지운 사람도 보이게 캐릭터 정보까지 함께 찾는다.
  const classByNickname = useMemo(() => new Map([
    ...storedMembers.map((member) => [member.nickname, member.className]),
    ...raidSchedules.map((entry) => [entry.nickname, entry.className]),
  ]), [storedMembers, raidSchedules])

  // 이번 주 직접 조정 ("레이드|닉네임" → +n / -n)
  const entryAdjustmentByKey = useMemo(
    () => new Map(entryAdjustments
      .filter((entry) => entry.weekStart === weekStartKey)
      .map((entry) => [`${entry.raidName}|${entry.nickname}`, entry.adjustment])),
    [entryAdjustments, weekStartKey],
  )

  // 횟수 제한 레이드의 이번 주 사용 현황. 제한이 없는 레이드면 null.
  // cleared: 클리어 기록으로 자동으로 센 횟수, adjustment: 직접 조정, used: 합계, left: 남은 횟수
  const getEntryUsage = (raidName, nickname) => {
    const limit = getRaidWeeklyLimit(raidName)

    if (!limit) {
      return null
    }

    const cleared = weeklyEntryCounts.get(`${raidName}|${nickname}`) ?? 0
    const adjustment = entryAdjustmentByKey.get(`${raidName}|${nickname}`) ?? 0
    const used = Math.max(0, cleared + adjustment)
    return { limit, cleared, adjustment, used, left: Math.max(0, limit - used) }
  }

  // 남은 횟수. 횟수 제한이 없는 레이드면 null.
  const getEntriesLeft = (raidName, nickname) => getEntryUsage(raidName, nickname)?.left ?? null

  // 이름 옆에 붙이는 남은 횟수 표시 (예: 3/5)
  const renderEntriesLeft = (raidName, nickname) => {
    const usage = getEntryUsage(raidName, nickname)

    if (!usage) {
      return null
    }

    return (
      <span
        className={`entries-left-badge${usage.left === 0 ? ' is-empty' : ''}`}
        title={`이번 주 남은 횟수 ${usage.left}/${usage.limit}`}
        aria-label={`남은 횟수 ${usage.left}/${usage.limit}`}
      >
        {usage.left}/{usage.limit}
      </span>
    )
  }

  // 지금 폼의 캐릭터가 고른 레이드의 사용 현황. 횟수를 다 썼으면 새 시간을 고를 수 없다.
  const currentEntryUsage = getEntryUsage(selectedRaidLabel, currentNickname)
  const isCurrentEntriesExhausted = currentEntryUsage?.left === 0
  const entriesExhaustedMessage = `이번 주 ${selectedRaidLabel} 횟수(${getRaidWeeklyLimit(selectedRaidLabel)}회)를 다 써서 새로 신청할 수 없어요.`

  // 폼의 캐릭터가 고른 레이드의 쓴 횟수를 직접 1회 더하거나(delta 1) 뺀다(delta -1).
  // 레기온 밖에서 쓴 횟수는 +, 클리어로 셌지만 실제로 안 들어갔으면 −.
  const adjustEntryCount = async (delta) => {
    const nickname = currentNickname
    const raidName = selectedRaidLabel

    if (!nickname || !currentEntryUsage || isAdjustingEntries) {
      return
    }

    let next

    if (supabase) {
      setIsAdjustingEntries(true)

      let result

      try {
        result = await adjustRaidEntries(nickname, sessionPassword, raidName, delta)
      } catch (error) {
        showToast(`횟수를 바꾸지 못했어요. (${error.message})`, 'error', 'entry-adjust')
        return
      } finally {
        setIsAdjustingEntries(false)
      }

      if (result?.error) {
        showToast(`횟수를 바꾸지 못했어요. ${describeAuthResult(result.error)}`, 'error', 'entry-adjust')
        return
      }

      next = normalizeEntryAdjustment(result)
    } else {
      next = { weekStart: weekStartKey, nickname, raidName, adjustment: currentEntryUsage.adjustment + delta }
    }

    setEntryAdjustments((prev) => upsertEntryAdjustment(prev, next))
    showToast(`${nickname} 남은 횟수를 1회 ${delta > 0 ? '줄였어요' : '늘렸어요'}.`, 'success', 'entry-adjust')
  }

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

  // 모바일은 요일 하나씩 보여 주므로, 처음 들어오면 내 가장 가까운 신청 요일, 없으면 신청이 있는 가장 가까운 요일을 연다.
  const dayAutoPickedRef = useRef(false)

  useEffect(() => {
    if (dayAutoPickedRef.current || !loggedInNickname || dataLoadState !== 'ready') {
      return
    }

    dayAutoPickedRef.current = true

    const firstActiveDay = weekdayNames.find((day, index) => (
      weekDates[index].getTime() >= activeDayStartTime && allScheduleEntries.some((entry) => entry.days.includes(day))
    ))
    const targetDay = myUpcomingSlots[0]?.day ?? firstActiveDay

    if (targetDay) {
      setMobileCalendarDayIndex(weekdayNames.indexOf(targetDay))
    }
  }, [loggedInNickname, dataLoadState, myUpcomingSlots, allScheduleEntries, weekDates, activeDayStartTime])

  // 모바일에서 처음 로그인하면 탭 설명을 한 번 보여 준다.
  useEffect(() => {
    if (!isMobile || !loggedInNickname) {
      return
    }

    try {
      if (!localStorage.getItem(MOBILE_GUIDE_STORAGE_KEY)) {
        setGuideOpen(true)
      }
    } catch {
      // Ignore storage errors.
    }
  }, [isMobile, loggedInNickname])

  const closeGuide = () => {
    setGuideOpen(false)

    try {
      localStorage.setItem(MOBILE_GUIDE_STORAGE_KEY, '1')
    } catch {
      // Ignore storage errors.
    }
  }

  // 내 신청 중 대기였다가 정원(2파티까지)에 든 시간대가 있으면 앱을 켜 둔 사람에게 바로 알려 준다. (디스코드 알림은 DB 트리거가 보낸다)
  const myWaitlistStateRef = useRef(null)

  useEffect(() => {
    const nextState = new Map(myUpcomingSlots.map((slot) => {
      const key = [slot.nickname, slot.day, slot.time, slot.raidName, slot.difficulty, slot.mode].join('|')
      return [key, { slot, isWaitlisted: getSlotArrangement(slot).partyOf.get(slot.nickname) === 0 }]
    }))
    const previousState = myWaitlistStateRef.current

    myWaitlistStateRef.current = nextState

    previousState?.forEach(({ isWaitlisted }, key) => {
      const current = nextState.get(key)

      if (isWaitlisted && current && !current.isWaitlisted) {
        const { slot } = current
        showToast(
          `${slot.day}요일 ${formatTimeLabel(slot.time)} ${slot.raidName} ${slot.difficulty} ${slot.mode}: 대기에서 정원으로 올라왔어요.`,
          'success',
          `promoted-${key}`,
        )
      }
    })
  }, [myUpcomingSlots, getSlotArrangement])

  // 다른 사람이 클리어를 눌러 내 캐릭터 횟수가 차감되면 앱을 켜 둔 사람에게 바로 알려 준다. (내가 누른 것은 그때 안내한다)
  // 처음 불러온 기록은 알리지 않고, 보고 있던 기록에 클리어가 늘었을 때만 알린다.
  const myClearStateRef = useRef(new Map())

  useEffect(() => {
    const previousState = myClearStateRef.current
    const nextState = new Map(raidRuns
      .filter((run) => run.weekStart === weekStartKey && getRaidWeeklyLimit(run.raidName))
      .map((run) => [getRaidRunKey(run), run.clearLog ?? []]))

    myClearStateRef.current = nextState

    nextState.forEach((log, key) => {
      const newClears = previousState.has(key) ? log.slice(previousState.get(key).length) : []
      const mine = myCharacters.filter((name) => newClears.some((clear) => clear.members.includes(name) && !myCharacters.includes(clear.by)))

      if (mine.length > 0) {
        const raidName = key.split('|')[3]
        showToast(
          `${raidName} 클리어 ${log.length}회! ${mine.map((name) => `${name} 남은 횟수 ${getEntriesLeft(raidName, name)}/${getRaidWeeklyLimit(raidName)}`).join(', ')}`,
          'success',
          `charged-${key}`,
        )
      }
    })
  }, [raidRuns, weekStartKey, myCharacters])

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
    // 사용자가 옮긴 것이 아니므로 뒤로 가기 기록에 남기지 않는다.
    autoSectionMoveRef.current = true
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

    // 모바일은 그 신청이 있는 요일을 열어 바로 고칠 수 있게 한다. 지나지 않은 요일을 먼저 고른다.
    if (isMobile) {
      const entryDays = weekdayNames.filter((day) => (entry.dayTimeSelection?.[day] ?? []).length > 0)
      const targetDay = entryDays.find((day) => weekDates[weekdayNames.indexOf(day)].getTime() >= activeDayStartTime) ?? entryDays[0]

      if (targetDay) {
        setMobileCalendarDayIndex(weekdayNames.indexOf(targetDay))
      }
    }

    document.getElementById('schedule-day-field')?.scrollIntoView({ behavior: 'smooth', block: isMobile ? 'start' : 'center' })
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
    setTargetEditOpen(false)
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

  // 맨 위 팝업부터 닫는다. Esc와 모바일 뒤로 가기가 함께 쓴다.
  const closeTopPopup = () => {
    if (upcomingRaidNotice) {
      setUpcomingRaidNotice(null)
    } else if (guideOpen) {
      closeGuide()
    } else if (memberDetail) {
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
  const closeTopPopupRef = useRef(closeTopPopup)

  useEffect(() => {
    closeTopPopupRef.current = closeTopPopup
  })

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeTopPopupRef.current()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 모바일 뒤로 가기: 팝업이 열려 있으면 닫고, 아니면 이전 탭으로 돌아간다. 처음 탭에서 누르면 그때 앱을 벗어난다.
  const openPopupCount = [
    upcomingRaidNotice, guideOpen, memberDetail, pendingRunStatus, clearAllConfirmOpen, restoreConfirmOpen, altManagerOpen, passwordChangeOpen, mobileMenuOpen,
  ].filter(Boolean).length

  useEffect(() => {
    if (!isMobile || !loggedInNickname) {
      historySectionRef.current = null
      historyPopupCountRef.current = 0
      return
    }

    if (historySectionRef.current === null) {
      window.history.replaceState({ raidSection: mobileSection }, '')
      historySectionRef.current = mobileSection
      autoSectionMoveRef.current = false
    }

    if (mobileSection !== historySectionRef.current) {
      const method = autoSectionMoveRef.current ? 'replaceState' : 'pushState'
      window.history[method]({ raidSection: mobileSection }, '')
      historySectionRef.current = mobileSection
    }

    autoSectionMoveRef.current = false

    // 버튼으로 닫은 팝업의 기록은 지우고, 새로 연 팝업은 기록을 쌓아 뒤로 가기로 닫히게 한다.
    if (historyPopupCountRef.current > openPopupCount) {
      ignoreNextPopRef.current = true
      window.history.go(openPopupCount - historyPopupCountRef.current)
      historyPopupCountRef.current = openPopupCount
    }

    while (historyPopupCountRef.current < openPopupCount) {
      window.history.pushState({ raidSection: mobileSection }, '')
      historyPopupCountRef.current += 1
    }
  }, [isMobile, loggedInNickname, mobileSection, openPopupCount])

  useEffect(() => {
    if (!isMobile || !loggedInNickname) {
      return undefined
    }

    const handlePopState = (event) => {
      if (ignoreNextPopRef.current) {
        ignoreNextPopRef.current = false
        return
      }

      if (historyPopupCountRef.current > 0) {
        historyPopupCountRef.current -= 1
        closeTopPopupRef.current()
        return
      }

      const section = event.state?.raidSection

      if (section) {
        historySectionRef.current = section
        setMobileSection(section)
        window.scrollTo({ top: 0 })
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isMobile, loggedInNickname])

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
    setPcTab('day')
    setMobileCalendarDayIndex(weekdayNames.indexOf(day))
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
  // restoredSignedAt: 되돌리기일 때 뺄 때의 신청 시각. 로컬 모드에서만 쓴다. (DB는 raid_slot_removed로 같은 일을 한다)
  const persistSchedule = async (nickname, info, target, dayTimeSelection, restoredSignedAt = null) => {
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
        showToast(`신청을 저장하지 못했어요. (${error.message})`, 'error')
        return false
      }

      if (result?.error) {
        const conflict = result.conflict
        const conflictDetail = conflict
          ? `\n${conflict.day}요일 ${formatTimeLabel(conflict.time)}: ${conflict.nickname} · ${conflict.raid_name} ${conflict.difficulty} ${conflict.mode}`
          : ''
        showToast(`신청을 저장하지 못했어요. ${describeAuthResult(result.error)}${conflictDetail}`, 'error')
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
      const stampedEntry = { ...localEntry, slotSignedAt: stampSlotSignedAt(nextSchedules[index], selection, updatedAt, weekStartTime, restoredSignedAt) }

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
      showToast(`같은 레이드를 같은 시간에 신청한 다른 캐릭터가 있어요. 아래 시간을 빼고 저장해 주세요.\n${conflictLines.join('\n')}`, 'error')
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
        '',
        // 모바일은 저장 뒤 현황이 다른 탭에 있어서 바로 넘어갈 수 있게 한다.
        isMobile ? { label: '현황 보기', onClick: () => selectMobileSection('day') } : null,
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
  // 내 다른 캐릭터가 같은 레이드 조합으로 신청한 시간과 이미 지난 시간은 빼고 등록한다.
  const restoreSchedules = async () => {
    setRestoreConfirmOpen(false)

    const nickname = currentNickname

    if (!nickname || isSaving || selectedRestoreSchedules.length === 0) {
      return
    }

    const takenKeys = new Set(
      raidSchedules
        .filter((entry) => entry.attendance === '참' && myCharacters.includes(entry.nickname))
        .flatMap((entry) => getDayTimePairs(entry.dayTimeSelection).map(([day, time]) => `${getScheduleKey(entry)}|${day}|${time}`)),
    )
    const skipped = []
    const skippedPast = []
    const skippedExhausted = []
    let restoredCount = 0

    setIsSaving(true)

    try {
      for (const entry of selectedRestoreSchedules) {
        // 이번 주 횟수를 다 쓴 레이드(에라쿠스 주 5회)는 다시 등록하지 않는다.
        if (getEntriesLeft(entry.raidName, nickname) === 0) {
          skippedExhausted.push(entry.raidName)
          continue
        }

        const selection = normalizeDayTimeSelection(entry.dayTimeSelection)

        weekdayNames.forEach((day) => {
          selection[day] = selection[day].filter((time) => {
            const slotKey = `${getScheduleKey(entry)}|${day}|${time}`

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
      showToast(`다른 캐릭터가 같은 레이드로 신청해서 뺀 시간: ${skipped.join(', ')}`, 'info')
    }

    if (skippedPast.length > 0) {
      showToast(`이미 지나서 뺀 시간: ${skippedPast.join(', ')}`, 'info')
    }

    if (skippedExhausted.length > 0) {
      showToast(`이번 주 횟수를 다 써서 뺀 레이드: ${[...new Set(skippedExhausted)].join(', ')}`, 'info')
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
    showToast(`${trimmedNickname}의 신청을 모두 삭제했어요.`, 'success')
  }

  // 레이드 · 난이도 · 공략 방식이 같은 스케줄 한 건만 삭제한다. 성공하면 true.
  const deleteSchedule = async (target, trimmedNickname = currentNickname) => {
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
    // 폼에서 고치는 선택은 지금 고른 캐릭터의 것이다.
    if (trimmedNickname === currentNickname) {
      setDayTimeDrafts((prev) => {
        const nextDrafts = { ...prev }
        delete nextDrafts[targetKey]
        return nextDrafts
      })
    }

    return true
  }

  // 저장된 스케줄 한 건에서 요일 하나(time이 null) 또는 요일 · 시간 하나만 뺀다.
  // 남은 시간이 없으면 스케줄을 통째로 삭제하고, 남아 있으면 줄인 선택으로 다시 저장한다. 성공하면 true.
  const deleteScheduleSlot = async ({ entry, day, time }, trimmedNickname = currentNickname) => {
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
      return deleteSchedule(entry, trimmedNickname)
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
    if (trimmedNickname === currentNickname) {
      setDayTimeDrafts((prev) => (prev[targetKey] ? { ...prev, [targetKey]: removeSlot(prev[targetKey]) } : prev))
    }

    return true
  }

  // 스케줄 한 건(target) 또는 그 안의 요일 · 시간({ entry, day, time })을 확인 창 없이 지우고,
  // 알림의 [되돌리기]로 지우기 전 스케줄을 그대로 다시 저장할 수 있게 한다.
  const deleteWithUndo = async (target, nickname = currentNickname) => {
    const entry = target.entry ?? target
    const scheduleLabel = formatScheduleKey(getScheduleKey(entry))
    const isDeleted = target.entry ? await deleteScheduleSlot(target, nickname) : await deleteSchedule(target, nickname)

    if (!isDeleted) {
      return
    }

    const undoDelete = async () => {
      const info = { attendance: entry.attendance, className: entry.className, power: entry.power, leadReady: entry.leadReady }

      if (await persistSchedule(nickname, info, entry, entry.dayTimeSelection, entry.slotSignedAt)) {
        showToast(`${scheduleLabel} 신청을 되돌렸어요.`, 'success', 'undo-delete')
      }
    }

    showToast(
      target.entry
        ? `${scheduleLabel}에서 ${describePendingSlot(target)} 시간을 삭제했어요.`
        : `${scheduleLabel} 신청을 삭제했어요.`,
      'success',
      'undo-delete',
      { label: '되돌리기', onClick: undoDelete },
    )
  }

  // 같은 계정(본캐 + 부캐)이 이번 주에 신청한 모든 시간대("레이드 조합|요일|시간"). 폼에서 고치는 조합도 뺀 takenSlots와 달리 전부 포함한다.
  const myAllTakenSlots = useMemo(() => new Set(
    raidSchedules
      .filter((entry) => entry.attendance === '참' && myCharacters.includes(entry.nickname))
      .flatMap((entry) => getDayTimePairs(entry.dayTimeSelection).map(([day, time]) => `${getScheduleKey(entry)}|${day}|${time}`)),
  ), [raidSchedules, myCharacters])

  // '나도 참여'를 보여 줄 시간대인지. 지났거나 내 캐릭터가 이미 그 레이드를 그 시간에 신청했으면 보여 주지 않는다.
  // 같은 시간에 다른 레이드를 신청한 것은 괜찮다.
  // 횟수를 다 쓴 레이드(에라쿠스 주 5회)는 바로 신청 버튼을 숨긴다.
  const canJoinSlot = ({ day, time, raidName, difficulty, mode }) => (
    !isPastSlot(day, time)
    && !myAllTakenSlots.has(`${getScheduleKey({ raidName, difficulty, mode })}|${day}|${time}`)
    && getEntriesLeft(raidName, currentNickname) !== 0
  )

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

  // 그 시간대(요일 · 시간 · 레이드 조합)에 참여로 투표한 내 캐릭터. 같은 레이드 · 같은 시간은 한 캐릭터만 신청할 수 있어 많아야 하나다.
  // 준비 · 클리어 표시는 이 캐릭터 이름으로 남긴다. 없으면 로그인한 본캐.
  const getMySlotNickname = (run) => (
    (run.weekStart === weekStartKey ? raidSchedules : storedRaidSchedules).find((entry) => (
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
        if (result.run) {
          setRaidRuns((prev) => upsertRaidRun(prev, normalizeRaidRun(result.run)))
        }

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

    const fullSize = getRaidFullSize(run.raidName)
    const voters = getRunPeople(run).map((person) => person.nickname)
    const departed = voters.filter((name) => current.rallyCheckins.includes(name)).slice(0, fullSize)
    const partyRoster = getArrangedMembers(getSlotArrangement(run), run.party ?? 1).map((person) => person.nickname)
    const clearLog = value === 'O' ? [{ at: new Date().toISOString(), by: nickname, members: departed.length > 0 ? departed : partyRoster }] : []

    setRaidRuns((prev) => upsertRaidRun(prev, { ...current, cleared: value, clearedBy: value ? nickname : null, clearLog }))
    showToast(value ? `클리어 ${value}로 표시했어요.` : '클리어 표시를 지웠어요.', 'success')
  }

  // 횟수 제한 레이드(에라쿠스 유적)에서 지금 클리어를 누르면 차감될 사람: 출발한 사람(준비 완료로 된 신청자) 중 횟수가 남은 사람을 정원까지.
  // DB의 _raid_clear_add와 같은 기준이어야 한다. 지난주 시간대는 신청자와 남은 횟수를 알 수 없어 준비 완료로 된 사람으로 본다.
  const getClearTargets = (run) => {
    const checkins = raidRunByKey.get(getRaidRunKey(run))?.rallyCheckins ?? []

    if (run.weekStart !== weekStartKey) {
      return checkins.map((nickname) => ({ nickname, left: null }))
    }

    return [...new Set(getRunPeople(run).map((person) => person.nickname))]
      .filter((nickname) => checkins.includes(nickname))
      .map((nickname) => ({ nickname, left: getEntriesLeft(run.raidName, nickname) }))
      .filter(({ left }) => left > 0)
      .slice(0, getRaidFullSize(run.raidName))
  }

  // 클리어 1회를 더하거나('add') 마지막 1회를 되돌린다('undo'). expectedCount는 누를 때 화면에 보인 클리어 횟수.
  const applyClearCount = async (run, action, expectedCount) => {
    const nickname = loggedInNickname ? getMySlotNickname(run) : ''

    if (!nickname) {
      showToast('로그인한 뒤에 클리어를 표시할 수 있어요.', 'error')
      return
    }

    const runKey = getRaidRunKey(run)
    const targets = getClearTargets(run)
    let charged = targets.map((target) => target.nickname)
    let notified = false

    if (supabase) {
      setSavingRunKey(runKey)

      let result

      try {
        result = await setRaidClearCount(nickname, sessionPassword, run, action, expectedCount)
      } catch (error) {
        showToast(`클리어를 저장하지 못했어요. (${error.message})`, 'error', 'clear-count')
        return
      } finally {
        setSavingRunKey('')
      }

      // 다른 사람이 먼저 누른 경우에도 최신 상태로 맞춘다.
      const savedRun = normalizeRaidRun(result?.run)

      if (savedRun) {
        setRaidRuns((prev) => upsertRaidRun(prev, savedRun))
      }

      if (result?.error) {
        showToast(describeAuthResult(result.error), 'error', 'clear-count')
        return
      }

      charged = savedRun?.clearLog.at(-1)?.members ?? charged
      notified = Boolean(result?.notified)
    } else {
      // 로컬 모드: DB 함수와 같은 규칙으로 이 브라우저에만 저장한다. (디스코드 알림 없음)
      setRaidRuns((prev) => {
        const current = prev.find((item) => getRaidRunKey(item) === runKey)
        const clearLog = getRunClears(current, getRunPeople)

        if (!current?.gatheredAt || clearLog.length !== expectedCount) {
          return prev
        }

        const nextLog = action === 'add' ? [...clearLog, { at: new Date().toISOString(), by: nickname, members: charged }] : clearLog.slice(0, -1)
        return upsertRaidRun(prev, { ...current, clearLog: nextLog, cleared: nextLog.length > 0 ? 'O' : null, clearedBy: nextLog.at(-1)?.by ?? null })
      })
    }

    if (action === 'undo') {
      showToast(`클리어 1회를 되돌렸어요. 차감한 횟수도 돌아왔어요. (클리어 ${expectedCount - 1}회)`, 'success', 'clear-count')
      return
    }

    const limit = getRaidWeeklyLimit(run.raidName)
    const chargedText = charged.map((name) => {
      const left = targets.find((target) => target.nickname === name)?.left
      return left ? `${name} ${left - 1}/${limit}` : name
    }).join(', ')

    showToast(
      // 모바일은 남은 횟수가 바로 위에 보이므로, 알림이 그것을 가리지 않게 한 줄로 줄인다.
      isMobile
        ? `클리어 ${expectedCount + 1}회 · 1회씩 차감${notified ? ' · 디스코드 알림' : ''}`
        : `클리어 ${expectedCount + 1}회! 1회씩 차감했어요.\n남은 횟수: ${chargedText}${notified ? '\n이번 주 횟수를 모두 쓴 사람이 있어 디스코드로 알렸어요.' : ''}`,
      'success',
      'clear-count',
      { label: '되돌리기', onClick: () => applyClearCount(run, 'undo', expectedCount + 1) },
    )
  }

  // 누군가 마지막 1회를 쓰는 클리어는 디스코드 알림이 가므로 한 번 확인하고, 그 밖에는 바로 차감한다. (알림의 되돌리기로 취소 가능)
  const handleClearCountClick = (run, count) => {
    const targets = getClearTargets(run)

    if (targets.length === 0) {
      showToast(describeAuthResult('no_entries_left'), 'error', 'clear-count')
      return
    }

    const finishing = targets.filter(({ left }) => left === 1).map(({ nickname }) => nickname)

    if (finishing.length > 0) {
      const notifiedNames = raidRunByKey.get(getRaidRunKey(run))?.clearFinished ?? []
      setPendingRunStatus({ run, action: 'clear-count', count, finishing, alreadyNotified: finishing.every((name) => notifiedNames.includes(name)) })
      return
    }

    applyClearCount(run, 'add', count)
  }

  // 횟수 제한 레이드의 클리어 칸: 한 번 출발해 클리어할 때마다 '+1 클리어'를 누른다. 실패(X)는 아직 클리어가 없을 때만.
  // partyLabel: 2파티로 나뉜 시간대면 "1공대" · "2파티"처럼 어느 파티 기록인지 버튼 이름에 붙인다.
  const renderClearCounter = ({ run, record, canEdit, disabledReason = '', labelPrefix = '', partyLabel = '', isLarge = false }) => {
    const count = getRunClears(record, getRunPeople).length
    const isFailed = count === 0 && record?.cleared === 'X'
    const label = `${labelPrefix}${formatTimeLabel(run.time)}${partyLabel ? ` ${partyLabel}` : ''} 클리어`

    return (
      <span
        className={`day-raid-run-status day-raid-clear-count ${isLarge ? 'is-large' : ''} ${count > 0 ? 'is-yes' : isFailed ? 'is-no' : ''}`}
        title={disabledReason || `클리어할 때마다 눌러요. 출발한 사람이 1회씩 차감돼요.${record?.clearedBy ? ` · 마지막 ${record.clearedBy}` : ''}`}
      >
        <span className="day-raid-run-label">클리어 {count}회</span>
        <button
          type="button"
          className={`day-raid-rally-button ${isLarge ? 'is-primary' : ''}`}
          aria-label={`${label} 1회 추가`}
          disabled={!canEdit}
          onClick={() => handleClearCountClick(run, count)}
        >
          +1 클리어
        </button>
        {count > 0 ? (
          <button
            type="button"
            className="day-raid-rally-button active"
            aria-label={`${label} 1회 되돌리기`}
            disabled={!canEdit}
            onClick={() => applyClearCount(run, 'undo', count)}
          >
            되돌리기
          </button>
        ) : (
          <button
            type="button"
            className={`day-raid-run-button ${isFailed ? 'active' : ''}`}
            aria-pressed={isFailed}
            aria-label={`${label} X`}
            disabled={!canEdit}
            onClick={() => handleRunStatusClick(run, 'cleared', 'X')}
          >
            <LeadMark value="X" />
          </button>
        )}
      </span>
    )
  }

  // 출발한 뒤 시간 줄 아래에 사람별 남은 횟수를 펼치지 않아도 보이게 한다. 방금 차감된 사람은 강조하고, 출발하지 않은 사람은 흐리게.
  const renderClearEntries = (run, record, rosterNicknames, departedNicknames) => {
    const clears = getRunClears(record, getRunPeople)
    const lastCharged = clears.at(-1)?.members ?? []
    const names = [...new Set([...rosterNicknames, ...departedNicknames, ...clears.flatMap((clear) => clear.members)])]

    return (
      <div className="day-raid-clear-entries">
        <span className="day-raid-clear-entries-label">남은 횟수</span>
        {names.map((name) => {
          const isCharged = lastCharged.includes(name)
          const isAbsent = !departedNicknames.includes(name)

          return (
            <span
              key={name}
              className={`day-raid-clear-entry${isCharged && !isAbsent ? ' is-charged' : ''}${isAbsent ? ' is-absent' : ''}`}
              title={isAbsent ? '지금 출발 인원이 아니라 차감되지 않아요.' : isCharged ? '마지막 클리어에서 1회 차감됐어요.' : undefined}
            >
              {name}
              {renderEntriesLeft(run.raidName, name)}
            </span>
          )
        })}
      </div>
    )
  }

  // 준비 호출 / 체크 / 체크 취소 / 호출 취소. slotVoterNicknames는 로컬 모드에서 모두 모였는지 볼 때 쓴다.
  // members: 'start' · 'members'에서 고른 출발 인원
  const applyRaidRally = async (run, action, slotVoterNicknames, members = null) => {
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
        result = await setRaidRally(nickname, sessionPassword, run, action, members)
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
      nextRun = { ...current, rallyCalledBy: null, rallyCalledAt: null, rallyCheckins: [], gatheredAt: null, cleared: null, clearedBy: null, clearLog: [] }
    } else if (action === 'start') {
      if (!current.rallyCalledAt) {
        showToast(describeAuthResult('not_called'), 'error')
        return
      }

      nextRun = { ...current, gatheredAt: current.gatheredAt ?? new Date().toISOString(), rallyCheckins: members ?? current.rallyCheckins }
    } else if (action === 'members') {
      if (!current.gatheredAt) {
        showToast(describeAuthResult('not_gathered'), 'error')
        return
      }

      nextRun = { ...current, rallyCheckins: members }
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
    if (action === 'call' || action === 'cancel' || action === 'remind' || action === 'start' || action === 'members') {
      const runRecord = raidRunByKey.get(getRaidRunKey(run))
      const pending = { run, action, slotVoterNicknames, alreadyNotified: (runRecord?.rallyNotifyCount ?? 0) >= 2 }

      // 시작 · 출발 인원: 실제로 가는 사람을 고른다. 지금까지 준비 완료한 사람을 골라 둔다.
      // 이 파티 인원을 먼저 두고, 다른 파티 · 대기 인원은 이름 옆에 표시한다. 다른 파티로 이미 출발한 사람은 고를 수 없다. (DB도 막는다)
      // 지난주 시간대는 신청자를 알 수 없어 고르지 않고 준비 완료한 사람 그대로 시작한다.
      if ((action === 'start' || action === 'members') && run.weekStart === weekStartKey) {
        const fullSize = getRaidFullSize(run.raidName)
        const party = run.party ?? 1
        const people = getRunPeople(run)
        const names = [...new Set(people.map((person) => person.nickname))]
        const checkins = runRecord?.rallyCheckins ?? []
        const departedElsewhere = new Set(
          [...raidRunByKey.values()]
            .filter((record) => (
              record.weekStart === run.weekStart && record.day === run.day && record.time === run.time
              && record.raidName === run.raidName && record.difficulty === run.difficulty && record.mode === run.mode
              && record.party !== party && record.gatheredAt
            ))
            .flatMap((record) => record.rallyCheckins),
        )
        const { partyOf } = getSlotArrangement(run)
        const getTag = (nickname) => {
          const memberParty = partyOf.get(nickname)
          return memberParty === party ? '' : memberParty === 0 ? '대기' : getPartyGroupLabel(run.raidName, memberParty)
        }
        pending.candidates = names
          .filter((nickname) => !departedElsewhere.has(nickname))
          .map((nickname) => ({ nickname, tag: getTag(nickname) }))
          .sort((a, b) => (a.tag === '') === (b.tag === '') ? 0 : a.tag === '' ? -1 : 1)
        pending.picked = names.filter((nickname) => checkins.includes(nickname) && !departedElsewhere.has(nickname)).slice(0, fullSize)
      }

      setPendingRunStatus(pending)
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

    if (target.action === 'clear-count') {
      applyClearCount(target.run, 'add', target.count)
      return
    }

    applyRaidRally(target.run, target.action, target.slotVoterNicknames, target.picked ?? null)
  }

  // 출발 인원 고르기 팝업에서 한 사람을 넣거나 뺀다.
  const togglePickedMember = (nickname) => {
    setPendingRunStatus((prev) => (prev?.picked
      ? { ...prev, picked: prev.picked.includes(nickname) ? prev.picked.filter((name) => name !== nickname) : [...prev.picked, nickname] }
      : prev))
  }

  // 같은 시간 겹친 신청을 그대로 둔다. (다시 묻지 않는다)
  const dismissOverlap = (key) => {
    setDismissedOverlaps((prev) => {
      const next = [...prev, key].slice(-40)

      try {
        localStorage.setItem('raid-calendar-overlap-dismissed-v1', JSON.stringify(next))
      } catch {
        // Ignore storage errors.
      }

      return next
    })
  }

  // 같은 시간에 남은 다른 레이드 신청을 뺀다. 부캐 신청이면 그 부캐 것을 뺀다.
  const removeOverlapSlot = async (slot) => {
    const entry = raidSchedules.find((item) => item.nickname === slot.nickname && getScheduleKey(item) === getScheduleKey(slot))

    if (entry) {
      await deleteWithUndo({ entry, day: slot.day, time: slot.time }, slot.nickname)
    }
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
            닉네임과 비밀번호로 로그인해요. 처음이면 안내받은 초기 비밀번호를 입력해 주세요.
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

          {!savePassword && isMobile && (
            <p className="remember-hint">내 휴대폰이면 '비밀번호 저장'을 켜 두세요. 다음부터 바로 들어와요.</p>
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
    const people = memberByRaidDateTime.get(`${slot.day}-${slot.time}`)?.[`${slot.raidName} ${slot.difficulty} ${slot.mode}`] ?? []
    const fullSize = getRaidFullSize(slot.raidName)
    // 내가 든 파티(1 | 2)의 기록을 본다. 대기면 1파티 기록을 보여 준다. (직접 배치를 반영)
    const arrangement = getSlotArrangement(slot)
    const myParty = arrangement.partyOf.get(slot.nickname) ?? 1
    const party = myParty || 1
    const run = { weekStart: weekStartKey, day: slot.day, time: slot.time, raidName: slot.raidName, difficulty: slot.difficulty, mode: slot.mode, party }
    const runKey = getRaidRunKey(run)
    const runRecord = raidRunByKey.get(runKey)
    const myGroup = arrangement.groups.find((group) => group.party === party)
    const partyMembers = myGroup?.members ?? []
    const isInParty = (members) => members.some((person) => person.nickname === slot.nickname)
    const waitingIndex = arrangement.waiting.findIndex((person) => person.nickname === slot.nickname)
    // 2파티로 나뉜 시간대면 몇 번째 파티인지 붙인다. (10인 레이드는 "2공대 A파티", 초월은 "2파티")
    const groupLabel = arrangement.groups.length > 1 ? getPartyGroupLabel(slot.raidName, party) : ''
    const abLabel = isSinglePartyRaid(slot.raidName) || !myGroup ? '' : isInParty(myGroup.partyA) ? 'A파티' : isInParty(myGroup.partyB) ? 'B파티' : ''
    // 준비 확인은 그 파티에 든 사람만 센다. (DB의 _raid_party_roster와 같은 기준)
    const voterNicknames = [...new Set(partyMembers.map((person) => person.nickname))]
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
      departedCount: new Set(people.map((person) => person.nickname).filter((name) => rallyCheckins.includes(name))).size,
      runRecord,
      isMeChecked: rallyCheckins.includes(slot.nickname),
      isWaitlisted: myParty === 0,
      fullSize,
      headcountText: formatArrangementHeadcount(arrangement, fullSize),
      // 1파티 레이드(초월)는 A/B 구분이 없어 2파티로 나뉘었을 때만 파티 이름을 붙인다.
      partyLabel: myParty === 0 ? `대기 ${waitingIndex + 1}번` : [groupLabel, abLabel].filter(Boolean).join(' '),
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
  const isConfirmedSlot = (slot) => slot.people.length >= getRaidFullSize(slot.raidName) && slot.leaderCount > 0

  const buildRecommendedSlots = (targets) => targets
    .flatMap(({ raidName, difficulty, mode }) => weekdayNames.flatMap((day) => timeSlots.map((time) => {
      const people = memberByRaidDateTime.get(`${day}-${time}`)?.[`${raidName} ${difficulty} ${mode}`] ?? []
      return { raidName, difficulty, mode, day, time, people, leaderCount: people.filter((person) => person.leadReady === 'O').length }
    })))
    .filter((slot) => slot.people.length > 0 && !isPastSlot(slot.day, slot.time))
    .sort((a, b) => (
      isConfirmedSlot(b) - isConfirmedSlot(a)
      || Math.min(b.people.length, getRaidFullSize(b.raidName)) - Math.min(a.people.length, getRaidFullSize(a.raidName))
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
    setPcTab('calendar')
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
  // 같은 시간에 여러 레이드를 신청했으면 내가 출발한 레이드를 먼저 보여 준다.
  const isDepartedWithMe = (slot) => slot.isGathered && slot.isMeChecked
  const nextRaidSlot = myUpcomingSlotDetails.find(isWaitingForMe)
    ?? myUpcomingSlotDetails.find((slot) => slot.startTime === myUpcomingSlotDetails[0].startTime && isDepartedWithMe(slot))
    ?? myUpcomingSlotDetails[0]
    ?? null
  const nextRaidNeedsMe = Boolean(nextRaidSlot && isWaitingForMe(nextRaidSlot))
  const laterRaidSlots = myUpcomingSlotDetails.filter((slot) => slot !== nextRaidSlot)

  // 내가 이미 출발한 레이드와 같은 시간에 남아 있는 다른 신청. 자리를 비워 줄지 물어본다.
  const overlapNotices = myUpcomingSlotDetails.filter(isDepartedWithMe).flatMap((departed) => (
    myUpcomingSlotDetails
      .filter((slot) => slot.startTime === departed.startTime && slot.runKey !== departed.runKey && !isDepartedWithMe(slot))
      .map((slot) => ({ key: `${departed.runKey}>${slot.runKey}>${slot.nickname}`, departed, slot }))
  )).filter(({ key, slot }, index, list) => (
    !dismissedOverlaps.includes(key) && list.findIndex((item) => item.slot.runKey === slot.runKey) === index
  ))

  // PC와 모바일 신청 화면에서는 급한 일이 없으면 리셋 · 다음 레이드를 한 줄로 줄인다.
  // 시작 1시간 전이거나 준비 확인이 시작되면 버튼이 있는 카드로 바뀐다.
  const isSummaryCompact = (!isMobile || mobileSection === 'form')
    && !nextRaidSlot?.isRallyCalled
    && !nextRaidSlot?.canCallRally

  // 모바일 파티 화면: 고른 요일에 신청이 있는 시간. 하나라도 있으면 빈 시간은 '더 보기'로 접는다.
  const mobilePartyDay = weekdayNames[mobileCalendarDayIndex]
  const partyTabKey = `${activeTabMeta.raid} ${activeTabMeta.difficulty} ${activeModeTab}`
  const isPartyTimeUsed = (day, time) => (
    (memberByRaidDateTime.get(`${day}-${time}`)?.[partyTabKey] ?? []).length > 0 || myScheduleSet.has(`${day}-${time}`)
  )
  const mobilePartyTimes = isMobile ? getDayTimeSlots(weekDates[mobileCalendarDayIndex]) : []
  const vacantPartyTimes = mobilePartyTimes.some((time) => isPartyTimeUsed(mobilePartyDay, time))
    ? mobilePartyTimes.filter((time) => !isPartyTimeUsed(mobilePartyDay, time))
    : []

  // 수요일 새벽: 리셋으로 사라진 지난주 화요일 레이드 중 준비 확인을 했던 것. 끝나고 클리어를 표시할 수 있게 남겨 둔다.
  const lastWeekMyRuns = isResetNight
    ? pastRaidSchedules
      .filter((entry) => entry.attendance === '참' && myCharacters.includes(entry.nickname))
      .flatMap((entry) => (entry.dayTimeSelection?.['화'] ?? []).map((time) => {
        // 파티마다 기록이 따로 있다. 내가 출발한 파티를, 없으면 1파티를 보여 준다.
        const partyRuns = [1, 2].map((party) => {
          const run = { weekStart: lastWeekStartKey, day: '화', time, raidName: entry.raidName, difficulty: entry.difficulty, mode: entry.mode, party }
          return { run, runKey: getRaidRunKey(run), record: raidRunByKey.get(getRaidRunKey(run)) }
        })
        return partyRuns.find(({ record }) => record?.rallyCalledAt && record.rallyCheckins.includes(entry.nickname)) ?? partyRuns[0]
      }))
      .filter(({ record }) => record?.rallyCalledAt)
    : []

  // 추천 시간의 상태 문구
  const getRecommendStatus = (slot) => {
    const remaining = getRaidFullSize(slot.raidName) - slot.people.length

    if (isConfirmedSlot(slot)) {
      return '출발 가능'
    }

    return remaining > 0 ? `모집 중 · ${remaining}명 더` : '리더 필요'
  }

  // 모바일에서 지금 폼의 신청이 저장된 그대로인지. 그러면 저장 버튼 대신 저장됨으로 보여 준다.
  const isCurrentScheduleSaved = isMobile
    && Boolean(savedCurrentSchedule)
    && savedCurrentSchedule.attendance === '참'
    && !isClearingSavedSchedule
    && !unsavedScheduleKeys.includes(currentScheduleKey)
    && !outdatedCharacterSchedules.some((entry) => getScheduleKey(entry) === currentScheduleKey)

  // 비어 있는 목록의 문구. 아직 못 불러온 상태를 '신청 없음'으로 보여 주지 않는다.
  const getEmptyText = (text) => {
    if (dataLoadState === 'loading') {
      return '불러오는 중…'
    }

    return dataLoadState === 'error' ? '불러오지 못했어요' : text
  }

  // 폼 단계 제목. 끝낸 단계는 번호 대신 ✓로 보여 준다.
  const renderStepTitle = (step, isDone, text) => (
    <h3 className="form-section-title">
      <span className={`form-step-number ${isDone ? 'is-done' : ''}`} aria-hidden="true">{isDone ? '✓' : step}</span>
      {text}
    </h3>
  )

  // 모바일 요일 탭. 신청 · 현황 · 파티 화면이 같은 요일을 함께 쓴다. getMark가 숫자면 개수, true면 점을 보여 준다.
  const renderMobileDayTabs = (section, getMark) => (
    <div className="mobile-day-tabs" data-section={section} role="tablist" aria-label="요일 선택">
      {weekDates.map((date, dayIndex) => {
        const day = weekdayNames[dayIndex]
        const mark = getMark(day)
        const isToday = date.getTime() === todayStartTime

        return (
          <button
            key={day}
            type="button"
            role="tab"
            aria-selected={mobileCalendarDayIndex === dayIndex}
            className={`mobile-day-tab${mobileCalendarDayIndex === dayIndex ? ' active' : ''}${date.getTime() < activeDayStartTime ? ' is-past' : ''}${isToday ? ' is-today' : ''}${holidaySet.has(formatIsoDate(date)) ? ' is-holiday' : ''}`}
            onClick={() => setMobileCalendarDayIndex(dayIndex)}
          >
            <span>{day}</span>
            <small>{isToday ? '오늘' : date.getDate()}</small>
            {typeof mark === 'number'
              ? mark > 0 && <span className="mobile-day-tab-count">{mark}</span>
              : mark && <span className="mobile-day-tab-dot" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )

  // 고른 요일의 시간을 다른 요일에도 넣는다. 그 요일에 없거나 지났거나 다른 캐릭터가 같은 레이드로 신청한 시간은 뺀다. 저장 전이라 되돌릴 수 있다.
  const copyTimesToOtherDays = (sourceDay) => {
    if (isCurrentEntriesExhausted) {
      showToast(entriesExhaustedMessage, 'info', 'copy-times')
      return
    }

    const times = currentDayTimeSelection[sourceDay] ?? []
    const pairs = weekdayNames
      .filter((day) => day !== sourceDay)
      .flatMap((day) => times
        .filter((time) => (
          getSelectableTimesForSelectedDay(day).includes(time)
          && !(currentDayTimeSelection[day] ?? []).includes(time)
          && !takenSlots.has(`${day}|${time}`)
          && !isPastSlot(day, time)
        ))
        .map((time) => [day, time]))

    if (pairs.length === 0) {
      showToast('더 넣을 수 있는 요일이 없어요.', 'info', 'copy-times')
      return
    }

    const scheduleKey = currentScheduleKey
    const previousDraft = dayTimeDrafts[scheduleKey]

    setSlotSelection(pairs, true)
    showToast(`${new Set(pairs.map(([day]) => day)).size}개 요일에 같은 시간을 넣었어요. 저장해야 반영돼요.`, 'success', 'copy-times', {
      label: '되돌리기',
      onClick: () => setDayTimeDrafts((prev) => {
        const nextDrafts = { ...prev }

        if (previousDraft) {
          nextDrafts[scheduleKey] = previousDraft
        } else {
          delete nextDrafts[scheduleKey]
        }

        return nextDrafts
      }),
    })
  }

  const tapMobileTime = (day, time, isSelected) => {
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

  // 모바일 시간 고르기: 요일을 고르고 큰 시간 버튼을 누른다. 그 시간에 신청한 인원도 함께 보여 준다.
  const renderMobileTimePicker = () => {
    const day = weekdayNames[mobileCalendarDayIndex]
    const date = weekDates[mobileCalendarDayIndex]
    const times = getSelectableTimesForSelectedDay(day)
    const selectedTimes = currentDayTimeSelection[day] ?? []
    const targetKey = `${selectedRaidLabel} ${profile.difficulty} ${profile.mode}`
    const selectionText = formatDayTimeSelection(currentDayTimeSelection)

    return (
      <div className={`mobile-time-picker ${isScheduleTargetSelected ? '' : 'is-disabled'}`}>
        {renderMobileDayTabs('form', (tabDay) => (currentDayTimeSelection[tabDay] ?? []).length)}
        <div className="mobile-time-head">
          <strong>
            {date.getMonth() + 1}/{date.getDate()} ({day})
            {holidaySet.has(formatIsoDate(date)) && <span className="day-holiday-label"> 공휴일</span>}
          </strong>
          <button type="button" className="text-link-button" onClick={() => toggleTimeLine(times.map((time) => [day, time]))}>
            이 날 전체 고르기 / 지우기
          </button>
        </div>
        <div className="mobile-time-list">
          {times.map((time) => {
            const isSelected = selectedTimes.includes(time)
            const blockReason = getSlotBlockReason(day, time, isSelected)
            const peopleCount = isScheduleTargetSelected ? (memberByRaidDateTime.get(`${day}-${time}`)?.[targetKey] ?? []).length : 0
            const isPast = isPastSlot(day, time)
            const otherRaids = otherRaidSlots.get(`${day}|${time}`)
            const subText = takenSlots.has(`${day}|${time}`)
              ? '신청함'
              : isPast ? '지남' : peopleCount > 0 ? `${peopleCount}명 신청` : ' '

            return (
              <button
                key={time}
                type="button"
                className={`mobile-time-button${isSelected ? ' is-selected' : ''}${otherRaids ? ' has-other-raid' : ''}${blockReason ? ' is-blocked' : ''}`}
                aria-pressed={isSelected}
                aria-disabled={Boolean(blockReason)}
                aria-label={`${day}요일 ${formatTimeLabel(time)}`}
                aria-description={otherRaids ? describeOtherRaids(otherRaids) : undefined}
                onClick={() => tapMobileTime(day, time, isSelected)}
              >
                <strong>{isSelected ? `✓ ${formatTimeLabel(time)}` : formatTimeLabel(time)}</strong>
                <small>{subText}</small>
              </button>
            )
          })}
        </div>
        {times.some((time) => otherRaidSlots.has(`${day}|${time}`)) && (
          <p className="field-hint mobile-other-raid-hint">
            <i className="other-raid-dot" aria-hidden="true" />내가 다른 레이드도 신청한 시간 (함께 신청할 수 있어요)
          </p>
        )}
        {selectedTimes.length > 0 && (
          <button type="button" className="secondary-button mobile-copy-times" onClick={() => copyTimesToOtherDays(day)}>
            이 시간을 다른 요일에도 넣기
          </button>
        )}
        <p className="mobile-time-summary">
          <strong>고른 시간</strong> {selectionText || '아직 없어요'}
        </p>
      </div>
    )
  }

  // 이번 주 클리어 목록의 사람 한 명
  const renderClearPerson = (nickname, detail, isDone = false) => {
    const className = classByNickname.get(nickname)

    return (
      <span key={nickname} className={`member-tag clear-person${isDone ? ' is-done' : ''}${myCharacters.includes(nickname) ? ' is-me' : ''}`}>
        {className && <img src={getClassIconPath(className)} alt={className} className="nickname-icon" />}
        <span className="clear-person-name">{nickname}</span>
        {detail}
      </span>
    )
  }

  // 시작한 시간대의 표시: 정원이 모두 준비했으면 '전원 준비', 일부만 갔으면 '출발'
  const getDepartLabel = (checkedCount, departedCount, rosterCount) => (
    `${checkedCount === rosterCount && departedCount === rosterCount ? '전원 준비' : '출발'} ${departedCount}/${rosterCount}`
  )

  // 그 시간대에서 배치를 바꿀 수 있는 내 캐릭터: 그 시간대에 리딩 가능(O)으로 신청한 내 캐릭터(본캐 · 부캐). 없으면 ''.
  const getSlotArranger = (people) => (
    loggedInNickname ? people.find((person) => myCharacters.includes(person.nickname) && person.leadReady === 'O')?.nickname ?? '' : ''
  )

  // 직접 배치를 저장한다. 바로 보이게 먼저 바꾸고, 저장에 실패하면 되돌린다.
  // Supabase 모드에서는 DB 함수가 리딩 가능자인지 · 자리가 남는지 한 번 더 확인한다.
  const applySlotLayout = async (slot, layout, arrangerNickname, successMessage) => {
    const next = {
      weekStart: weekStartKey,
      day: slot.day,
      time: slot.time,
      raidName: slot.raidName,
      difficulty: slot.difficulty,
      mode: slot.mode,
      layout,
      updatedBy: arrangerNickname,
      updatedAt: new Date().toISOString(),
    }
    const key = getSlotLayoutKey(next)
    const previous = slotLayoutByKey.get(key) ?? null
    const revert = () => setSlotLayouts((prev) => (previous ? upsertSlotLayout(prev, previous) : prev.filter((entry) => getSlotLayoutKey(entry) !== key)))

    setSlotLayouts((prev) => upsertSlotLayout(prev, next))

    if (!supabase) {
      showToast(successMessage, 'success', 'slot-layout')
      return
    }

    setSavingLayoutKey(key)

    let result

    try {
      result = await saveSlotLayout(arrangerNickname, sessionPassword, next, layout)
    } catch (error) {
      revert()
      showToast(`배치를 저장하지 못했어요. (${error.message})`, 'error', 'slot-layout')
      return
    } finally {
      setSavingLayoutKey('')
    }

    if (result?.error) {
      revert()
      showToast(`배치를 저장하지 못했어요. ${describeAuthResult(result.error)}`, 'error', 'slot-layout')
      return
    }

    setSlotLayouts((prev) => upsertSlotLayout(prev, normalizeSlotLayout(result.layout)))
    showToast(successMessage, 'success', 'slot-layout')
  }

  // 한 사람을 옮긴다. target: { party, side } | { party: 0 }(대기) | { swapWith: 닉네임 }
  const moveSlotMember = (slot, arrangement, arrangerNickname, nickname, target) => {
    if (!nickname) {
      return
    }

    const result = buildMovedLayout(arrangement, getRaidFullSize(slot.raidName), nickname, target)
    setArrangingSlot((prev) => (prev ? { ...prev, picked: null } : prev))

    if (result.error === 'same') {
      return
    }

    if (result.error) {
      showToast(describeAuthResult(result.error), 'error', 'slot-layout')
      return
    }

    applySlotLayout(slot, result.layout, arrangerNickname, target.swapWith ? `${nickname} ↔ ${target.swapWith} 자리를 바꿨어요.` : `${nickname}님을 옮겼어요.`)
  }

  const renderJoinButton = (slot, peopleCount, extraClass = '') => (
    canJoinSlot(slot) ? (
      <button
        type="button"
        className={`join-slot-button ${extraClass}`}
        disabled={isSaving}
        title={`${currentNickname}(으)로 ${slot.day}요일 ${formatTimeLabel(slot.time)}에 신청해요.`}
        aria-label={extraClass === 'is-compact'
          ? `${slot.day}요일 ${formatTimeLabel(slot.time)} ${slot.raidName} ${slot.difficulty} ${slot.mode} ${peopleCount >= getRaidSlotCapacity(slot.raidName) ? '대기 신청' : '나도 참여'}`
          : undefined}
        onClick={() => joinSlot(slot)}
      >
        {/* 2파티까지 차야 대기다. */}
        {extraClass === 'is-compact' ? (peopleCount >= getRaidSlotCapacity(slot.raidName) ? '+ 대기' : '+ 참여')
          : extraClass === 'is-vacant-join' ? '+ 신청' : peopleCount >= getRaidSlotCapacity(slot.raidName) ? '+ 대기 신청' : '+ 나도 참여'}
      </button>
    ) : null
  )

  return (
    <div className="app-shell" data-mobile-section={mobileSection} data-pc-tab={pcTab}>
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
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setMobileMenuOpen(false)
                  setGuideOpen(true)
                }}
              >
                사용법
              </button>
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
              의 지난 신청 중 고른 것을 이번 주 신청으로 저장해요. 다른 캐릭터가 같은 레이드로 신청한 시간은 빼고 등록해요.
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
                : pendingRunStatus.action === 'members' ? '출발 인원을 고쳐 주세요'
                : pendingRunStatus.action === 'clear-count' ? '클리어 1회를 추가할까요?'
                : '클리어로 표시할까요?'}
            </h3>
            <p>
              <span className="save-confirm-nickname">
                {pendingRunStatus.run.raidName} · {pendingRunStatus.run.difficulty} · {pendingRunStatus.run.mode}
                {/* 2파티로 나뉜 시간대면 어느 파티 기록인지 함께 적는다. */}
                {((pendingRunStatus.run.party ?? 1) > 1 || getRunPeople(pendingRunStatus.run).length > getRaidFullSize(pendingRunStatus.run.raidName))
                  && ` · ${getPartyGroupLabel(pendingRunStatus.run.raidName, pendingRunStatus.run.party ?? 1)}`}
              </span>
              {` ${pendingRunStatus.run.day}요일 ${formatTimeLabel(pendingRunStatus.run.time)} 레이드`}
              {pendingRunStatus.action === 'call' && '의 준비 확인을 시작합니다. 정원에 든 사람이 모두 준비 완료를 누르면 전원 준비가 돼요.'}
              {pendingRunStatus.action === 'start' && (pendingRunStatus.candidates
                ? '를 기다리지 않고 시작합니다. 실제로 가는 사람만 골라 주세요.'
                : '를 지금 준비한 인원으로 시작합니다.')}
              {pendingRunStatus.action === 'members' && '에서 실제로 가는 사람만 골라 주세요. 이미 기록한 클리어는 바뀌지 않아요.'}
              {pendingRunStatus.candidates && (getRaidWeeklyLimit(pendingRunStatus.run.raidName) > 0
                ? ' 고른 사람만 횟수가 차감돼요.'
                : ' 고른 사람이 클리어 명단에 들어가요.')}
              {pendingRunStatus.action === 'cancel' && '의 준비 확인을 취소합니다. 지금까지의 준비 완료와 클리어 표시도 함께 지워져요.'}
              {pendingRunStatus.action === 'cancel' && getRaidWeeklyLimit(pendingRunStatus.run.raidName) > 0 && ' 차감한 횟수도 되돌아가요.'}
              {pendingRunStatus.action === 'clear-count' && `의 클리어를 1회 추가합니다. ${pendingRunStatus.finishing.join(', ')}님이 이번 주 횟수를 모두 쓰게 돼요.`}
              {pendingRunStatus.action === 'remind' && '의 준비 확인을 디스코드로 한 번 더 알립니다. 지금 신청한 인원과 아직 준비 안 한 인원이 함께 가요. (시간대마다 두 번까지)'}
              {pendingRunStatus.action === 'cleared' && '를 클리어(O)로 표시합니다.'}
              {supabase && pendingRunStatus.action === 'start' && ' 디스코드 알림이 연결되어 있으면 채널에 알림이 가요.'}
              {supabase && (pendingRunStatus.action === 'call' || pendingRunStatus.action === 'cleared' || pendingRunStatus.action === 'clear-count') && (pendingRunStatus.alreadyNotified
                ? ' 이미 디스코드로 알렸기 때문에 다시 알리지 않아요.'
                : ' 디스코드 알림이 연결되어 있으면 채널에 알림이 가요.')}
            </p>
            {pendingRunStatus.candidates && (
              <div className="depart-picker" role="group" aria-label="출발 인원">
                {pendingRunStatus.candidates.map(({ nickname, tag }) => (
                  <label key={nickname} className={`depart-option ${pendingRunStatus.picked.includes(nickname) ? 'is-picked' : ''}`}>
                    <input
                      type="checkbox"
                      checked={pendingRunStatus.picked.includes(nickname)}
                      onChange={() => togglePickedMember(nickname)}
                    />
                    <span className="depart-option-name">{nickname}</span>
                    {tag && <small>{tag}</small>}
                    {renderEntriesLeft(pendingRunStatus.run.raidName, nickname)}
                  </label>
                ))}
                <small className={`depart-count ${pendingRunStatus.picked.length > getRaidFullSize(pendingRunStatus.run.raidName) ? 'is-over' : ''}`}>
                  {pendingRunStatus.picked.length}/{getRaidFullSize(pendingRunStatus.run.raidName)}명 출발
                  {pendingRunStatus.picked.length > getRaidFullSize(pendingRunStatus.run.raidName) && ' · 정원보다 많아요'}
                </small>
              </div>
            )}
            <div className="save-confirm-actions">
              <button type="button" className="secondary-button" onClick={() => setPendingRunStatus(null)}>
                {pendingRunStatus.action === 'cancel' ? '닫기' : '취소'}
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={Boolean(pendingRunStatus.candidates) && (pendingRunStatus.picked.length === 0 || pendingRunStatus.picked.length > getRaidFullSize(pendingRunStatus.run.raidName))}
                onClick={confirmPendingRunStatus}
              >
                {pendingRunStatus.action === 'call' ? '호출'
                  : pendingRunStatus.action === 'cancel' ? '호출 취소'
                  : pendingRunStatus.action === 'remind' ? '다시 알림'
                  : pendingRunStatus.action === 'start' ? '시작'
                  : pendingRunStatus.action === 'members' ? '바꾸기'
                  : pendingRunStatus.action === 'clear-count' ? '추가' : '표시'}
              </button>
            </div>
          </div>
        </div>
      )}

      {upcomingRaidNotice && (
        <div className="save-confirm-backdrop" onClick={() => setUpcomingRaidNotice(null)}>
          <div
            className="save-confirm-modal upcoming-raid-modal"
            role="alertdialog"
            aria-label={`${upcomingRaidNotice.label} 오픈 안내`}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>
              {upcomingRaidNotice.label}
              <small>{upcomingRaidNotice.tag}</small>
            </h3>
            <p>{getUpcomingRaidMessage(upcomingRaidNotice)}</p>
            <div className="save-confirm-actions">
              <button type="button" className="primary-button" autoFocus onClick={() => setUpcomingRaidNotice(null)}>
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {clearAllConfirmOpen && (
        <div className="save-confirm-backdrop" onClick={() => setClearAllConfirmOpen(false)}>
          <div className="save-confirm-modal" onClick={(event) => event.stopPropagation()}>
            <h3>내 신청을 전부 삭제할까요?</h3>
            <p>
              <span className="save-confirm-nickname">{currentNickname || '현재 프로필'}</span>
              의 신청을 모두 지워요. 지운 뒤에는 되돌릴 수 없어요.
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

      {lastWeekMyRuns.length > 0 && (
        <section className="last-week-raids" aria-label="지난주 화요일 레이드 마무리">
          <div className="last-week-raids-head">
            <strong>지난주 화요일 레이드 마무리</strong>
            <span>리셋이 지났지만 오전 6시까지 표시할 수 있어요.</span>
          </div>
          <ul>
            {lastWeekMyRuns.map(({ run, runKey, record }) => (
              <li key={runKey}>
                <span>{formatTimeLabel(run.time)} · {run.raidName} {run.difficulty} {run.mode}</span>
                {record.gatheredAt && getRaidWeeklyLimit(run.raidName) > 0 ? (
                  renderClearCounter({ run, record, canEdit: savingRunKey !== runKey, labelPrefix: '지난주 화요일 ' })
                ) : record.gatheredAt ? (
                  <span className={`day-raid-run-status ${record.cleared ? `is-${record.cleared === 'O' ? 'yes' : 'no'}` : ''}`}>
                    <span className="day-raid-run-label">클리어</span>
                    {['O', 'X'].map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`day-raid-run-button ${record.cleared === option ? 'active' : ''}`}
                        aria-pressed={record.cleared === option}
                        aria-label={`지난주 화요일 ${formatTimeLabel(run.time)} 클리어 ${option}`}
                        disabled={savingRunKey === runKey}
                        onClick={() => handleRunStatusClick(run, 'cleared', option)}
                      >
                        <LeadMark value={option} />
                      </button>
                    ))}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="day-raid-rally-button"
                    disabled={savingRunKey === runKey}
                    onClick={() => handleRallyClick(run, 'start', [])}
                  >
                    ▶ 이 인원으로 시작
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {guideOpen && (
        <div className="save-confirm-backdrop" onClick={closeGuide}>
          <div className="save-confirm-modal mobile-guide" role="dialog" aria-label="사용법" onClick={(event) => event.stopPropagation()}>
            <h3>이렇게 쓰면 돼요</h3>
            <dl className="mobile-guide-list">
              <dt>신청</dt>
              <dd>레이드를 고르고 갈 수 있는 시간을 눌러 저장해요.</dd>
              <dt>이번 주</dt>
              <dd>요일별로 누가 오는지 보고, '나도 참여'로 바로 신청해요.</dd>
              <dt>파티</dt>
              <dd>시간마다 A · B 파티가 어떻게 나뉘는지 봐요. 정원을 넘으면 2공대(2파티)도 보여요.</dd>
              <dt>인원</dt>
              <dd>이번 주 클리어한 사람과 레이드별로 누가 신청했는지 봐요.</dd>
            </dl>
            <p className="field-hint">메뉴(☰)의 '사용법'에서 다시 볼 수 있어요.</p>
            <button type="button" className="primary-button" onClick={closeGuide}>
              시작하기
            </button>
          </div>
        </div>
      )}

      {overlapNotices.map(({ key, departed, slot }) => (
        <section key={key} className="overlap-notice" role="status" aria-label="같은 시간 다른 신청">
          <p>
            <strong>{departed.raidName} {departed.difficulty}</strong>에 출발했어요. 같은 시간({slot.day} {formatTimeLabel(slot.time)})의{' '}
            <strong>{slot.raidName} {slot.difficulty} {slot.mode}</strong>
            {slot.nickname !== loggedInNickname && ` (${slot.nickname})`} 신청을 뺄까요? 빼면 대기자가 들어올 수 있어요.
          </p>
          <div className="overlap-notice-actions">
            <button type="button" className="secondary-button small-toggle" onClick={() => dismissOverlap(key)}>그대로 두기</button>
            <button type="button" className="primary-button small-toggle" disabled={isSaving} onClick={() => removeOverlapSlot(slot)}>신청 빼기</button>
          </div>
        </section>
      ))}

      {isSummaryCompact && (
        <section className="summary-strip" data-section="form">
          <span className="summary-strip-item"><em>리셋</em> <ResetCountdown isShort /></span>
          {nextRaidSlot ? (
            <button type="button" className="summary-strip-next" onClick={() => openSlotInDaySummary(nextRaidSlot)}>
              <em>다음</em> {nextRaidSlot.day} {formatTimeLabel(nextRaidSlot.time)} {nextRaidSlot.raidName} {nextRaidSlot.difficulty}
              {!isMobile && (
                <span className="summary-strip-detail">
                  {nextRaidSlot.mode} · {formatTimeUntil(nextRaidSlot.startTime - currentTime.getTime())} · {nextRaidSlot.headcountText}
                  {nextRaidSlot.partyLabel && ` · ${nextRaidSlot.partyLabel}`}
                  {nextRaidSlot.nickname !== loggedInNickname && ` · ${nextRaidSlot.nickname}`}
                  {laterRaidSlots.length > 0 && ` · 이후 ${laterRaidSlots[0].day} ${formatTimeLabel(laterRaidSlots[0].time)} ${laterRaidSlots[0].raidName} ${laterRaidSlots[0].difficulty}${laterRaidSlots.length > 1 ? ` 외 ${laterRaidSlots.length - 1}건` : ''}`}
                </span>
              )}
            </button>
          ) : !isMobile && (
            <span className="summary-strip-item">{getEmptyText('이번 주 남은 신청이 없어요. 왼쪽에서 가능한 시간을 골라 주세요.')}</span>
          )}
        </section>
      )}

      {!isSummaryCompact && (
      <section className="summary-grid">
        <article className="summary-card accent" data-section="form">
          <span className="label">다음 리셋</span>
          <ResetCountdown />
        </article>

        <article className={`summary-card next-raid-card ${nextRaidNeedsMe ? 'needs-action' : ''} ${!nextRaidSlot && dataLoadState === 'ready' ? 'is-empty' : ''}`}>
          <span className="label">{nextRaidNeedsMe ? '준비 확인 요청이 왔어요' : '내 다음 레이드'}</span>
          {nextRaidSlot ? (
            <>
              <strong>
                {nextRaidSlot.day}요일 {formatTimeLabel(nextRaidSlot.time)} · {nextRaidSlot.raidName} {nextRaidSlot.difficulty} {nextRaidSlot.mode}
              </strong>
              <small>
                {formatTimeUntil(nextRaidSlot.startTime - currentTime.getTime())}
                {` · ${nextRaidSlot.headcountText} · 리딩 ${nextRaidSlot.leaderCount}명`}
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
                  <>
                    <span className="next-raid-status is-yes">
                      {getDepartLabel(nextRaidSlot.checkedCount, nextRaidSlot.departedCount, nextRaidSlot.voterNicknames.length)}
                    </span>
                    {/* 에라쿠스는 여러 번 눌러야 해서 맨 위 카드에서 바로 누를 수 있게 한다. */}
                    {getRaidWeeklyLimit(nextRaidSlot.raidName) > 0 && (
                      <>
                        {renderClearCounter({
                          run: nextRaidSlot.run,
                          record: nextRaidSlot.runRecord,
                          canEdit: savingRunKey !== nextRaidSlot.runKey,
                          labelPrefix: '내 다음 레이드 ',
                          isLarge: true,
                        })}
                        <span className="next-raid-left">
                          내 남은 횟수 {renderEntriesLeft(nextRaidSlot.raidName, nextRaidSlot.nickname)}
                        </span>
                      </>
                    )}
                  </>
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
      )}

      <main className="content-grid">
        <section className="panel form-panel" data-section="form">
          <div className="panel-header">
            <h2>내 레이드 신청</h2>
            <button
              type="button"
              className="help-toggle"
              onClick={() => (isMobile ? setGuideOpen(true) : setHelpOpen((prev) => !prev))}
              aria-label="사용 방법 보기"
              aria-expanded={helpOpen}
            >
              ?
            </button>
          </div>

          {helpOpen && (
            <div className="help-panel">
              <p>1. '내 캐릭터'에서 직업 · 전투력 · 리딩 여부를 정해요. 캐릭터마다 한 번 정해 두면 계속 쓰여요.</p>
              <p>2. 신청할 레이드 · 난이도 · 공략 방식을 골라요. 요일 · 시간은 레이드 조합마다 따로 저장되고, 같은 시간에 다른 레이드도 함께 신청할 수 있어요.</p>
              <p>3. 시간표에서 가능한 칸을 누르거나 끌어서 골라요. 요일 · 시간 머리를 누르면 그 줄 전체가 골라져요. 24:00은 그 요일 밤 12시예요.</p>
              <p>4. 저장하면 주간 캘린더와 요일별 현황에 바로 반영돼요. 직업 · 전투력 · 리딩을 바꿨으면 저장할 때 이 캐릭터의 다른 신청에도 함께 반영돼요.</p>
              <p>5. 못 가는 시간은 시간표에서 빼고 저장해요. 시간을 모두 빼면 저장 버튼이 '신청 삭제'로 바뀌어요.</p>
              <p>6. 현황을 보다가 '나도 참여'를 누르면 그 시간대에 바로 신청돼요. 시간대마다 먼저 신청한 10명(초월 레이드는 5명)이 1공대(초월은 1파티), 그다음 10명(5명)이 2공대(2파티)이고, 그보다 늦으면 대기예요. 준비 확인과 클리어는 공대(파티)마다 따로 해요. 시간을 다시 저장해도 순서는 그대로예요.</p>
              <p>7. 에라쿠스 유적은 출발한 뒤 클리어할 때마다 '+1 클리어'를 눌러요. 준비 완료를 누른 사람이 1회씩 차감되고, 누군가 5회를 다 쓰는 클리어만 디스코드로 알려요. 클리어한 사람은 '이번 주 클리어'에서 볼 수 있어요.</p>
              <p>8. 수요일 리셋 뒤에는 '지난 신청 불러오기'로 지난 신청을 골라 다시 등록할 수 있어요. 다시 등록한 뒤 지운 신청도 다시 불러올 수 있어요.</p>
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
            {renderStepTitle(1, isCharacterInfoComplete, '내 캐릭터')}

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
            {/* 모바일은 고칠 수 없는 닉네임 칸을 빼서 입력할 것만 보이게 한다. (부캐가 있으면 캐릭터를 골라야 하니 둔다) */}
            {(!isMobile || myAltNicknames.length > 0) && (
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
            )}

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
                {/* 직접 입력한다. 알아볼 수 있는 값이면 "950k" · "1250M" 형식으로 바꿔 두고, 칸을 벗어나면 그 형식으로 보여준다. */}
                <input
                  id="power"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="예: 950, 1250"
                  value={powerDraft ?? profile.power}
                  aria-invalid={powerError}
                  onChange={(event) => {
                    setPowerDraft(event.target.value)
                    setPowerError(false)
                    updateCharacterField('power', parsePowerInput(event.target.value) ?? '')
                  }}
                  onBlur={() => {
                    // 잘못 쓴 값은 지우지 않고 남겨 두어 고칠 수 있게 한다.
                    if (powerDraft !== null && powerDraft.trim() !== '' && !parsePowerInput(powerDraft)) {
                      setPowerError(true)
                    } else {
                      setPowerDraft(null)
                    }
                  }}
                />
                {powerError && (
                  <p className="field-hint field-error">{POWER_MIN_K} ~ {POWER_MAX_K} 사이 숫자로 입력해 주세요. (예: 950, 1250)</p>
                )}
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
            {renderStepTitle(2, isScheduleTargetSelected, '신청할 레이드')}

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

            {isMobile && isScheduleTargetSelected && !targetEditOpen ? (
              <div className="target-summary">
                <strong>{selectedRaidLabel} · {profile.difficulty} · {profile.mode}</strong>
                {renderEntriesLeft(selectedRaidLabel, currentNickname)}
                <button type="button" className="secondary-button small-toggle" onClick={() => setTargetEditOpen(true)}>
                  변경
                </button>
              </div>
            ) : (
            <>
            <div className={`field-group ${showTargetWarning && !selectedRaidLabel ? 'is-missing' : ''}`}>
              <label>레이드</label>
              <div className="chip-grid segmented raid-chip-grid" role="group" aria-label="레이드">
                {raidOptions.map((raid) => (
                  <button
                    key={raid.id}
                    type="button"
                    className={selectedRaidLabel === raid.label ? 'chip active' : 'chip'}
                    aria-pressed={selectedRaidLabel === raid.label}
                    onClick={() => setProfile((prev) => ({
                      ...prev,
                      raidFocus: raid.id,
                      // 성역(보통 · 어려움) ↔ 초월(1~3단계)처럼 난이도 종류가 바뀌면 다시 고르게 비운다.
                      difficulty: raid.difficulties.includes(prev.difficulty) ? prev.difficulty : '',
                    }))}
                  >
                    {raid.tag ? <span className="raid-chip-label">{raid.label}<br /><small>{raid.tag}</small></span> : raid.label}
                  </button>
                ))}
                {upcomingRaids.map((raid) => (
                  <button
                    key={raid.id}
                    type="button"
                    className="chip upcoming"
                    aria-haspopup="dialog"
                    onClick={() => notifyUpcomingRaid(raid)}
                  >
                    <span className="upcoming-label">{raid.label}<br />{raid.tag}</span>
                    <small className="upcoming-date">{raid.openDate} 오픈 예정</small>
                  </button>
                ))}
              </div>

              {/* 횟수 제한 레이드(에라쿠스 주 5회): 이 캐릭터의 남은 횟수와 직접 조정 */}
              {currentEntryUsage && currentNickname && (
                <div className={`entries-left-panel${currentEntryUsage.left === 0 ? ' is-empty' : ''}`}>
                  <div className="entries-left-text">
                    <span>
                      이번 주 남은 횟수 <strong>{currentEntryUsage.left}/{currentEntryUsage.limit}</strong>
                    </span>
                    {/* 좁은 화면에서 항목 중간이 아니라 항목 사이에서 줄이 바뀌게 묶는다. */}
                    <small className="entries-left-detail">
                      <span>클리어 차감 {currentEntryUsage.cleared}회</span>
                      {currentEntryUsage.adjustment > 0 && <span>직접 차감 {currentEntryUsage.adjustment}회</span>}
                      {currentEntryUsage.adjustment < 0 && <span>직접 복구 {-currentEntryUsage.adjustment}회</span>}
                      <span>1~3단계 합산</span>
                    </small>
                    {currentEntryUsage.left === 0 && <small className="entries-left-warn">횟수를 다 써서 새 시간은 신청할 수 없어요.</small>}
                  </div>
                  {/* 버튼은 화면에 보이는 '남은 횟수' 기준이다. −1은 쓴 횟수 +1, +1은 쓴 횟수 −1로 저장한다. */}
                  <div className="entries-adjust" role="group" aria-label="남은 횟수 직접 조정">
                    <button
                      type="button"
                      className="secondary-button small-toggle"
                      aria-label="남은 횟수 1회 줄이기"
                      title="레기온 밖에서 돌았으면 남은 횟수를 줄여요"
                      disabled={isAdjustingEntries || currentEntryUsage.left <= 0}
                      onClick={() => adjustEntryCount(1)}
                    >
                      −1
                    </button>
                    <button
                      type="button"
                      className="secondary-button small-toggle"
                      aria-label="남은 횟수 1회 늘리기"
                      title="클리어로 차감됐지만 실제로 안 들어갔으면 되돌려요"
                      disabled={isAdjustingEntries || currentEntryUsage.used <= 0}
                      onClick={() => adjustEntryCount(-1)}
                    >
                      +1
                    </button>
                  </div>
                  <small className="entries-adjust-hint">레기온 밖에서 돌았으면 −1, 잘못 차감됐으면 +1</small>
                </div>
              )}
            </div>

            {/* 난이도가 3개 이상(초월 1~3단계)이면 난이도를 한 줄 전체로 쓰고 공략 방식은 아래로 내린다. */}
            <div className={`two-column${getRaidDifficulties(selectedRaidLabel).length > 2 ? ' is-stacked' : ''}`}>
              <div className={`field-group ${showTargetWarning && !profile.difficulty ? 'is-missing' : ''}`}>
                <label>난이도</label>
                <div className="chip-grid segmented" role="group" aria-label="난이도">
                  {getRaidDifficulties(selectedRaidLabel).map((difficulty) => (
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

            {isMobile && isScheduleTargetSelected && (
              <button type="button" className="text-link-button character-collapse-button" onClick={() => setTargetEditOpen(false)}>
                한 줄로 접기
              </button>
            )}
            </>
            )}

          </div>

          <div className="form-section" id="schedule-day-field">
            <div className="field-label-row">
              {renderStepTitle(3, currentSelectedDays.length > 0, '요일 · 시간')}
              {/* 주말 · 공휴일 낮시간(12~16시)은 켰을 때만 시간표에 줄이 생긴다. */}
              {(!isMobile || isWeekendOrHolidayDate(weekDates[mobileCalendarDayIndex])) && (
                <button
                  type="button"
                  className="secondary-button small-toggle"
                  onClick={() => setShowDaytimeSlots((prev) => !prev)}
                  aria-pressed={showDaytimeSlots}
                >
                  {showDaytimeSlots ? '낮시간 숨기기' : isMobile ? '낮시간 보기' : '주말 · 공휴일 낮시간 보기'}
                </button>
              )}
            </div>
            <p className="field-hint">
              {!isScheduleTargetSelected
                ? '레이드, 난이도, 공략 방식을 먼저 선택해 주세요.'
                : isMobile
                  ? '갈 수 있는 시간을 모두 눌러요. (24:00 = 밤 12시)'
                  : '칸을 누르거나 끌어서 골라요. (24:00 = 밤 12시)'}
            </p>
            {isMobile ? renderMobileTimePicker() : (
            <>
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
                      // 다른 캐릭터가 같은 레이드로 신청한 시간. 이미 골라 둔 시간이면 뺄 수 있게 눌리도록 둔다.
                      const takenBy = takenSlots.get(`${day}|${time}`)
                      // 다른 레이드로 신청한 시간. 막지 않고 점으로 표시만 한다.
                      const otherRaids = otherRaidSlots.get(`${day}|${time}`)
                      // 막힌 칸도 눌리게 두어(disabled 대신 aria-disabled), 누르면 이유를 알림으로 띄운다.
                      const blockReason = getSlotBlockReason(day, time, isSelected)

                      return (
                        <button
                          key={`${day}-${time}`}
                          type="button"
                          className={`time-pick-cell${isSelected ? ' is-selected' : ''}${takenBy ? ' is-taken' : ''}${otherRaids ? ' has-other-raid' : ''}${isPastSlot(day, time) ? ' is-past' : ''}${blockReason ? ' is-blocked' : ''}`}
                          aria-pressed={isSelected}
                          aria-label={`${day}요일 ${formatTimeLabel(time)}`}
                          aria-disabled={Boolean(blockReason)}
                          aria-description={otherRaids ? describeOtherRaids(otherRaids) : undefined}
                          title={blockReason || `${day}요일 ${formatTimeLabel(time)}${otherRaids ? `\n${describeOtherRaids(otherRaids)}` : ''}`}
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
                <span><i className="time-pick-legend-swatch is-taken" aria-hidden="true" />다른 캐릭터로 신청함</span>
              )}
              {otherRaidSlots.size > 0 && (
                <span><i className="other-raid-dot" aria-hidden="true" />다른 레이드도 신청함 (함께 신청 가능)</span>
              )}
              <span><i className="time-pick-legend-swatch is-past" aria-hidden="true" />지난 시간</span>
              <span><i className="time-pick-legend-swatch is-unavailable" aria-hidden="true" />없는 시간</span>
            </div>
            </>
            )}
          </div>

          {/* 저장하지 않은 변경이 있으면 저장 영역을 화면 아래에 붙여, 스크롤해도 저장 버튼을 놓치지 않게 한다. */}
          <div className={`save-bar${hasUnsavedChanges ? ' is-pending' : ''}`}>
            {/* 저장 버튼은 지금 폼의 레이드 조합만 저장하므로, 저장 안 된 다른 조합이 있으면 함께 알려 준다. */}
            {hasUnsavedChanges && (
              <div className="unsaved-notice" role="status">
                <div className="unsaved-notice-text">
                  <strong>저장하지 않은 변경이 있어요</strong>
                  {/* 지금 고치는 조합 하나뿐이면 이름을 줄여 저장 바가 시간표를 덜 가리게 한다. */}
                  {(unsavedScheduleKeys.length > 1 || unsavedScheduleKeys[0] !== currentScheduleKey) && (
                    <span>{unsavedScheduleKeys.map(formatScheduleKey).join(' / ')}</span>
                  )}
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
              <button type="button" className="primary-button" onClick={handleSaveClick} disabled={isSaving || isCurrentScheduleSaved}>
                {isSaving
                  ? '저장 중…'
                  : isClearingSavedSchedule
                    ? '이 신청 삭제'
                    : isCurrentScheduleSaved
                      ? '✓ 저장됨'
                      : isMobile
                        ? getDayTimePairs(currentDayTimeSelection).length > 0
                          ? `시간 ${getDayTimePairs(currentDayTimeSelection).length}개 저장하기`
                          : '시간을 고르면 저장할 수 있어요'
                        : '캘린더에 저장'}
              </button>
            </div>
          </div>

          <div className="selected-summary saved-schedule-list">
            <div className="saved-schedule-head">
              <h3>내 신청 목록</h3>
              {mySavedSchedules.length > 0 && <span className="saved-schedule-count">{mySavedSchedules.length}건</span>}
            </div>
            {mySavedSchedules.length > 0 ? (
              <>
                <p className="saved-schedule-hint">
                  {isMobile
                    ? "시간을 고치려면 '수정'을 눌러 주세요."
                    : '시간을 누르면 그 시간만, 요일을 누르면 그 요일 전체를 지울 수 있어요.'}
                </p>
                <ul>
                  {mySavedSchedules.map((entry) => {
                    const entryKey = getScheduleKey(entry)
                    const isEditing = entryKey === currentScheduleKey
                    const isUnsaved = unsavedScheduleKeys.includes(entryKey)

                    return (
                      <li
                        key={entryKey}
                        className={`saved-schedule-item raid-${raidOptions.find((raid) => raid.label === entry.raidName)?.id ?? 'muspel'}${entry.attendance !== '참' ? ' is-absent' : ''}${isEditing ? ' is-editing' : ''}`}
                      >
                        <div className="saved-schedule-top">
                          <div className="saved-schedule-title">
                            <strong>{entry.raidName}</strong>
                            <span className={`saved-schedule-tag ${entry.difficulty === '어려움' ? 'tag-hard' : 'tag-normal'}`}>{entry.difficulty}</span>
                            <span className="saved-schedule-tag">{entry.mode}</span>
                            {entry.attendance !== '참' && <span className="saved-schedule-tag tag-absent">불참</span>}
                            {isUnsaved && <span className="saved-schedule-tag tag-unsaved">저장 안 됨</span>}
                            {getEntriesLeft(entry.raidName, entry.nickname) === 0 && <span className="saved-schedule-tag tag-exhausted">횟수 소진</span>}
                          </div>
                          <div className="saved-schedule-actions">
                            <button
                              type="button"
                              className="saved-schedule-edit"
                              onClick={() => editSavedSchedule(entry)}
                              disabled={isEditing && !isMobile}
                              aria-label={`${entry.raidName} ${entry.difficulty} ${entry.mode} 신청 수정`}
                            >
                              {isEditing ? '수정 중' : '수정'}
                            </button>
                            <button
                              type="button"
                              className="saved-schedule-delete"
                              onClick={() => deleteWithUndo(entry)}
                              aria-label={`${entry.raidName} ${entry.difficulty} ${entry.mode} 신청 삭제`}
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
                                {/* 모바일은 스크롤하다 잘못 눌러 지워지지 않도록 보기 전용으로 두고, '수정'에서 고치게 한다. */}
                                {isMobile ? (
                                  <span className={`saved-slot-day-tag${day === '토' ? ' is-sat' : ''}${day === '일' ? ' is-sun' : ''}`}>{day}</span>
                                ) : (
                                <button
                                  type="button"
                                  className={`saved-slot-day-label${day === '토' ? ' is-sat' : ''}${day === '일' ? ' is-sun' : ''}`}
                                  onClick={() => deleteWithUndo({ entry, day, time: null })}
                                  title={`${day}요일 시간 전체 삭제`}
                                  aria-label={`${day}요일 시간 전체 삭제`}
                                >
                                  {day}
                                </button>
                                )}
                                <div className="saved-slot-times">
                                  {[...entry.dayTimeSelection[day]]
                                    .sort((a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b))
                                    .map((time) => (isMobile ? (
                                      <span key={time} className="saved-slot-tag">{formatTimeLabel(time)}</span>
                                    ) : (
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
                                    )))}
                                </div>
                              </div>
                            ))}
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <button type="button" className="secondary-button saved-schedule-clear" onClick={() => setClearAllConfirmOpen(true)}>
                  내 신청 전체 삭제
                </button>
              </>
            ) : (
              <p className="saved-schedule-empty">아직 신청이 없어요.</p>
            )}
          </div>
        </section>

        <section className="panel calendar-panel">
          {/* PC: 오른쪽 영역을 탭으로 나눠 한 번에 하나만 보여 준다. (모바일은 하단 탭) */}
          {!isMobile && (
            <div className="pc-tabs" role="tablist" aria-label="보기 선택">
              {[['day', '이번 주'], ['calendar', '파티'], ['clear', '클리어'], ['members', '인원']].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={pcTab === id}
                  className={`pc-tab ${pcTab === id ? 'active' : ''}`}
                  onClick={() => setPcTab(id)}
                >
                  {label}
                  {id === 'clear' && weeklyClears.length > 0 && <span className="members-view-count">{weeklyClears.length}</span>}
                </button>
              ))}
            </div>
          )}

          <div className="panel-header" data-section="calendar" data-pc="calendar">
            <div className="panel-header-title-wrap">
              <h2>주간 레이드 파티</h2>
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
              {(!isMobile || isWeekendOrHolidayDate(weekDates[mobileCalendarDayIndex])) && (
                <button
                  type="button"
                  className="secondary-button small-toggle"
                  onClick={() => setShowDaytimeSlots((prev) => !prev)}
                  title={showDaytimeSlots ? '주말/공휴일 낮시간을 숨깁니다.' : '주말/공휴일 낮시간을 보여줍니다.'}
                >
                  낮시간 설정
                </button>
              )}
              <span className="legend-item"><span className="legend-badge lead-yes"><LeadMark value="O" /></span> 리딩 가능</span>
              <span className="legend-item"><span className="legend-badge lead-no"><LeadMark value="X" /></span> 리딩 불가</span>
            </div>
          </div>

          {/* 모든 레이드 조합에서 아직 안 지난 시간 중 모이기 좋은 시간 TOP 3. 누르면 그 탭 · 그 칸으로 간다. */}
          <div className="recommend-row" data-section="calendar" data-pc="day">
            {isMobile && recommendedSlots.length > 0 ? (
              <button
                type="button"
                className="recommend-toggle"
                aria-expanded={recommendOpen}
                onClick={() => setRecommendOpen((prev) => !prev)}
              >
                <span className="recommend-label">추천 시간</span>
                <span className="recommend-toggle-preview">
                  {recommendedSlots[0].day} {formatTimeLabel(recommendedSlots[0].time)} · {getRecommendStatus(recommendedSlots[0])}
                </span>
                <span className="recommend-toggle-arrow">{recommendOpen ? '접기 ▴' : `${recommendedSlots.length}곳 보기 ▾`}</span>
              </button>
            ) : (
              <span className="recommend-label">추천 레이드 시간 TOP 3</span>
            )}
            {isMobile && !recommendOpen && recommendedSlots.length > 0 ? null : recommendedSlots.length > 0 ? (
              <div className="recommend-list">
                {recommendedSlots.map((slot, index) => {
                  const isConfirmed = isConfirmedSlot(slot)

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
                          {getRecommendStatus(slot)}
                        </span>
                        <span className="recommend-meta">
                          {formatHeadcount(slot.people.length, getRaidFullSize(slot.raidName))} · {slot.leaderCount > 0 ? `리딩 ${slot.leaderCount}` : '리더 없음'}
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
            <div className="help-panel compact" data-section="calendar" data-pc="calendar">
              <p>• 탭을 누르면 레이드 · 난이도 · 공략 방식을 바꿀 수 있어요.</p>
              <p>• 각 시간칸은 해당 조건의 인원이 저장한 시간대를 보여줘요. 먼저 신청한 10명(초월 레이드는 5명)이 1공대(1파티)이고, 넘는 인원은 신청 순서대로 2공대(2파티)로 따로 보여요. 2공대까지 차면 그 뒤는 대기로 표시돼요. 그 시간에 리딩 가능으로 신청했다면 칸의 '배치'를 눌러 사람을 끌어(모바일은 눌러서) 공대 · A/B · 대기를 옮길 수 있고, 모두에게 같은 배치로 보여요. A/B 파티는 리딩 가능자와 치유성을 양쪽에 나누고 전투력이 비슷하도록 자동으로 나눠요.</p>
              <p>• 추천 레이드 시간은 모든 레이드에서 아직 안 지난 시간 중 정원이 차고 리더가 있는 '출발 가능' 시간을 먼저, 그다음 인원이 많은 순서로 보여 줘요. 누르면 그 레이드 탭과 칸으로 이동해요.</p>
              <p>• 한 타임에 한 포스, 한 파티당 5명씩 총 10명이 기준이며(초월 레이드는 5명 1파티), O는 리딩 가능, X는 리딩 불가를 뜻해요.</p>
              <p>• 요일별 신청 현황에서는 해당 요일에 어떤 레이드와 시간대가 신청됐는지 한눈에 확인할 수 있어요.</p>
            </div>
          )}

          <div className="day-raid-summary-panel" data-section="day" data-pc="day">
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
              {pastDayNames.length > 0 && !isMobile && (
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
            {renderMobileDayTabs('day', (day) => dayRaidSummary.find((item) => item.day === day)?.raidGroups.length > 0)}
            <div className="day-raid-summary-grid" data-mobile-day={isMobile ? mobileCalendarDayIndex : undefined}>
              {visibleDayRaidSummary.map(({ day, raidGroups }, dayIndex) => {
                // weekdayNames와 weekDates는 둘 다 수요일부터 시작한다.
                const isPastCard = weekDates[dayIndex].getTime() < activeDayStartTime
                // 모바일은 요일 탭으로 하루씩 보므로 접지 않는다.
                const isCardCollapsed = isPastCard && !expandedPastDays[day] && !isMobile
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
                <div key={day} data-day-index={dayIndex} className={`day-raid-card ${isPastCard ? 'is-past' : ''} ${isCardCollapsed ? 'is-collapsed' : ''} ${raidGroups.length === 0 ? 'is-empty-day' : ''} ${isTodayCard ? 'is-today' : ''}`}>
                  {isPastCard && !isMobile ? (
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
                            {renderEntriesLeft(raidName, member.nickname)}
                            <MemberTooltip member={member} ownerNickname={altOwnerByNickname.get(member.nickname)} showLead />
                          </span>
                        )

                        return (
                        <div key={groupKey} className="day-raid-bundle">
                          <strong>{raidName} <span className="day-raid-bundle-sub">{difficulty} · {mode}</span></strong>
                          {times.length > 0 ? (
                            // 시간대마다 한 줄: [시간 · 인원 수 · 직업 아이콘 · 참여(+)]. 누르면 인원 목록과 나머지 버튼이 펼쳐진다.
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
                                // 신청 순서로 정렬된 이 시간대 인원. 앞의 정원(10명, 초월 5명)이 1공대(초월은 1파티),
                                // 그다음 정원만큼이 2공대(2파티), 나머지는 대기다. 리딩 가능자가 직접 옮겼으면 그 배치를 따른다.
                                // 준비 확인 · 클리어는 파티마다 따로 한다.
                                const slotFullSize = getRaidFullSize(raidName)
                                const slotPeople = memberByRaidDateTime.get(`${day}-${time}`)?.[`${raidName} ${difficulty} ${mode}`] ?? []
                                const slotRun = { weekStart: weekStartKey, day, time, raidName, difficulty, mode }
                                const slotArrangement = getSlotArrangement(slotRun)
                                const { groups: partyGroups, waiting: waitingPeople } = slotArrangement
                                const hasMultipleParties = partyGroups.length > 1
                                // 이 시간대에 투표한 사람만 표시할 수 있다. (DB 함수도 같은 규칙으로 막는다)
                                // 부캐로 투표했으면 그 부캐로 표시한다. (같은 레이드 · 같은 시간은 한 캐릭터만 신청할 수 있어 많아야 하나)
                                const mySlotNickname = timeVoters.find((member) => myCharacters.includes(member.nickname))?.nickname ?? ''
                                const isSlotVoter = Boolean(mySlotNickname)
                                // 내가 든 파티 번호 (대기면 0, 신청하지 않았으면 null)
                                const myParty = isSlotVoter ? slotArrangement.partyOf.get(mySlotNickname) ?? null : null
                                const editDisabledReason = !loggedInNickname
                                  ? '로그인한 뒤에 표시할 수 있어요.'
                                  : !isSlotVoter ? describeAuthResult('not_participant') : ''
                                // 에라쿠스처럼 주간 횟수가 있는 레이드는 클리어를 O/X 대신 횟수로 센다.
                                const hasWeeklyLimit = getRaidWeeklyLimit(raidName) > 0
                                const isFullSlot = timeVoters.length >= slotFullSize
                                // 시작 1시간 전부터 준비 확인을 시작할 수 있다. (지난 시간은 기록용으로 그대로 둔다)
                                const canCallRally = getSlotStartDate(weekDates, day, time).getTime() - currentTime.getTime() <= RALLY_OPEN_BEFORE_MS
                                const hasLeader = timeVoters.some((member) => member.leadReady === 'O')
                                // 어제까지의 요일인데 준비 호출이 없으면 점선으로 흐리게 보여 준다. (DB에는 저장하지 않음)
                                const isPastDay = weekDates[dayIndex].getTime() < activeDayStartTime
                                const slotNicknames = [...new Set(slotPeople.map((member) => member.nickname))]
                                // 파티마다 준비 확인 · 클리어 기록 (2파티는 정원을 넘었을 때만 있다)
                                const partyStates = partyGroups.map(({ party, members: partyMembers }) => {
                                  const run = { ...slotRun, party }
                                  const runKey = getRaidRunKey(run)
                                  const runRecord = raidRunByKey.get(runKey)
                                  const rosterNicknames = [...new Set(partyMembers.map((member) => member.nickname))]
                                  const rallyCheckins = runRecord?.rallyCheckins ?? []
                                  // 내 파티이거나, 내가 대기이거나, 이 파티로 출발 인원에 들어갔으면 이 파티 기록을 다룰 수 있다.
                                  const canManage = isSlotVoter && (myParty === party || myParty === 0 || rallyCheckins.includes(mySlotNickname))

                                  return {
                                    party,
                                    run,
                                    runKey,
                                    runRecord,
                                    partyMembers,
                                    rosterNicknames,
                                    rallyCheckins,
                                    label: hasMultipleParties ? getPartyGroupLabel(raidName, party) : '',
                                    isMine: myParty === party,
                                    canManage,
                                    canEdit: Boolean(loggedInNickname) && canManage && savingRunKey !== runKey,
                                    disabledReason: editDisabledReason || (isSlotVoter && !canManage ? describeAuthResult('other_party') : ''),
                                    isRallyCalled: Boolean(runRecord?.rallyCalledAt),
                                    isGathered: Boolean(runRecord?.gatheredAt),
                                    checkedCount: rosterNicknames.filter((name) => rallyCheckins.includes(name)).length,
                                    waitingNicknames: rosterNicknames.filter((name) => !rallyCheckins.includes(name)),
                                    isMeChecked: rallyCheckins.includes(mySlotNickname),
                                    // 실제로 출발한 사람 (다른 파티 · 대기자를 대신 골랐으면 그 사람도)
                                    departedNicknames: slotNicknames.filter((name) => rallyCheckins.includes(name)),
                                  }
                                })
                                const isAnyRallyCalled = partyStates.some((ps) => ps.isRallyCalled)
                                const isAnyCleared = partyStates.some((ps) => Boolean(ps.runRecord?.cleared))
                                const renderRally = (ps) => {
                                  const { run, runRecord, rosterNicknames, isRallyCalled, isGathered, checkedCount, waitingNicknames, isMeChecked, departedNicknames } = ps

                                  if (!isRallyCalled && !canCallRally) {
                                    return ps.party === 1 ? <span className="day-raid-rally-hint">시작 1시간 전부터 준비 확인</span> : null
                                  }

                                  if (!isRallyCalled) {
                                    // 다른 파티 사람에게는 이 파티의 준비 확인 버튼을 보여 주지 않는다.
                                    if (isSlotVoter && !ps.canManage) {
                                      return null
                                    }

                                    return (
                                      <span
                                        className={`day-raid-run-status day-raid-rally ${isPastDay ? 'is-auto' : ''}`}
                                        title={ps.disabledReason || (isPastDay ? '준비 확인 없이 지난 요일이에요.' : `누르면 이 시간대${ps.label ? ` ${ps.label}` : ''} 인원에게 준비 확인을 보내요.`)}
                                      >
                                        <button
                                          type="button"
                                          className="day-raid-rally-button"
                                          disabled={!ps.canEdit}
                                          onClick={() => handleRallyClick(run, 'call', rosterNicknames)}
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
                                        ? `출발: ${departedNicknames.join(', ') || '없음'} · 확인 시작 ${runRecord.rallyCalledBy ?? '-'}`
                                        : `확인 시작 ${runRecord.rallyCalledBy ?? '-'} · 기다리는 중: ${waitingNicknames.join(', ') || '없음'}`}
                                    >
                                      <span className="day-raid-run-label">
                                        {isGathered
                                          ? getDepartLabel(checkedCount, departedNicknames.length, rosterNicknames.length)
                                          : `준비 ${checkedCount}/${rosterNicknames.length}`}
                                      </span>
                                      {/* 횟수 제한 레이드는 준비 완료를 누른 사람만 차감되므로, 시작한 뒤에 온 사람도 누를 수 있게 한다. */}
                                      {(!isGathered || (hasWeeklyLimit && !isMeChecked)) && ps.isMine && (
                                        <button
                                          type="button"
                                          className={`day-raid-rally-button ${isMeChecked ? 'active' : ''}`}
                                          aria-pressed={isMeChecked}
                                          disabled={!ps.canEdit}
                                          onClick={() => handleRallyClick(run, isMeChecked ? 'uncheck' : 'check', rosterNicknames)}
                                        >
                                          {isMeChecked ? '준비 취소' : '✓ 준비 완료'}
                                        </button>
                                      )}
                                      {/* 안 오는 사람이 있어도 클리어 표시까지 막히지 않게 한다. */}
                                      {/* 미준비 인원이 신청을 지워 전원이 준비됐는데 전원 준비로 안 넘어간 경우에도 여기서 넘어갈 수 있다. */}
                                      {!isGathered && ps.isMine && checkedCount > 0 && (
                                        <button
                                          type="button"
                                          className="day-raid-rally-button"
                                          title="아직 준비하지 않은 사람을 기다리지 않고 전원 준비로 넘어가요."
                                          disabled={!ps.canEdit}
                                          onClick={() => handleRallyClick(run, 'start', rosterNicknames)}
                                        >
                                          ▶ 이 인원으로 시작
                                        </button>
                                      )}
                                      {isGathered && ps.canManage && (
                                        <button
                                          type="button"
                                          className="day-raid-rally-button"
                                          title="실제로 출발한 사람을 고쳐요."
                                          disabled={!ps.canEdit}
                                          onClick={() => handleRallyClick(run, 'members', rosterNicknames)}
                                        >
                                          출발 인원
                                        </button>
                                      )}
                                      {/* 인원이 늘었을 때 디스코드로 한 번 더 알린다. (파티마다 준비 확인 알림 최대 2번) */}
                                      {supabase && !isGathered && (runRecord.rallyNotifyCount ?? 0) < 2 && (!isSlotVoter || ps.canManage) && (
                                        <button
                                          type="button"
                                          className="day-raid-rally-button"
                                          title={ps.disabledReason || '디스코드로 준비 확인을 한 번 더 보내요.'}
                                          disabled={!ps.canEdit}
                                          onClick={() => handleRallyClick(run, 'remind', rosterNicknames)}
                                        >
                                          📣 다시 알림
                                        </button>
                                      )}
                                      {(!isSlotVoter || ps.canManage) && (
                                        <button
                                          type="button"
                                          className={isMobile ? 'day-raid-rally-button' : 'day-raid-run-button'}
                                          aria-label={`${formatTimeLabel(time)}${ps.label ? ` ${ps.label}` : ''} 준비 확인 취소`}
                                          title={ps.disabledReason || '준비 확인 취소'}
                                          disabled={!ps.canEdit}
                                          onClick={() => handleRallyClick(run, 'cancel', rosterNicknames)}
                                        >
                                          {isMobile ? '확인 취소' : '×'}
                                        </button>
                                      )}
                                    </span>
                                  )
                                }
                                const renderRunStatus = (ps, field, fieldLabel) => {
                                  const value = ps.runRecord?.[field] ?? null
                                  const changedBy = ps.runRecord?.clearedBy
                                  const isLocked = !ps.isGathered
                                  const disabledReason = ps.disabledReason || (isLocked ? describeAuthResult('not_gathered') : '')

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
                                          aria-label={`${formatTimeLabel(time)}${ps.label ? ` ${ps.label}` : ''} ${fieldLabel} ${option}`}
                                          disabled={!ps.canEdit || isLocked}
                                          onClick={() => handleRunStatusClick(ps.run, field, option)}
                                        >
                                          <LeadMark value={option} />
                                        </button>
                                      ))}
                                    </span>
                                  )
                                }

                                // 접힌 줄에는 지금 할 일이 있을 때만 버튼을 보여 준다. (내 시간의 준비 확인 · 출발 · 클리어)
                                const isActionOpen = isExpanded
                                  || (isSlotVoter && (isAnyRallyCalled || isAnyCleared || (canCallRally && !isPastSlot(day, time))))
                                // 내 시간이 아닌 줄의 진행 상태는 짧은 글자로만 보여 준다. (2파티면 파티마다)
                                const getProgressText = (ps) => (
                                  ps.runRecord?.cleared === 'O' ? '클리어'
                                    : ps.runRecord?.cleared === 'X' ? '실패'
                                    : ps.isGathered ? '출발' : ps.isRallyCalled ? '준비 중' : ''
                                )
                                const progressText = isActionOpen ? ''
                                  : partyStates
                                    .map((ps) => [ps.label, getProgressText(ps)])
                                    .filter(([, text]) => text)
                                    .map(([label, text]) => (label ? `${label} ${text}` : text))
                                    .join(' · ')
                                const isProgressFailed = partyStates.every((ps) => ps.runRecord?.cleared === 'X' || !getProgressText(ps))
                                  && partyStates.some((ps) => ps.runRecord?.cleared === 'X')

                                return (
                                  <div key={rowKey} id={`day-raid-row-${rowKey}`} className={`day-raid-time-row ${isExpanded ? 'expanded' : ''} ${isSlotVoter ? 'is-mine' : ''}`}>
                                    <div className="day-raid-time-head">
                                    <button
                                      type="button"
                                      className="day-raid-time-toggle"
                                      aria-expanded={isExpanded}
                                      title={isExpanded ? '접기' : `${formatTimeLabel(time)} 인원 펼치기`}
                                      onClick={() => setExpandedSummaryRows((prev) => ({ ...prev, [rowKey]: !prev[rowKey] }))}
                                    >
                                      <span className={`day-raid-time-tag ${isFullSlot ? 'is-full' : ''}`}>
                                        {formatTimeLabel(time)}
                                        <span className="day-raid-time-count">{formatArrangementHeadcount(slotArrangement, slotFullSize)}</span>
                                      </span>
                                      {isSlotVoter && <span className="my-slot-badge">내 시간{hasMultipleParties && myParty ? ` · ${getPartyGroupLabel(raidName, myParty)}` : ''}</span>}
                                      {!hasLeader && <span className="slot-warn" title="리딩 가능한 사람이 없어요">리더 없음</span>}
                                      {progressText && <span className={`day-raid-progress ${isProgressFailed ? 'is-failed' : ''}`}>{progressText}</span>}
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
                                      <span className="day-raid-toggle-arrow" aria-hidden="true">
                                        {isExpanded ? '▴' : '▾'}
                                      </span>
                                    </button>
                                    {renderJoinButton(slotRun, slotPeople.length, 'is-compact')}
                                    </div>
                                    {/* 버튼은 내가 신청한 시간대에만 보인다. 남의 시간대는 이미 진행된 준비 · 클리어 기록만 보여 준다.
                                        클리어는 전원 준비가 끝나야 고를 수 있어서 그 전에는 숨긴다. 2파티면 파티마다 한 줄씩 보여 준다. */}
                                    {isActionOpen && (isSlotVoter || isAnyRallyCalled || isAnyCleared) && partyStates.map((ps) => {
                                      const rallyNode = (isSlotVoter || ps.isRallyCalled) ? renderRally(ps) : null
                                      const showClear = ps.isGathered || Boolean(ps.runRecord?.cleared)

                                      if (!rallyNode && !showClear) {
                                        return null
                                      }

                                      return (
                                        <Fragment key={ps.runKey}>
                                          <div className={`day-raid-run-row ${ps.label ? 'has-party' : ''}`}>
                                            {ps.label && <span className={`day-raid-party-tag ${ps.isMine ? 'is-mine' : ''}`}>{ps.label}</span>}
                                            {rallyNode}
                                            {showClear && (hasWeeklyLimit
                                              ? renderClearCounter({ run: ps.run, record: ps.runRecord, canEdit: ps.canEdit && ps.isGathered, disabledReason: ps.disabledReason || (ps.isGathered ? '' : describeAuthResult('not_gathered')), partyLabel: ps.label })
                                              : renderRunStatus(ps, 'cleared', '클리어'))}
                                          </div>
                                          {hasWeeklyLimit && (ps.isGathered || ps.runRecord?.cleared === 'O') && renderClearEntries(ps.run, ps.runRecord, ps.rosterNicknames, ps.departedNicknames)}
                                          {/* 호출 중에는 아직 체크하지 않은 인원을 펼치지 않아도 보이게 한다. (모바일은 마우스 올리기가 없음) */}
                                          {ps.isRallyCalled && !ps.isGathered && ps.waitingNicknames.length > 0 && (
                                            <div className="day-raid-rally-waiting">
                                              <span className="day-raid-rally-waiting-label">{ps.label ? `${ps.label} ` : ''}아직 {ps.waitingNicknames.length}명</span>
                                              {ps.waitingNicknames.map((name) => (
                                                <span
                                                  key={`${ps.runKey}-waiting-${name}`}
                                                  className={`day-raid-rally-waiting-name ${myCharacters.includes(name) ? 'is-me' : ''}`}
                                                >
                                                  {name}
                                                </span>
                                              ))}
                                            </div>
                                          )}
                                        </Fragment>
                                      )
                                    })}
                                    {isExpanded && (
                                      <div className="day-raid-members">
                                        {partyStates.map((ps) => (
                                          <Fragment key={`${rowKey}-party-${ps.party}`}>
                                            {ps.label && (
                                              <span className="day-raid-overflow-label day-raid-party-label">
                                                {ps.label} ({ps.partyMembers.length}/{slotFullSize})
                                              </span>
                                            )}
                                            {timeVoters.filter((member) => ps.rosterNicknames.includes(member.nickname)).map((member) => renderMember(
                                              member,
                                              `${rowKey}-p${ps.party}`,
                                              ps.isRallyCalled ? (ps.rallyCheckins.includes(member.nickname) ? 'checked' : 'waiting') : undefined,
                                            ))}
                                          </Fragment>
                                        ))}
                                        {waitingPeople.length > 0 && (
                                          <span className="day-raid-overflow-label">대기 (신청 순)</span>
                                        )}
                                        {waitingPeople.map((member) => renderMember(member, `${rowKey}-overflow`))}
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
                    <div className="empty-role">
                      {getEmptyText(showOnlyMine ? '내 신청 없음' : '신청 인원 없음')}
                      {isMobile && dataLoadState === 'ready' && <small className="mobile-empty-hint">초록 점이 있는 요일을 눌러 보세요.</small>}
                    </div>
                  )}
                </div>
                )
              })}
            </div>
          </div>

          {/* 이번 주 클리어한 사람: 횟수 제한 레이드는 사람별 진행, 그 아래에 시간대별 클리어 명단 */}
          {/* 모바일 인원 탭: 신청 인원과 클리어 목록을 나눠 본다. */}
          {isMobile && (
            <div className="members-view-tabs" data-section="members" role="tablist" aria-label="인원 목록 선택">
              {[['signup', '신청 인원'], ['clear', '이번 주 클리어']].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={membersView === id}
                  className={`members-view-tab ${membersView === id ? 'active' : ''}`}
                  onClick={() => setMembersView(id)}
                >
                  {label}
                  {id === 'clear' && weeklyClears.length > 0 && <span className="members-view-count">{weeklyClears.length}</span>}
                </button>
              ))}
            </div>
          )}

          {(!isMobile || membersView === 'clear') && (
          <div className="member-day-summary clear-summary" data-section="members" data-pc="clear">
            <div className="clear-summary-head">
              <h3>
                이번 주 클리어
                <small>{weekDates[0].getMonth() + 1}/{weekDates[0].getDate()} ~ {weekDates[6].getMonth() + 1}/{weekDates[6].getDate()}</small>
              </h3>
            </div>
            <div className="weekday-list">
              {raidOptions.filter((raid) => raid.weeklyLimit).map((raid) => {
                const people = [...weeklyEntryCounts.keys()]
                  .filter((key) => key.startsWith(`${raid.label}|`))
                  .map((key) => key.slice(raid.label.length + 1))
                  .map((nickname) => ({ nickname, ...getEntryUsage(raid.label, nickname) }))
                  .sort((a, b) => a.left - b.left || a.nickname.localeCompare(b.nickname))

                if (people.length === 0) {
                  return null
                }

                const doneCount = people.filter((person) => person.left === 0).length

                return (
                  <div key={raid.id} className="weekday-card clear-progress-card">
                    <span className="weekday-title">
                      {raid.label} · 이번 주 진행
                      <small>{raid.weeklyLimit}회 완료 {doneCount}명 · 진행 중 {people.length - doneCount}명</small>
                    </span>
                    <div className="member-tags">
                      {people.map((person) => renderClearPerson(
                        person.nickname,
                        <>
                          <span className="clear-person-count">클리어 {person.cleared}회</span>
                          {person.left === 0 ? <span className="clear-done-badge">완료</span> : renderEntriesLeft(raid.label, person.nickname)}
                        </>,
                        person.left === 0,
                      ))}
                    </div>
                  </div>
                )
              })}
              {weeklyClears.map(({ run, count, people }) => (
                <div key={getRaidRunKey(run)} className="weekday-card clear-run-card">
                  <span className="weekday-title">
                    {run.raidName} · {run.difficulty} · {run.mode}
                    <small>
                      {run.day}요일 {formatTimeLabel(run.time)}
                      {(run.party ?? 1) > 1 || weeklyClears.some((item) => item.run !== run && item.run.day === run.day && item.run.time === run.time && compareSchedules(item.run, run) === 0)
                        ? ` ${getPartyGroupLabel(run.raidName, run.party ?? 1)}`
                        : ''}
                      {' · '}{getRaidWeeklyLimit(run.raidName) > 0 ? `클리어 ${count}회 · ` : ''}{people.length}명
                    </small>
                  </span>
                  <div className="member-tags">
                    {people.map((person) => renderClearPerson(
                      person.nickname,
                      getRaidWeeklyLimit(run.raidName) > 0 && <span className="clear-person-count">×{person.count}</span>,
                    ))}
                  </div>
                </div>
              ))}
              {weeklyClears.length === 0 && <span className="empty-role">{getEmptyText('아직 클리어한 레이드가 없어요')}</span>}
            </div>
          </div>
          )}

          {/* 모바일은 탭 묶음 대신 고르기 칸 두 개로 줄여 시간표가 바로 보이게 한다. */}
          {isMobile ? (
            <div className="mobile-raid-select" data-section="calendar">
              <select
                aria-label="레이드"
                value={activeRaidTab}
                onChange={(event) => {
                  // 오픈 예정 레이드를 고르면 알림만 띄우고 선택은 그대로 둔다.
                  const upcoming = upcomingRaids.find((raid) => `upcoming:${raid.id}` === event.target.value)
                  if (upcoming) {
                    notifyUpcomingRaid(upcoming)
                    return
                  }
                  setActiveRaidTab(event.target.value)
                }}
              >
                {visibleRaidTabs.map((tab) => (
                  <option key={tab.id} value={tab.label}>
                    {tab.label} · {countTabMembers(tab.raid, tab.difficulty, modeOptions)}명
                  </option>
                ))}
                {upcomingRaids.map((raid) => (
                  <option key={raid.id} value={`upcoming:${raid.id}`}>
                    {raid.label} {raid.tag} · {raid.openDate} 오픈 예정
                  </option>
                ))}
              </select>
              <select aria-label="공략 방식" value={activeModeTab} onChange={(event) => setActiveModeTab(event.target.value)}>
                {modeOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode} · {countTabMembers(activeTabMeta.raid, activeTabMeta.difficulty, [mode])}명
                  </option>
                ))}
              </select>
            </div>
          ) : (
          <div className="raid-tab-group" data-section="calendar" data-pc="calendar">
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
              {upcomingRaids.map((raid) => (
                <button
                  key={raid.id}
                  type="button"
                  className="raid-tab upcoming"
                  aria-haspopup="dialog"
                  onClick={() => notifyUpcomingRaid(raid)}
                >
                  <span className="upcoming-label">{raid.label}<br />{raid.tag}</span>
                  <small className="upcoming-date">{raid.openDate} 오픈 예정</small>
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
          )}

          {/* 모바일은 7일을 가로로 넘기는 대신 요일 하나씩 본다. */}
          {renderMobileDayTabs('calendar', (day) => {
            const tabKey = `${activeTabMeta.raid} ${activeTabMeta.difficulty} ${activeModeTab}`
            return timeSlots.some((time) => (memberByRaidDateTime.get(`${day}-${time}`)?.[tabKey] ?? []).length > 0)
          })}

          <div className="calendar-grid" data-section="calendar" data-pc="calendar" data-mobile-day={mobileCalendarDayIndex}>
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

              // 모바일은 신청이 있는 시간을 먼저 보여 주고, 빈 시간은 '더 보기'를 눌러야 나온다.
              if (isMobile && !showVacantTimes && vacantPartyTimes.includes(time)) {
                return null
              }

              // 신청이 하나도 없는 시간 줄은 얇게 줄인다. (PC)
              const isEmptyRow = !weekdayNames.some((day) => isPartyTimeUsed(day, time))
              const emptyRowClass = isEmptyRow ? ' is-empty-row' : ''

              // 모바일은 하루씩 보므로, 그 요일에 없는 시간 줄은 시간 칸까지 통째로 숨긴다. (off-day-N 클래스로 표시)
              const offDayClasses = weekDates
                .map((date, dayIndex) => (getDayTimeSlots(date).includes(time) ? '' : ` off-day-${dayIndex}`))
                .join('')

              return (
                <Fragment key={time}>
                  <div className={`time-label${offDayClasses}${emptyRowClass}`}>{formatTimeLabel(time)}</div>
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
                      return <div key={`${date.toISOString()}-${time}-empty`} className={`slot-cell empty muted-slot${emptyRowClass}`} data-day-index={dayIndex} />
                    }

                    // 신청이 없는 칸은 흐린 '-'만 남겨 신청이 있는 칸이 눈에 띄게 한다.
                    if (people.length === 0) {
                      return (
                        <div
                          key={`${date.toISOString()}-${time}`}
                          id={`calendar-slot-${slotKey}`}
                          data-day-index={dayIndex}
                          className={`slot-cell empty is-vacant ${isMySlot ? 'my-schedule-slot' : ''}${slotStateClass}${emptyRowClass}`}
                        >
                          {isMySlot && <span className="my-slot-badge">내 시간</span>}
                          <span className="empty-text">-</span>
                          {/* 모바일은 하루씩 보여 칸이 넓으니 빈 시간에도 바로 첫 신청을 할 수 있게 한다. */}
                          {isMobile && renderJoinButton(
                            { raidName: activeTabMeta.raid, difficulty: activeTabMeta.difficulty, mode: activeModeTab, day: dayLabel, time },
                            0,
                            'is-vacant-join',
                          )}
                        </div>
                      )
                    }

                    // 인원이 많을수록 진하게 칠하고, 정원이 찼는지 · 리딩 가능자가 있는지 칸 위쪽에 표시한다.
                    const fullSize = getRaidFullSize(activeTabMeta.raid)
                    const isSingleParty = isSinglePartyRaid(activeTabMeta.raid)
                    const fillLevel = people.length >= fullSize ? 3 : people.length >= fullSize / 2 ? 2 : 1
                    const hasLeader = people.some((member) => member.leadReady === 'O')
                    // 정원을 넘으면 2파티(10인 레이드는 2공대)까지 꾸리고, 그보다 많으면 대기다. 직접 배치가 있으면 그대로 따른다.
                    const cellSlot = { day: dayLabel, time, raidName: activeTabMeta.raid, difficulty: activeTabMeta.difficulty, mode: activeModeTab }
                    const arrangement = getSlotArrangement(cellSlot)
                    const { waiting } = arrangement
                    const layoutKey = getSlotLayoutKey({ ...cellSlot, weekStart: weekStartKey })
                    const layoutRecord = slotLayoutByKey.get(layoutKey)
                    // 배치 바꾸기: 그 시간 리딩 가능자만. 바꾸는 중에는 빈 2공대(2파티)와 대기 자리도 놓을 곳으로 보여 준다.
                    const arrangerNickname = getSlotArranger(people)
                    const isArranging = Boolean(arrangerNickname) && arrangingSlot?.key === layoutKey
                    const pickedName = isArranging ? arrangingSlot.picked : null
                    const partyGroups = isArranging && arrangement.groups.length < 2
                      ? [...arrangement.groups, { party: 2, members: [], partyA: [], partyB: [] }]
                      : arrangement.groups
                    // 공대마다 A/B로 나눈다. 1파티 레이드(초월)는 A/B 없이 한 줄로 보여 준다.
                    const partyBlocks = partyGroups.map(({ party, partyA, partyB }) => ({
                      party,
                      label: partyGroups.length > 1 ? getPartyGroupLabel(activeTabMeta.raid, party) : '',
                      // 초월이 2파티로 나뉘면 위의 "1파티" · "2파티" 이름표로 충분해서 열 이름을 비운다.
                      columns: isSingleParty ? [[partyGroups.length > 1 ? '' : '파티', partyA, 'A']] : [['A', partyA, 'A'], ['B', partyB, 'B']],
                    }))
                    const moveTo = (nickname, target) => moveSlotMember(cellSlot, arrangement, arrangerNickname, nickname, target)
                    // 옮길 곳(파티 열 · 대기)에 끌어 놓거나, 사람을 고른 뒤 누르면 그리로 옮긴다.
                    const getDropProps = (target, label) => (isArranging ? {
                      role: 'button',
                      tabIndex: 0,
                      'aria-label': `${label}(으)로 옮기기`,
                      onDragOver: (event) => event.preventDefault(),
                      onDrop: (event) => {
                        event.preventDefault()
                        moveTo(event.dataTransfer.getData('text/plain'), target)
                      },
                      onClick: () => pickedName && moveTo(pickedName, target),
                    } : {})
                    // 사람: 끌어서 옮기고, 다른 사람 위에 놓거나 고른 뒤 누르면 서로 자리를 바꾼다.
                    const getArrangePillProps = (member) => ({
                      role: 'button',
                      tabIndex: 0,
                      draggable: true,
                      'aria-pressed': pickedName === member.nickname,
                      'aria-label': `${member.nickname} ${pickedName && pickedName !== member.nickname ? `과(와) ${pickedName} 자리 바꾸기` : '고르기'}`,
                      onDragStart: (event) => {
                        event.dataTransfer.setData('text/plain', member.nickname)
                        event.dataTransfer.effectAllowed = 'move'
                      },
                      onDragOver: (event) => event.preventDefault(),
                      onDrop: (event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        moveTo(event.dataTransfer.getData('text/plain'), { swapWith: member.nickname })
                      },
                      onClick: (event) => {
                        event.stopPropagation()

                        if (!pickedName) {
                          setArrangingSlot({ key: layoutKey, picked: member.nickname })
                        } else if (pickedName === member.nickname) {
                          setArrangingSlot({ key: layoutKey, picked: null })
                        } else {
                          moveTo(pickedName, { swapWith: member.nickname })
                        }
                      },
                    })
                    const renderPill = (member, keyPrefix) => (
                      <span
                        key={`${keyPrefix}-${member.nickname}`}
                        className={`time-member-pill ${isArranging ? 'is-arrangeable' : 'has-hover-tooltip'} ${pickedName === member.nickname ? 'is-picked' : ''}`}
                        {...(isArranging ? getArrangePillProps(member) : getMemberPillProps(member))}
                      >
                        <span className="nickname-with-icon">
                          <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                          <span className={`member-name-wrap ${getNicknameClassName(member.nickname)}`}>
                            <span>{member.nickname}</span>
                            <span className="member-power-inline">{member.power}</span>
                          </span>
                          {member.leadReady === 'O' && <span className="lead-badge" role="img" aria-label="리딩 가능"><LeadMark value="O" /></span>}
                        </span>
                        {/* 남은 횟수(에라쿠스)는 칸 오른쪽 위에 띄운다. 모바일은 칸이 좁아 이름 · 전투력을 밀어내지 않게 한다. */}
                        {renderEntriesLeft(activeTabMeta.raid, member.nickname)}
                        {!isArranging && <MemberTooltip member={member} ownerNickname={altOwnerByNickname.get(member.nickname)} />}
                      </span>
                    )

                    return (
                      <div
                        key={`${date.toISOString()}-${time}`}
                        id={`calendar-slot-${slotKey}`}
                        data-day-index={dayIndex}
                        className={`slot-cell occupied fill-${fillLevel} ${isMySlot ? 'my-schedule-slot' : ''}${isArranging ? ' is-arranging' : ''}${slotStateClass}`}
                      >
                        <div className="slot-cell-head">
                          {isMySlot && <span className="my-slot-badge">내 시간</span>}
                          <span className={`slot-count ${fillLevel === 3 ? 'is-full' : ''}`}>
                            {formatArrangementHeadcount(arrangement, fullSize)}
                          </span>
                          {!hasLeader && <span className="slot-warn">리더 없음</span>}
                          {arrangement.isManual && !isArranging && (
                            <span className="slot-manual-badge" title={`${layoutRecord?.updatedBy ?? '리딩 가능자'}님이 직접 옮긴 배치예요. 새로 신청한 사람은 신청순으로 빈자리에 들어가요.`}>
                              직접 배치
                            </span>
                          )}
                          {arrangerNickname && !isArranging && (
                            <button
                              type="button"
                              className="slot-arrange-button"
                              aria-label={`${dayLabel}요일 ${formatTimeLabel(time)} 배치 바꾸기`}
                              title="사람을 끌어서 공대 · 파티 · 대기를 옮겨요. 모두에게 같은 배치로 보여요."
                              onClick={() => setArrangingSlot({ key: layoutKey, picked: null })}
                            >
                              배치
                            </button>
                          )}
                          {!isArranging && renderJoinButton(
                            { raidName: activeTabMeta.raid, difficulty: activeTabMeta.difficulty, mode: activeModeTab, day: dayLabel, time },
                            people.length,
                          )}
                        </div>

                        {isArranging && (
                          <div className="slot-arrange-bar">
                            <span className="slot-arrange-hint">
                              {pickedName
                                ? `${pickedName}님을 옮길 자리나 바꿀 사람을 누르세요.`
                                : isMobile ? '옮길 사람을 누르세요.' : '사람을 끌어서 옮기세요. 사람 위에 놓으면 서로 바뀌어요.'}
                            </span>
                            {arrangement.isManual && (
                              <button
                                type="button"
                                className="slot-arrange-button"
                                disabled={savingLayoutKey === layoutKey}
                                onClick={() => {
                                  setArrangingSlot({ key: layoutKey, picked: null })
                                  applySlotLayout(cellSlot, {}, arrangerNickname, '신청순 자동 배치로 돌렸어요.')
                                }}
                              >
                                자동 배치로
                              </button>
                            )}
                            <button type="button" className="slot-arrange-button is-primary" onClick={() => setArrangingSlot(null)}>
                              완료
                            </button>
                          </div>
                        )}

                        <div className="raid-group-list">
                          <div className="raid-group-item selected-raid-item">
                            {partyBlocks.map(({ party, label, columns }) => (
                            <div key={party} className={`party-block ${label ? 'has-label' : ''}`}>
                            {label && <span className="party-block-label">{label}</span>}
                            <div className={`party-split ${isSingleParty ? 'is-single' : ''}`}>
                              {columns.map(([partyName, partyMembers, side]) => (
                                <div
                                  key={side}
                                  className={`party-column ${isArranging ? 'is-drop-target' : ''}`}
                                  {...getDropProps({ party, side }, `${label || ''} ${partyName || ''}`.trim() || '파티')}
                                >
                                  {partyName && <span className="party-label">{partyName}</span>}
                                  {partyMembers.length > 0 ? (
                                    <div className="time-member-list vertical">
                                      {partyMembers.map((member) => renderPill(member, `${slotKey}-${tabKey}-${party}-${side}`))}
                                    </div>
                                  ) : (
                                    <span className="empty-raid-text">{isArranging ? '여기로' : '-'}</span>
                                  )}
                                </div>
                              ))}
                            </div>
                            </div>
                            ))}
                            {isArranging ? (
                              <div className="party-waiting is-drop-target" {...getDropProps({ party: 0 }, '대기')}>
                                <span className="party-label">대기</span>
                                {waiting.length > 0 ? (
                                  <div className="time-member-list vertical">
                                    {waiting.map((member) => renderPill(member, `${slotKey}-${tabKey}-waiting`))}
                                  </div>
                                ) : (
                                  <span className="empty-raid-text">여기에 놓으면 대기</span>
                                )}
                              </div>
                            ) : waiting.length > 0 && (
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

          {vacantPartyTimes.length > 0 && (
            <button
              type="button"
              className="secondary-button vacant-times-toggle"
              data-section="calendar"
              aria-expanded={showVacantTimes}
              onClick={() => setShowVacantTimes((prev) => !prev)}
            >
              {showVacantTimes ? '빈 시간 접기 ▴' : `빈 시간 ${vacantPartyTimes.length}개 더 보기 ▾`}
            </button>
          )}

          {(!isMobile || membersView === 'signup') && (
          <div className="member-day-summary" data-section="members" data-pc="members">
            <h3>레이드별 신청 인원</h3>
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
                            {renderEntriesLeft(raidName, member.nickname)}
                          </span>
                          <MemberTooltip member={member} ownerNickname={altOwnerByNickname.get(member.nickname)} />
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <span className="empty-role">{getEmptyText('신청 인원 없음')}</span>
              )}
            </div>
          </div>
          )}

        </section>
      </main>
    </div>
  )
}

export default App

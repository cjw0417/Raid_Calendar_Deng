import { Fragment, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
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

const difficultyOptions = ['쉬움', '보통', '어려움']
const modeOptions = ['트라이', '반숙이상']
const raidTabOptions = [
  { id: 'muspel-easy', label: '무스펠 쉬움', raid: '무스펠', difficulty: '쉬움' },
  { id: 'muspel-hard', label: '무스펠 어려움', raid: '무스펠', difficulty: '어려움' },
  { id: 'snow-normal', label: '비탄의 설원 보통', raid: '비탄의 설원', difficulty: '보통' },
  { id: 'snow-hard', label: '비탄의 설원 어려움', raid: '비탄의 설원', difficulty: '어려움' },
]

const STORAGE_KEY = 'raid-calendar-members-v1'
const LOGIN_STORAGE_KEY = 'raid-calendar-login-v1'
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

function getRaidLabel(raidValue) {
  const normalized = String(raidValue ?? '').replace('비탄의 설원', '비탄의설원').replace('비탄의설원', '비탄의설원')
  return raidOptions.find((raid) => raid.id === raidValue || raid.label === raidValue || raid.label.replace(' ', '') === normalized)?.label ?? '무스펠'
}

function getDifficultyForRaid(raidLabel) {
  if (raidLabel === '비탄의 설원') return '보통'
  return '쉬움'
}

function normalizeLeadReady(value) {
  const normalized = String(value ?? 'X').toUpperCase()
  return normalized === 'O' || normalized === 'TRUE' || normalized === 'YES' ? 'O' : 'X'
}

function getClassIconPath(className) {
  return `/img/${className}.webp`
}

function getCurrentWeekDates() {
  const today = new Date()
  const start = new Date(today)
  const offset = (today.getDay() + 4) % 7
  start.setDate(today.getDate() - offset)
  start.setHours(0, 0, 0, 0)

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

function buildDefaultMember(overrides = {}) {
  return {
    id: `member-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nickname: '나의닉네임',
    days: [],
    times: [],
    attendance: '참',
    className: '수호성',
    power: '600~700k',
    raidFocus: '무스펠',
    difficulty: '쉬움',
    mode: '트라이',
    leadReady: 'X',
    ...overrides,
  }
}

function normalizeMemberRecord(member) {
  if (!member) {
    return null
  }

  return {
    id: member.id ?? `member-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nickname: member.nickname ?? '닉네임',
    days: Array.isArray(member.days) ? member.days : [],
    times: Array.isArray(member.times) ? member.times : [],
    attendance: member.attendance ?? '참',
    className: member.class_name ?? member.className ?? '수호성',
    power: member.power ?? '600~700k',
    raidFocus: member.raid_focus ?? member.raidFocus ?? '무스펠',
    difficulty: member.difficulty ?? getDifficultyForRaid(member.raid_focus ?? member.raidFocus ?? '무스펠'),
    mode: member.mode ?? '트라이',
    leadReady: normalizeLeadReady(member.lead_ready ?? member.leadReady ?? 'X'),
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

function App() {
  const weekDates = useMemo(() => getCurrentWeekDates(), [])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [nextReset, setNextReset] = useState(() => getNextResetDate())
  const [holidaySet, setHolidaySet] = useState(() => buildFallbackHolidaySet(new Date().getFullYear()))
  const [activeRaidTab, setActiveRaidTab] = useState('무스펠 쉬움')
  const [activeModeTab, setActiveModeTab] = useState('트라이')
  const [helpOpen, setHelpOpen] = useState(false)
  const [calendarHelpOpen, setCalendarHelpOpen] = useState(false)
  const [loggedInNickname, setLoggedInNickname] = useState('')
  const [loginNickname, setLoginNickname] = useState(() => readStoredLoginNickname())
  const [rememberMe, setRememberMe] = useState(() => Boolean(readStoredLoginNickname()))
  const [profile, setProfile] = useState(() => buildDefaultMember({ nickname: '나의닉네임' }))
  const [members, setMembers] = useState(() => loadLocalMembers())
  const [showDaytimeSlots, setShowDaytimeSlots] = useState(false)

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
      saveLocalMembers(members)
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

    loadRemoteMembers()

    const channel = supabase
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

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  useEffect(() => {
    if (!supabase) {
      saveLocalMembers(members)
    }
  }, [members])

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date())
      setNextReset(getNextResetDate())
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const countdown = useMemo(() => {
    const diff = nextReset.getTime() - currentTime.getTime()
    const totalSeconds = Math.max(0, Math.floor(diff / 1000))
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return { days, hours, minutes, seconds }
  }, [currentTime, nextReset])

  const visibleTimeSlots = profile.days.some((day) => day === '토' || day === '일')
    ? (showDaytimeSlots ? timeSlots : timeSlots.filter((time) => !hiddenWeekdayTimeSlots.includes(time)))
    : weekdayTimeSlots

  const getSelectableTimesForDays = (days) => {
    if (!days.length) {
      return weekdayTimeSlots
    }

    const hasWeekendSelection = days.some((day) => day === '토' || day === '일')

    if (!hasWeekendSelection) {
      return weekdayTimeSlots
    }

    return showDaytimeSlots ? timeSlots : timeSlots.filter((time) => !hiddenWeekdayTimeSlots.includes(time))
  }

  const toggleMultiSelect = (key, value) => {
    setProfile((prev) => {
      if (key === 'days') {
        const nextDays = prev.days.includes(value)
          ? prev.days.filter((item) => item !== value)
          : [...prev.days, value]

        return {
          ...prev,
          days: nextDays,
          times: prev.times.filter((time) => getSelectableTimesForDays(nextDays).includes(time)),
        }
      }

      if (key === 'times') {
        const allowedTimes = getSelectableTimesForDays(prev.days)
        if (!allowedTimes.includes(value)) {
          return prev
        }

        const existing = prev.times
        const nextValues = existing.includes(value)
          ? existing.filter((item) => item !== value)
          : [...existing, value]

        return { ...prev, [key]: nextValues }
      }

      const existing = prev[key]
      const nextValues = existing.includes(value)
        ? existing.filter((item) => item !== value)
        : [...existing, value]

      return { ...prev, [key]: nextValues }
    })
  }

  const selectedSlots = useMemo(() => {
    const daySet = new Set(profile.days)
    const timeSet = new Set(profile.times)

    return sampleSlotData.filter(
      (slot) => daySet.has(weekdayNames[slot.dayIndex]) && timeSet.has(slot.time),
    )
  }, [profile.days, profile.times])

  const myScheduleSet = useMemo(() => {
    const scheduleMember =
      members.find((member) => member.nickname === loggedInNickname) ??
      {
        days: profile.days,
        times: profile.times,
      }

    const nextSet = new Set()

    scheduleMember.days.forEach((day) => {
      scheduleMember.times.forEach((time) => {
        nextSet.add(`${day}-${time}`)
      })
    })

    return nextSet
  }, [loggedInNickname, members, profile.days, profile.times])

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

  const selectedRaidLabel = raidOptions.find((raid) => raid.id === profile.raidFocus)?.label ?? '무스펠'
  const activeTabMeta = raidTabOptions.find((tab) => tab.label === activeRaidTab) ?? raidTabOptions[0]
  const isSharedMode = Boolean(supabase)

  const memberByDay = useMemo(
    () =>
      Object.fromEntries(
        weekdayNames.map((day) => [
          day,
          members
            .filter((member) => member.days.includes(day) && member.attendance === '참')
            .map((member) => ({ nickname: member.nickname, className: member.className })),
        ]),
      ),
    [members],
  )

  const dayRaidSummary = useMemo(() => {
    return weekdayNames.map((day) => {
      const dayMembers = members.filter(
        (member) => member.days.includes(day) && member.attendance === '참',
      )

      const raidGroups = new Map()

      dayMembers.forEach((member) => {
        const raidLabel = getRaidLabel(member.raidFocus)
        const difficulty = member.difficulty ?? getDifficultyForRaid(raidLabel)
        const mode = member.mode ?? '트라이'
        const key = `${raidLabel} / ${difficulty} / ${mode}`

        const existing = raidGroups.get(key) ?? {
          label: key,
          times: new Set(),
          members: [],
        }

        member.times.forEach((time) => existing.times.add(time))
        existing.members.push({
          nickname: member.nickname,
          className: member.className,
          power: member.power ?? '600~700k',
          leadReady: normalizeLeadReady(member.leadReady ?? 'X'),
        })

        raidGroups.set(key, existing)
      })

      return {
        day,
        raidGroups: [...raidGroups.values()].map((group) => ({
          label: group.label,
          times: [...group.times].sort((a, b) => timeSlots.indexOf(a) - timeSlots.indexOf(b)),
          members: group.members,
        })),
      }
    })
  }, [members])

  const memberByRaidDateTime = useMemo(() => {
    const map = new Map()

    members.forEach((member) => {
      if (member.attendance !== '참') return

      const raidLabel = getRaidLabel(member.raidFocus)
      const difficulty = member.difficulty ?? getDifficultyForRaid(raidLabel)
      const mode = member.mode ?? '트라이'
      const tabKey = `${raidLabel} ${difficulty} ${mode}`

      member.days.forEach((day) => {
        member.times.forEach((time) => {
          const key = `${day}-${time}`
          const target = map.get(key) ?? {}
          const existing = target[tabKey] ?? []
          existing.push({
            nickname: member.nickname,
            className: member.className,
            power: member.power ?? '600~700k',
            leadReady: normalizeLeadReady(member.leadReady ?? 'X'),
          })
          target[tabKey] = existing
          map.set(key, target)
        })
      })
    })

    return map
  }, [members])

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
      return
    }

    setLoggedInNickname(trimmedNickname)

    if (rememberMe) {
      writeStoredLoginNickname(trimmedNickname)
    } else {
      writeStoredLoginNickname('')
    }

    setProfile((prev) => ({ ...prev, nickname: trimmedNickname }))
    await loadCurrentProfileByNickname(trimmedNickname)
  }

  const handleLogout = () => {
    setLoggedInNickname('')
    setLoginNickname('')
    setRememberMe(false)
    writeStoredLoginNickname('')
    setProfile(buildDefaultMember({ nickname: '' }))
  }

  const loadCurrentProfileByNickname = async (nickname) => {
    const trimmedNickname = String(nickname ?? '').trim()

    if (!trimmedNickname) {
      return
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('nickname', trimmedNickname)
        .maybeSingle()

      if (!error && data) {
        const member = normalizeMemberRecord(data)
        if (member) {
          setProfile((prev) => ({
            ...prev,
            ...member,
            className: member.className,
            raidFocus: getRaidLabel(member.raidFocus),
            nickname: trimmedNickname,
          }))
          return
        }
      }

      const storedMember = loadLocalMembers().find((member) => member.nickname === trimmedNickname)
      if (storedMember) {
        setProfile((prev) => ({
          ...prev,
          ...storedMember,
          className: storedMember.className,
          raidFocus: getRaidLabel(storedMember.raidFocus),
          nickname: trimmedNickname,
        }))
      }
      return
    }

    const existing = loadLocalMembers().find((member) => member.nickname === trimmedNickname)

    if (existing) {
      setProfile((prev) => ({
        ...prev,
        ...existing,
        className: existing.className,
        raidFocus: getRaidLabel(existing.raidFocus),
        nickname: trimmedNickname,
      }))
    }
  }

  const saveCurrentProfile = async () => {
    const trimmedNickname = (loggedInNickname || profile.nickname).trim()

    if (!trimmedNickname) {
      return
    }

    setLoggedInNickname(trimmedNickname)
    writeStoredLoginNickname(trimmedNickname)

    const nextMember = {
      ...profile,
      nickname: trimmedNickname,
      className: profile.className,
      raidFocus: profile.raidFocus,
      leadReady: normalizeLeadReady(profile.leadReady),
    }

    if (supabase) {
      const { data, error } = await supabase
        .from('members')
        .upsert(
          {
            nickname: nextMember.nickname,
            days: nextMember.days,
            times: nextMember.times,
            attendance: nextMember.attendance,
            class_name: nextMember.className,
            power: nextMember.power,
            raid_focus: getRaidLabel(nextMember.raidFocus),
            difficulty: nextMember.difficulty ?? getDifficultyForRaid(getRaidLabel(nextMember.raidFocus)),
            mode: nextMember.mode ?? '트라이',
            lead_ready: nextMember.leadReady,
          },
          { onConflict: 'nickname' },
        )
        .select()

      if (!error && Array.isArray(data)) {
        const normalized = data.map((member) => normalizeMemberRecord(member))
        setMembers((prevMembers) => {
          const nextMembers = [...prevMembers]
          const index = nextMembers.findIndex((member) => member.nickname === trimmedNickname)

          if (index >= 0) {
            nextMembers[index] = normalized[0]
            return nextMembers
          }

          return [...nextMembers, ...normalized]
        })
      }

      return
    }

    setMembers((prevMembers) => {
      const targetIndex = prevMembers.findIndex((member) => member.nickname === trimmedNickname)

      if (targetIndex >= 0) {
        const nextMembers = [...prevMembers]
        nextMembers[targetIndex] = { ...nextMembers[targetIndex], ...nextMember, nickname: trimmedNickname }
        return nextMembers
      }

      return [...prevMembers, { ...nextMember, id: `member-${Date.now()}`, nickname: trimmedNickname }]
    })
  }

  const clearCurrentSchedule = async () => {
    const trimmedNickname = (loggedInNickname || profile.nickname).trim()

    if (!trimmedNickname) {
      return
    }

    const confirmed = window.confirm(`${trimmedNickname}님의 스케줄을 삭제하시겠습니까?`)

    if (!confirmed) {
      return
    }

    setProfile((prev) => ({ ...prev, days: [], times: [] }))
    setMembers((prevMembers) => prevMembers.filter((member) => member.nickname !== trimmedNickname))

    if (supabase) {
      await supabase
        .from('members')
        .update({
          days: [],
          times: [],
          updated_at: new Date().toISOString(),
        })
        .eq('nickname', trimmedNickname)
    }
  }

  const deleteMember = async (nickname) => {
    if (supabase) {
      await supabase.from('members').delete().eq('nickname', nickname)
      setMembers((prevMembers) => prevMembers.filter((member) => member.nickname !== nickname))
      return
    }

    setMembers((prevMembers) => prevMembers.filter((member) => member.nickname !== nickname))
  }

  if (!loggedInNickname) {
    return (
      <div className="login-screen">
        <form className="login-card" onSubmit={handleLogin}>
          <p className="eyebrow centered">그루 레기온의 성역 스케줄</p>
          <h1>닉네임 로그인</h1>

          {!isSharedMode && (
            <p className="login-warning">
              공유 캘린더 모드가 비활성화되어 있어요. 다른 PC/IP에서 스케줄을 보려면 Supabase 환경 변수를 연결해야 합니다.
            </p>
          )}

          <p className="login-subtitle">
            로그인한 닉네임으로 자신의 레이드 가능 시간을 저장하고 조회할 수 있어요.
          </p>

          <label htmlFor="loginNickname" className="login-label">닉네임</label>
          <input
            id="loginNickname"
            type="text"
            value={loginNickname}
            onChange={(event) => setLoginNickname(event.target.value)}
            placeholder="본인 닉네임을 입력하세요"
            autoComplete="nickname"
          />

          <label className="remember-row" htmlFor="rememberMe">
            <input
              id="rememberMe"
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
            />
            <span>기억하기</span>
          </label>

          <button type="submit" className="primary-button login-button">
            로그인
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">그루 레기온의 성역</p>
          <h1>스케줄</h1>
        </div>
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
            <span className="user-badge">{loggedInNickname}</span>
            <button type="button" className="secondary-button small-logout" onClick={handleLogout}>
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <section className="summary-grid">
        <article className="summary-card accent">
          <span className="label">다음 리셋</span>
          <strong>{nextReset.toLocaleString('ko-KR', { month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
          <small>
            {countdown.days}일 {countdown.hours}시간 {countdown.minutes}분 {countdown.seconds}초 후
          </small>
        </article>

        <article className="summary-card">
          <span className="label">현재 집계</span>
          <strong>{members.filter((member) => member.attendance === '참').length}명 참여</strong>
          <small>{selectedSlots.length}개 타임 선택 · {profile.days.length}개 요일</small>
        </article>

        <article className="summary-card">
          <span className="label">파티 조건</span>
          <strong>2파티 / 10명</strong>
          <small>각 파티 5명 기준</small>
        </article>
      </section>

      <main className="content-grid">
        <section className="panel form-panel">
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
              <p>1. 닉네임과 리딩 여부를 입력해요.</p>
              <p>2. 가능한 요일과 시간대를 선택해요.</p>
              <p>3. 저장하면 주간 캘린더에서 해당 시간대에 자동으로 집계돼요.</p>
              <p>4. 레이드 탭과 난이도/공략 방식을 선택하면 파티 인원을 확인할 수 있어요.</p>
            </div>
          )}

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
                onChange={(event) => setProfile((prev) => ({ ...prev, nickname: event.target.value }))}
                placeholder="본인 닉네임 입력"
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
            <div className="chip-grid">
              {weekdayNames.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={profile.days.includes(day) ? 'chip active' : 'chip'}
                  onClick={() => toggleMultiSelect('days', day)}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div className="field-group">
            <label>시간대 선택</label>
            <div className="chip-grid time-grid">
              {visibleTimeSlots.map((time) => {
                const selectableTimes = getSelectableTimesForDays(profile.days)
                const isDisabled = !selectableTimes.includes(time)

                return (
                  <button
                    key={time}
                    type="button"
                    className={`${profile.times.includes(time) ? 'chip active' : 'chip'} ${isDisabled ? 'disabled' : ''}`}
                    onClick={() => toggleMultiSelect('times', time)}
                    disabled={isDisabled}
                    title={isDisabled ? '낮시간을 숨기면 12:00~16:00은 선택할 수 없어요.' : ''}
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
                {classOptions.map((className) => (
                  <option key={className} value={className}>
                    {className}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="two-column">
            <div className="field-group">
              <label htmlFor="power">전투력</label>
              <select
                id="power"
                value={profile.power}
                onChange={(event) => setProfile((prev) => ({ ...prev, power: event.target.value }))}
              >
                {powerOptions.map((power) => (
                  <option key={power} value={power}>
                    {power}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label htmlFor="raidFocus">주요 레이드</label>
              <select
                id="raidFocus"
                value={profile.raidFocus}
                onChange={(event) => {
                  const nextRaid = event.target.value
                  const nextDifficulty = getDifficultyForRaid(getRaidLabel(nextRaid))
                  setProfile((prev) => ({ ...prev, raidFocus: nextRaid, difficulty: nextDifficulty }))
                }}
              >
                {raidOptions.map((raid) => (
                  <option key={raid.id} value={raid.id}>
                    {raid.label}
                  </option>
                ))}
              </select>
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
                {modeOptions.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="selected-summary">
            <h3>내 선택 요약</h3>
            <ul>
              <li>닉네임: {profile.nickname || '미입력'}</li>
              <li>가능 요일: {profile.days.join(', ') || '선택 없음'}</li>
              <li>가능 시간: {profile.times.join(', ') || '선택 없음'}</li>
              <li>참여 여부: {profile.attendance}</li>
              <li>직업: {profile.className}</li>
              <li>전투력: {profile.power}</li>
              <li>리딩 가능 여부: {profile.leadReady}</li>
              <li>우선 레이드: {selectedRaidLabel} · {profile.difficulty} · {profile.mode}</li>
            </ul>
          </div>

          <div className="member-actions">
            <button type="button" className="primary-button" onClick={saveCurrentProfile}>
              캘린더에 저장
            </button>
            <button type="button" className="secondary-button" onClick={clearCurrentSchedule}>
              내 스케줄 삭제
            </button>
          </div>
        </section>

        <section className="panel calendar-panel">
          <div className="panel-header">
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
              <span className="legend-item"><span className="legend-badge lead-yes">O</span> 리딩 가능</span>
              <span className="legend-item"><span className="legend-badge lead-no">X</span> 리딩 불가</span>
            </div>
          </div>

          {calendarHelpOpen && (
            <div className="help-panel compact">
              <p>• 탭을 누르면 레이드 · 난이도 · 공략 방식을 바꿀 수 있어요.</p>
              <p>• 각 시간칸은 해당 조건의 인원이 저장한 시간대를 보여주고, A/B 파티로 나뉘어 집계됩니다.</p>
              <p>• 한 타임에 한 포스, 한 파티당 5명씩 총 10명이 기준이며, O는 리딩 가능, X는 리딩 불가를 뜻해요.</p>
              <p>• 요일별 신청 현황에서는 해당 요일에 어떤 레이드와 시간대가 신청됐는지 한눈에 확인할 수 있어요.</p>
            </div>
          )}

          <div className="day-raid-summary-panel">
            <h3>요일별 레이드 신청 현황</h3>
            <div className="day-raid-summary-grid">
              {dayRaidSummary.map(({ day, raidGroups }) => (
                <div key={day} className="day-raid-card">
                  <div className="day-raid-header">
                    <span>{day}요일</span>
                  </div>
                  {raidGroups.length > 0 ? (
                    <div className="day-raid-list">
                      {raidGroups.map(({ label, times, members }) => (
                        <div key={`${day}-${label}`} className="day-raid-bundle">
                          <strong>{label}</strong>
                          <div className="day-raid-times">
                            {times.length > 0 ? times.map((time) => (
                              <span key={`${day}-${label}-${time}`} className="day-raid-time-tag">{time}</span>
                            )) : <span className="empty-role">시간 없음</span>}
                          </div>
                          <div className="day-raid-members">
                            {members.map((member) => (
                              <span key={`${day}-${label}-${member.nickname}`} className="day-raid-member">
                                <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                                <span className="member-name-wrap">
                                  <span>{member.nickname}</span>
                                  <span className="member-power-inline">{member.power}</span>
                                </span>
                                {member.leadReady === 'O' && <span className="lead-badge" aria-label="리딩 가능">O</span>}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-role">신청 인원 없음</div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="raid-tab-group">
            <div className="raid-tab-bar" role="tablist" aria-label="레이드 난이도 선택">
              {raidTabOptions.map((tab) => (
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

          <div className="calendar-grid">
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
                        className={`slot-cell ${slot ? 'occupied' : 'empty'} ${profile.days.includes(weekdayNames[dayIndex]) && profile.times.includes(time) ? 'selected' : ''} ${myScheduleSet.has(`${dayLabel}-${time}`) ? 'my-schedule-slot' : ''}`}
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
                                      <span key={`${dayLabel}-${time}-${tabKey}-A-${member.nickname}`} className="time-member-pill">
                                        <span className="nickname-with-icon">
                                          <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                                          <span className="member-name-wrap">
                                            <span>{member.nickname}</span>
                                            <span className="member-power-inline">{member.power}</span>
                                          </span>
                                          {member.leadReady === 'O' && <span className="lead-badge" aria-label="리딩 가능">O</span>}
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
                                      <span key={`${dayLabel}-${time}-${tabKey}-B-${member.nickname}`} className="time-member-pill">
                                        <span className="nickname-with-icon">
                                          <img src={getClassIconPath(member.className)} alt={member.className} className="nickname-icon" />
                                          <span className="member-name-wrap">
                                            <span>{member.nickname}</span>
                                            <span className="member-power-inline">{member.power}</span>
                                          </span>
                                          {member.leadReady === 'O' && <span className="lead-badge" aria-label="리딩 가능">O</span>}
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

          <div className="member-day-summary">
            <h3>요일별 선택 회원</h3>
            <div className="weekday-list">
              {weekdayNames.map((day) => (
                <div key={day} className="weekday-card">
                  <span className="weekday-title">{day}요일</span>
                  <div className="member-tags">
                    {memberByDay[day]?.length ? (
                      memberByDay[day].map(({ nickname, className }) => (
                        <span key={`${day}-${nickname}`} className="member-tag">
                          <span className="nickname-with-icon small">
                            <img src={getClassIconPath(className)} alt={className} className="nickname-icon" />
                            <span>{nickname}</span>
                          </span>
                        </span>
                      ))
                    ) : (
                      <span className="empty-role">선택 인원 없음</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

        </section>
      </main>
    </div>
  )
}

export default App

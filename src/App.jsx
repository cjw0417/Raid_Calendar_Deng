import { useEffect, useMemo, useState } from 'react'
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
const weekdayNames = ['수', '목', '금', '토', '일', '월', '화']
const timeSlots = [
  '19:00',
  '19:30',
  '20:00',
  '20:30',
  '21:00',
  '21:30',
  '22:00',
  '22:30',
  '23:00',
  '23:30',
  '00:00',
]
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

const sampleSlotData = []

function buildDefaultMember(overrides = {}) {
  return {
    id: `member-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nickname: '',
    days: [''],
    times: [''],
    attendance: '참',
    className: '',
    power: '600~700k',
    raidFocus: '무스펠',
    difficulty: '쉬움',
    mode: '트라이',
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

function App() {
  const weekDates = useMemo(() => getCurrentWeekDates(), [])
  const [currentTime, setCurrentTime] = useState(new Date())
  const [nextReset, setNextReset] = useState(() => getNextResetDate())
  const [activeRaidTab, setActiveRaidTab] = useState('무스펠 쉬움')
  const [activeModeTab, setActiveModeTab] = useState('트라이')
  const [profile, setProfile] = useState(() => buildDefaultMember())
  const [members, setMembers] = useState(() => loadLocalMembers())

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

  const toggleMultiSelect = (key, value) => {
    setProfile((prev) => {
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

  const selectedRaidLabel = raidOptions.find((raid) => raid.id === profile.raidFocus)?.label ?? '무스펠'
  const activeTabMeta = raidTabOptions.find((tab) => tab.label === activeRaidTab) ?? raidTabOptions[0]

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
          existing.push({ nickname: member.nickname, className: member.className })
          target[tabKey] = existing
          map.set(key, target)
        })
      })
    })

    return map
  }, [members])

  const saveCurrentProfile = async () => {
    const trimmedNickname = profile.nickname.trim()

    if (!trimmedNickname) {
      return
    }

    const nextMember = {
      ...profile,
      nickname: trimmedNickname,
      className: profile.className,
      raidFocus: profile.raidFocus,
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

  const loadCurrentProfile = async () => {
    const trimmedNickname = profile.nickname.trim()

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
          }))
        }
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
      }))
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

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">아이온2 · 레이드 파티 조율</p>
          <h1>주간 레이드 캘린더</h1>
        </div>
        <div className="live-clock">
          <span>실시간</span>
          <strong>{currentTime.toLocaleString('ko-KR')}</strong>
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
          </div>

          <div className="field-group">
            <label htmlFor="nickname">닉네임</label>
            <input
              id="nickname"
              type="text"
              value={profile.nickname}
              onChange={(event) => setProfile((prev) => ({ ...prev, nickname: event.target.value }))}
              placeholder="본인 닉네임 입력"
            />
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
              {timeSlots.map((time) => (
                <button
                  key={time}
                  type="button"
                  className={profile.times.includes(time) ? 'chip active' : 'chip'}
                  onClick={() => toggleMultiSelect('times', time)}
                >
                  {time}
                </button>
              ))}
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
              <li>우선 레이드: {selectedRaidLabel} · {profile.difficulty} · {profile.mode}</li>
            </ul>
          </div>

          <div className="member-actions">
            <button type="button" className="primary-button" onClick={saveCurrentProfile}>
              현재 프로필 저장
            </button>
            <button type="button" className="secondary-button" onClick={loadCurrentProfile}>
              내 스케줄 불러오기
            </button>
          </div>
        </section>

        <section className="panel calendar-panel">
          <div className="panel-header">
            <h2>주간 레이드 슬롯</h2>
            <span className="mini-badge">빈 슬롯 기준</span>
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

            {timeSlots.map((time) => (
              <>
                <div key={`${time}-label`} className="time-label">
                  {time}
                </div>
                {weekDates.map((date, dayIndex) => {
                  const slot = sampleSlotData.find(
                    (entry) => entry.dayIndex === dayIndex && entry.time === time,
                  )
                  const dayLabel = date.toLocaleDateString('ko-KR', { weekday: 'short' })
                  const raidPeople = memberByRaidDateTime.get(`${dayLabel}-${time}`) ?? {}
                  const tabKey = `${activeTabMeta.raid} ${activeTabMeta.difficulty} ${activeModeTab}`
                  const people = raidPeople[tabKey] ?? []
                  const partyA = people.slice(0, 5)
                  const partyB = people.slice(5, 10)

                  return (
                    <div
                      key={`${date.toISOString()}-${time}`}
                      className={`slot-cell ${slot ? 'occupied' : 'empty'} ${profile.days.includes(weekdayNames[dayIndex]) && profile.times.includes(time) ? 'selected' : ''}`}
                    >
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
                                        <span>{member.nickname}</span>
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
                                        <span>{member.nickname}</span>
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
              </>
            ))}
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

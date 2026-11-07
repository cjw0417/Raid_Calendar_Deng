// 여러 곳에서 쓰는 작은 화면 조각
import { useEffect, useState } from 'react'
import {
  getClassIconPath,
  getNextResetDate,
} from '../lib/schedule'

// 모바일 하단 탭 아이콘
export function MobileTabIcon({ id }) {
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

// 리딩 O/X 표시. 글꼴·화면 배율에 따라 글자가 틀어지지 않도록 SVG로 그린다.
export function LeadMark({ value }) {
  return (
    <svg className="lead-mark" viewBox="0 0 10 10" aria-hidden="true">
      {value === 'O' ? <circle cx="5" cy="5" r="3.1" /> : <path d="M2.5 2.5 7.5 7.5 M7.5 2.5 2.5 7.5" />}
    </svg>
  )
}

// 탭 옆 신청 인원 수. 0명이면 흐리게 보여 준다.
export function TabCount({ count }) {
  return (
    <span className={`tab-count ${count > 0 ? '' : 'is-zero'}`} aria-label={`${count}명`}>
      {count}
    </span>
  )
}

// 1초마다 바뀌는 표시는 이 작은 컴포넌트들만 다시 그린다. (화면 전체는 1분마다만 다시 계산한다)
export function useSecondTicker() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  return now
}

export function LiveClock() {
  const now = useSecondTicker()
  return <strong>{now.toLocaleString('ko-KR')}</strong>
}

export function ResetCountdown() {
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
export function MemberTooltip({ member, ownerNickname, showLead = false }) {
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

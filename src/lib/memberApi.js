import { supabase } from './supabase'

// 닉네임별 비밀번호 확인과 스케줄 쓰기.
// Supabase가 연결되어 있으면 DB 함수(supabase_member_password.sql)가 비밀번호를 확인하고,
// 연결되지 않은 로컬 모드에서는 이 브라우저의 localStorage에 비밀번호 해시를 둔다.

// 로컬 모드에서만 쓰는 초기 비밀번호. Supabase 모드의 초기 비밀번호는 DB app_settings에 있다.
const LOCAL_INITIAL_PASSWORD = '0801'
const LOCAL_CREDENTIALS_KEY = 'raid-calendar-credentials-v1'

export const PASSWORD_RULE = /^[0-9]{4,}$/

const resultMessages = {
  invalid: '닉네임 또는 비밀번호가 맞지 않아요.',
  locked: '비밀번호를 여러 번 틀려서 5분 동안 잠겼어요. 잠시 후 다시 시도해 주세요.',
  weak: '비밀번호는 숫자 4자리 이상이어야 해요.',
  same_as_initial: '초기 비밀번호와 다른 비밀번호를 정해 주세요.',
}

export function describeAuthResult(result) {
  return resultMessages[result] ?? `알 수 없는 오류가 났어요. (${result})`
}

async function hashPassword(nickname, password) {
  const bytes = new TextEncoder().encode(`${nickname}:${password}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readLocalCredentials() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CREDENTIALS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

async function verifyLocalPassword(nickname, password, allowInitial) {
  const storedHash = readLocalCredentials()[nickname]

  if (!storedHash) {
    return allowInitial && password === LOCAL_INITIAL_PASSWORD ? 'initial' : 'invalid'
  }

  return storedHash === (await hashPassword(nickname, password)) ? 'ok' : 'invalid'
}

async function callRpc(name, params) {
  const { data, error } = await supabase.rpc(name, params)

  if (error) {
    throw error
  }

  return data
}

// 반환값: 'ok' | 'must_change' | 'invalid' | 'locked'
export async function memberLogin(nickname, password) {
  if (supabase) {
    return callRpc('member_login', { p_nickname: nickname, p_password: password })
  }

  const result = await verifyLocalPassword(nickname, password, true)
  return result === 'initial' ? 'must_change' : result
}

// 반환값: 'ok' | 'invalid' | 'locked' | 'weak' | 'same_as_initial'
export async function memberSetPassword(nickname, currentPassword, newPassword) {
  if (supabase) {
    return callRpc('member_set_password', {
      p_nickname: nickname,
      p_current_password: currentPassword,
      p_new_password: newPassword,
    })
  }

  const verifyResult = await verifyLocalPassword(nickname, currentPassword, true)

  if (verifyResult !== 'ok' && verifyResult !== 'initial') {
    return verifyResult
  }

  if (!PASSWORD_RULE.test(newPassword)) {
    return 'weak'
  }

  if (newPassword === LOCAL_INITIAL_PASSWORD) {
    return 'same_as_initial'
  }

  const credentials = readLocalCredentials()
  credentials[nickname] = await hashPassword(nickname, newPassword)
  localStorage.setItem(LOCAL_CREDENTIALS_KEY, JSON.stringify(credentials))
  return 'ok'
}

// 아래 쓰기 함수들은 Supabase 모드 전용이다. 반환값: 성공 데이터 또는 { error: 'invalid' | 'locked' }
export function saveMemberSchedule(nickname, password, member, schedule) {
  return callRpc('member_save_schedule', {
    p_nickname: nickname,
    p_password: password,
    p_member: member,
    p_schedule: schedule,
  })
}

export function deleteMemberSchedule(nickname, password, target) {
  return callRpc('member_delete_schedule', {
    p_nickname: nickname,
    p_password: password,
    p_raid_name: target.raidName,
    p_difficulty: target.difficulty,
    p_mode: target.mode,
  })
}

export function deleteAllMemberSchedules(nickname, password) {
  return callRpc('member_delete_all_schedules', { p_nickname: nickname, p_password: password })
}

import { supabase } from './supabase'

// 닉네임별 비밀번호 확인과 스케줄 쓰기.
// Supabase가 연결되어 있으면 DB 함수(supabase_member_password.sql)가 비밀번호를 확인하고,
// 연결되지 않은 로컬 모드에서는 이 브라우저의 localStorage에 비밀번호 해시를 둔다.

// 로컬 모드에서만 쓰는 초기 비밀번호. Supabase 모드의 초기 비밀번호는 DB app_settings에 있다.
const LOCAL_INITIAL_PASSWORD = '0801'
const LOCAL_CREDENTIALS_KEY = 'raid-calendar-credentials-v1'

export const PASSWORD_RULE = /^[0-9]{4,}$/

// 비밀번호 찾기 질문. 답이 질문에 드러나지 않도록 정해진 목록에서만 고른다.
export const HINT_QUESTIONS = [
  '처음 키운 반려동물 이름은?',
  '어릴 적 별명은?',
  '졸업한 초등학교 이름은?',
  '가장 좋아하는 음식은?',
  '처음 키운 게임 캐릭터 이름은?',
]

const resultMessages = {
  invalid: '닉네임 또는 비밀번호가 맞지 않아요.',
  locked: '여러 번 틀려서 5분 동안 잠겼어요. 잠시 후 다시 시도해 주세요.',
  weak: '비밀번호는 숫자 4자리 이상이어야 해요.',
  same_as_initial: '초기 비밀번호와 다른 비밀번호를 정해 주세요.',
  hint_required: '비밀번호 찾기 질문을 고르고 답을 2글자 이상 적어 주세요.',
  no_hint: '비밀번호 찾기 질문을 정하지 않은 닉네임이에요. 관리자에게 비밀번호 초기화를 요청해 주세요.',
  no_password: '아직 개인 비밀번호를 정하지 않은 닉네임이에요. 초기 비밀번호로 로그인해 비밀번호를 정해 주세요.',
}

export function describeAuthResult(result) {
  return resultMessages[result] ?? `알 수 없는 오류가 났어요. (${result})`
}

// 찾기 답 비교용: 공백을 없애고 소문자로 맞춘다. (DB의 _normalize_hint_answer와 같은 규칙)
export function normalizeHintAnswer(answer) {
  return String(answer ?? '').replace(/\s+/g, '').toLowerCase()
}

async function hashText(nickname, text) {
  const bytes = new TextEncoder().encode(`${nickname}:${text}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// { [nickname]: { passwordHash, hintQuestion, hintAnswerHash } }
function readLocalCredentials() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_CREDENTIALS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function writeLocalCredential(nickname, credential) {
  const credentials = readLocalCredentials()
  credentials[nickname] = credential
  localStorage.setItem(LOCAL_CREDENTIALS_KEY, JSON.stringify(credentials))
}

async function verifyLocalPassword(nickname, password, allowInitial) {
  const credential = readLocalCredentials()[nickname]

  if (!credential) {
    return allowInitial && password === LOCAL_INITIAL_PASSWORD ? 'initial' : 'invalid'
  }

  return credential.passwordHash === (await hashText(nickname, password)) ? 'ok' : 'invalid'
}

function checkNewPassword(newPassword) {
  if (!PASSWORD_RULE.test(newPassword)) {
    return 'weak'
  }

  return newPassword === LOCAL_INITIAL_PASSWORD ? 'same_as_initial' : null
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

// 처음 설정: 초기 비밀번호로 들어온 닉네임이 개인 비밀번호와 찾기 질문·답을 정한다.
// 반환값: 'ok' | 'invalid' | 'locked' | 'weak' | 'same_as_initial' | 'hint_required'
export async function memberSetupPassword(nickname, initialPassword, newPassword, hintQuestion, hintAnswer) {
  if (supabase) {
    return callRpc('member_setup_password', {
      p_nickname: nickname,
      p_initial_password: initialPassword,
      p_new_password: newPassword,
      p_hint_question: hintQuestion,
      p_hint_answer: hintAnswer,
    })
  }

  const verifyResult = await verifyLocalPassword(nickname, initialPassword, true)

  if (verifyResult !== 'initial') {
    return 'invalid'
  }

  const passwordProblem = checkNewPassword(newPassword)

  if (passwordProblem) {
    return passwordProblem
  }

  if (!hintQuestion || normalizeHintAnswer(hintAnswer).length < 2) {
    return 'hint_required'
  }

  writeLocalCredential(nickname, {
    passwordHash: await hashText(nickname, newPassword),
    hintQuestion,
    hintAnswerHash: await hashText(nickname, normalizeHintAnswer(hintAnswer)),
  })
  return 'ok'
}

// 변경: 지금 비밀번호를 알고 있을 때. 반환값: 'ok' | 'invalid' | 'locked' | 'weak' | 'same_as_initial'
export async function memberSetPassword(nickname, currentPassword, newPassword) {
  if (supabase) {
    return callRpc('member_set_password', {
      p_nickname: nickname,
      p_current_password: currentPassword,
      p_new_password: newPassword,
    })
  }

  if ((await verifyLocalPassword(nickname, currentPassword, false)) !== 'ok') {
    return 'invalid'
  }

  const passwordProblem = checkNewPassword(newPassword)

  if (passwordProblem) {
    return passwordProblem
  }

  const credential = readLocalCredentials()[nickname]
  writeLocalCredential(nickname, { ...credential, passwordHash: await hashText(nickname, newPassword) })
  return 'ok'
}

// 찾기 질문. 반환값: { status: 'ok', question } | { status: 'no_password' } | { status: 'no_hint' }
export async function memberGetHintQuestion(nickname) {
  if (supabase) {
    return callRpc('member_get_hint_question', { p_nickname: nickname })
  }

  const credential = readLocalCredentials()[nickname]

  if (!credential) {
    return { status: 'no_password' }
  }

  return credential.hintQuestion ? { status: 'ok', question: credential.hintQuestion } : { status: 'no_hint' }
}

// 찾기: 답을 맞히면 새 비밀번호로 바꾼다.
// 반환값: 'ok' | 'invalid' | 'locked' | 'no_hint' | 'weak' | 'same_as_initial'
export async function memberResetPassword(nickname, hintAnswer, newPassword) {
  if (supabase) {
    return callRpc('member_reset_password', {
      p_nickname: nickname,
      p_hint_answer: hintAnswer,
      p_new_password: newPassword,
    })
  }

  const credential = readLocalCredentials()[nickname]

  if (!credential?.hintAnswerHash) {
    return 'no_hint'
  }

  const passwordProblem = checkNewPassword(newPassword)

  if (passwordProblem) {
    return passwordProblem
  }

  if (credential.hintAnswerHash !== (await hashText(nickname, normalizeHintAnswer(hintAnswer)))) {
    return 'invalid'
  }

  writeLocalCredential(nickname, { ...credential, passwordHash: await hashText(nickname, newPassword) })
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

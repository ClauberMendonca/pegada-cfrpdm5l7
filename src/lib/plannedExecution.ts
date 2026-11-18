// GINGA — FATIA 5B: PLANEJAMENTO DE EXECUÇÃO DO AVANÇO (SÓ FRONTEND)
// Representação = INTENÇÃO LOCAL (dia/hora literais + fuso explícito), nunca um
// instante: sem planned_at derivado, sem parse de fuso, sem conversão de zona.
// Backend 86 (guarda onRecordValidate) continua a autoridade final dos valores.

import { formatCalendarDay } from '@/lib/datetime'

export interface PlannedExecution {
  /** Dia-calendário literal 'YYYY-MM-DD' no fuso do planejamento ('' = sem plano). */
  date: string
  /** Hora literal 'HH:mm' (00–23 / 00–59); '' = dia inteiro. */
  time: string
  /** Literal de fuso salvo (IANA ou 'UTC'); '' = sem plano. */
  timezone: string
}

export const EMPTY_PLANNED: PlannedExecution = { date: '', time: '', timezone: '' }

// ---- VALIDAÇÃO LITERAL (dia real, hora real) -------------------------------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

function daysInMonthOf(year: number, month: number): number {
  if ([1, 3, 5, 7, 8, 10, 12].includes(month)) return 31
  if ([4, 6, 9, 11].includes(month)) return 30
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28
}

/** Dia real 'YYYY-MM-DD' (mês 1–12, bissexto, mês curto). '' é válido (opcional). */
export function isValidPlannedDate(value: string): boolean {
  if (value === '') return true
  if (!DAY_RE.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))
  if (month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonthOf(year, month)
}

/** Hora real 'HH:mm' (00–23 / 00–59). '' é válido (planejar só o dia). */
export function isValidPlannedTime(value: string): boolean {
  if (value === '') return true
  if (!TIME_RE.test(value)) return false
  const hours = Number(value.slice(0, 2))
  const minutes = Number(value.slice(3, 5))
  return hours <= 23 && minutes <= 59
}

// ---- FUSO EXPLÍCITO (sem novo seletor) -------------------------------------

/**
 * Fuso do planejamento no momento da PRIMEIRA escolha de dia:
 * - perfil válido (useAuth user.timezone): literal verificado no Intl, sem
 *   sobrescrever alias com resolvedOptions;
 * - perfil ausente/inválido: UTC EXPLÍCITO com aviso persistente no rascunho.
 * Fuso Local/offset do dispositivo nunca é referência.
 */
export function plannedTimezoneOrFallback(profileTimezone: string): {
  timezone: string
  usedFallback: boolean
} {
  const raw = (profileTimezone ?? '').trim()
  if (raw !== '' && isValidTimezoneLiteral(raw)) {
    return { timezone: raw, usedFallback: false }
  }
  return { timezone: 'UTC', usedFallback: true }
}

/** Literal de fuso verificável neste navegador (IANA ou UTC). */
export function isValidTimezoneLiteral(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export const UTC_FALLBACK_NOTICE = 'O fuso do perfil não pôde ser usado. Este planejamento usa UTC.'
export const SAVED_TZ_NOTE = 'Este avanço mantém o fuso salvo no planejamento.'
export const CLEAR_DATE_NOTICE = 'Remover a data também remove a hora ao salvar.'

// ---- LEITURA DO REGISTRO (ActionItem 86) -----------------------------------

/** Tupla da abertura: campos ausentes no legado viram '' (vazio canônico). */
export function plannedOf(action: {
  planned_date?: string | null
  planned_time?: string | null
  planned_timezone?: string | null
}): PlannedExecution {
  return {
    date: typeof action.planned_date === 'string' ? action.planned_date : '',
    time: typeof action.planned_time === 'string' ? action.planned_time : '',
    timezone: typeof action.planned_timezone === 'string' ? action.planned_timezone : '',
  }
}

/** Alterou o planejamento em relação à abertura? (comparação com 3 valores) */
export function plannedChanged(draft: PlannedExecution, original: PlannedExecution): boolean {
  return (
    draft.date !== original.date ||
    draft.time !== original.time ||
    draft.timezone !== original.timezone
  )
}

// ---- APRESENTAÇÃO (ActionRow) ----------------------------------------------

/** Dados de planejamento incoerentes no registro: nada inventado, aviso neutro. */
export function plannedIncoherent(action: {
  planned_date?: string | null
  planned_time?: string | null
  planned_timezone?: string | null
}): boolean {
  const p = plannedOf(action)
  if (p.date === '' && p.time === '' && p.timezone === '') return false
  if (p.date === '') return true // hora/fuso sem dia não existe como plano
  return !isValidPlannedDate(p.date) || (p.time !== '' && !isValidPlannedTime(p.time))
}

/**
 * Rótulo de EXIBIÇÃO de dia já validado — reusa formatCalendarDay (contrato
 * antigo de prazos). Sem new Date('YYYY-MM-DD'), sem toISOString, sem fuso
 * inferido: o dia/hora são literais do fuso SALVO, não deslocados.
 */
export function plannedDisplayLabel(p: PlannedExecution): string | null {
  if (p.date === '' || !isValidPlannedDate(p.date)) return null
  const day = formatCalendarDay(p.date)
  if (!day) return null
  if (p.time !== '' && isValidPlannedTime(p.time)) {
    return `${day} às ${p.time}`
  }
  return day
}

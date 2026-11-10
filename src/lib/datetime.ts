// FATIA P1C — semântica de datas do app (módulo único, reutilizado por
// TodayPage, prazos, progressService e exibições).
//
// SEMÂNTICA REGISTRADA:
// - INSTANTES (com horário, guardados em UTC): created/updated das coleções
//   (autodate do PocketBase) e `captures.created`. Nunca são substituídos por
//   hora artificial; exibição converte para o fuso do dono (users.timezone).
// - DIAS-CALENDÁRIO (sem horário, texto 'YYYY-MM-DD'): `actions.deadline`,
//   `projects.deadline` e `progress_logs.date`. Nunca são parseados como
//   instante (new Date('YYYY-MM-DD') parseia como UTC e desloca o dia perto
//   de fusos negativos); são comparados e exibidos como texto puro.

type DateLike = Date | string | null | undefined

const CALENDAR_DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function toDate(value: DateLike): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string' && value.trim() !== '') {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Dia-calendário de um INSTANTE no fuso indicado (YYYY-MM-DD).
 * Usar só para timestamps (created/updated); nunca para texto de dia puro.
 * Fuso vazio/inválido → UTC (fallback explícito).
 */
export function dayInZone(value: DateLike, timezone?: string): string {
  const d = toDate(value)
  if (!d) return ''
  if (timezone) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d) // en-CA → YYYY-MM-DD
    } catch {
      /* fuso inválido → cai para UTC */
    }
  }
  return d.toISOString().slice(0, 10)
}

/** "Hoje" como dia-calendário no fuso do dono (referência única de Hoje). */
export function todayInZone(timezone?: string): string {
  return dayInZone(new Date(), timezone)
}

/** Fuso do dono a partir do registro autenticado (ou fallback vazio = UTC). */
export function ownerTimezone(userTimezone?: string | null): string | undefined {
  const tz = (userTimezone || '').trim()
  return tz === '' ? undefined : tz
}

/** Instante exibido no fuso do dono: dd/mm/aaaa hh:mm. */
export function formatInstantInZone(value: DateLike, timezone?: string): string {
  const d = toDate(value)
  if (!d) return ''
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone || 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

/**
 * Dia-calendário (texto puro) para EXIBIÇÃO, sem parse de fuso:
 * 'YYYY-MM-DD' → 'DD/MM/AAAA'. Qualquer outro conteúdo volta intacto
 * (nunca 'Invalid Date'). Vazio → ''.
 */
export function formatCalendarDay(value: string | null | undefined): string {
  const v = (value || '').trim()
  if (v === '') return ''
  const m = v.match(CALENDAR_DAY_RE)
  if (!m) return v
  return `${m[3]}/${m[2]}/${m[1]}`
}

/**
 * Normaliza a ENTRADA de prazo/dia do formulário: aceita apenas 'YYYY-MM-DD'
 * completo. Entrada vazia ou parcial → undefined (não cria prazo, não inventa
 * data). Sem conversão de fuso: o dia escolhido é o dia gravado.
 */
export function calendarDayOrNull(value: string | null | undefined): string | undefined {
  const v = (value || '').trim()
  return CALENDAR_DAY_RE.test(v) ? v : undefined
}

/** Comparação léxica de dias-calendário: -1 | 0 | 1 (inválidos vão por último). */
export function compareCalendarDays(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const av = (a || '').trim()
  const bv = (b || '').trim()
  if (av === bv) return 0
  if (av === '') return 1
  if (bv === '') return -1
  return av < bv ? -1 : 1
}

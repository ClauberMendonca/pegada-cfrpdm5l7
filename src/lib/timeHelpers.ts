// FATIA — REGISTRO DE TEMPO V1: helpers puros de tempo (sem I/O) para serem
// testados por mocks de invariantes (soma/pausa, exclusividade, repetição).

import { TimeEntry } from '@/services/timeService'

/** HH:MM:SS a partir de segundos (valores > 24h não voltam a zero). */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0 min'
  const s = Math.round(totalSeconds)
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, '0')} min`
  }
  if (minutes > 0) {
    return `${minutes} min`
  }
  return `${seconds} s`
}

/** Soma entradas VÁLIDAS (não anuladas, encerradas) sem arredondar por linha. */
export function sumEndedSeconds(entries: TimeEntry[]): number {
  return entries.reduce((acc, e) => {
    if (e.is_deleted) return acc
    if (e.status !== 'ended' && e.status !== 'paused') return acc
    return acc + (Number(e.duration_seconds) || 0)
  }, 0)
}

/** Rótulo de origem para o histórico. */
export function originLabel(entry: TimeEntry): string {
  return entry.origin === 'manual' ? 'Manual/estimado' : 'Cronômetro'
}

/** Rótulo de estado do intervalo. */
export function statusLabel(entry: TimeEntry): string {
  if (entry.status === 'running') return 'Correndo'
  if (entry.status === 'paused') return 'Pausado'
  return 'Encerrado'
}

/** Correção identificável: tem valores anteriores preservados. */
export function isCorrectedEntry(entry: TimeEntry): boolean {
  return Boolean(entry.correction_of) || entry.previous_duration_seconds != null
}

/**
 * Duração corrente derivada dos instantes persistidos (não de ticks):
 * started_at do servidor + relógio local apenas para EXIBIÇÃO.
 */
export function currentRunningSeconds(entry: TimeEntry | null, nowMs: number): number {
  if (!entry || !entry.started_at) return 0
  const startedMs = Date.parse(entry.started_at)
  if (!Number.isFinite(startedMs)) return 0
  return Math.max(0, Math.floor((nowMs - startedMs) / 1000))
}

/** Minutos a partir de horas+minutos informados (entrada manual). */
export function manualMinutesToSeconds(hours: number, minutes: number): number {
  const h = Number.isFinite(hours) ? Math.max(0, Math.floor(hours)) : 0
  const m = Number.isFinite(minutes) ? Math.max(0, Math.floor(minutes)) : 0
  return h * 3600 + m * 60
}

/** Segundos -> horas/minutos para preencher o formulário de correção. */
export function secondsToHoursMinutes(totalSeconds: number): { hours: number; minutes: number } {
  const s = Math.max(0, Math.round(totalSeconds))
  return { hours: Math.floor(s / 3600), minutes: Math.floor((s % 3600) / 60) }
}

/**
 * Invariantes de exclusividade: ao receber 409 already-running, o frontend
 * mostra o ativo e oferece pausar/encerrar — nunca troca em silêncio.
 */
export function shouldOfferActiveTimer(status: number): boolean {
  return status === 409
}

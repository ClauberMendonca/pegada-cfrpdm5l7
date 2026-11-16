// FATIA — REGISTRO DE TEMPO V1: cliente das rotas nativas /backend/v1/time/*.
//
// Regras respeitadas aqui:
// - O DONO é derivado da sessão pelo HOOK (e.auth.id); o payload nunca envia
//   user_id (a atribuição não é escolhida pelo frontend).
// - Idempotência: toda operação gera um op_id estável (crypto.randomUUID) e o
//   servidor deduplica por (user_id, op_id) — repetir a mesma intenção não
//   cria entrada duplicada nem conta duas vezes.
// - Duração encerrada vem dos instantes persistidos no servidor; nunca é
//   recalculada localmente a cada retry.
// - Nenhuma chamada à IA; nenhuma dependência de Manus.

import pb from '@/lib/pocketbase/client'

export type TimeTargetType = 'action' | 'project'

export interface TimeEntry {
  id: string
  user_id?: string
  target_type: TimeTargetType
  action_id: string | null
  project_id: string | null
  context: string
  started_at: string | null
  ended_at?: string | null
  duration_seconds: number
  entry_date: string // YYYY-MM-DD (dia-calendário no fuso do dono)
  origin?: 'timer' | 'manual'
  note?: string | null
  status: 'running' | 'paused' | 'ended'
  correction_of?: string | null
  is_deleted?: boolean
  delete_reason?: string | null
  previous_date?: string | null
  previous_duration_seconds?: number | null
  previous_note?: string | null
  op_id: string
  target_title?: string
  updated?: string | null
}

export interface RunningInfo {
  entry: TimeEntry | null
}

interface RawHookError {
  status?: number
  message?: string
  response?: { message?: string; data?: unknown }
  data?: { message?: string }
}

export class TimeServiceError extends Error {
  status: number
  code: string
  running: { id: string; target_title: string } | null

  constructor(
    message: string,
    status = 500,
    code = 'internal',
    running: { id: string; target_title: string } | null = null,
  ) {
    super(message)
    this.status = status
    this.code = code
    this.running = running
  }
}

const newOpId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

const parseError = (err: unknown): TimeServiceError => {
  const e = err as RawHookError
  const status = e?.status || e?.response?.status || 500
  const message =
    (typeof e?.response?.message === 'string' && e.response.message) ||
    (typeof e?.data?.message === 'string' && e.data.message) ||
    (typeof e?.message === 'string' && e.message) ||
    'Falha na operação de tempo.'
  const code = status === 409 && message.includes('already-running') ? 'already-running' : message
  const running =
    status === 409 &&
    typeof e?.response?.data === 'object' &&
    e.response.data !== null &&
    'running' in (e.response.data as Record<string, unknown>)
      ? ((e.response.data as { running?: { id: string; target_title: string } }).running ?? null)
      : null
  return new TimeServiceError(message, status, code, running)
}

async function callHook<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  try {
    return (await pb.send(path, { method: 'POST', body: payload })) as T
  } catch (err: unknown) {
    throw parseError(err)
  }
}

export const timeService = {
  /** Estado do intervalo correndo do dono (reconciliação pós-foco/reabertura). */
  async getRunning(): Promise<TimeEntry | null> {
    const res = await callHook<{ running: TimeEntry | null }>('/backend/v1/time/running', {})
    return res.running
  },

  /** Inicia intervalo no alvo; 409 already-running carrega o ativo. */
  async start(targetType: TimeTargetType, targetId: string): Promise<TimeEntry> {
    const res = await callHook<{ duplicate: boolean; entry: TimeEntry }>('/backend/v1/time/start', {
      target_type: targetType,
      target_id: targetId,
      op_id: newOpId(),
    })
    return res.entry
  },

  /** Pausa (não soma minutos) ou encerra (consolida o intervalo). */
  async stop(entryId: string, action: 'pause' | 'end'): Promise<TimeEntry> {
    const res = await callHook<{ duplicate: boolean; entry: TimeEntry }>('/backend/v1/time/stop', {
      entry_id: entryId,
      action,
      op_id: newOpId(),
    })
    return res.entry
  },

  /** Retoma intervalo pausado: abre novo período no MESMO alvo (clique explícito). */
  async resume(entryId: string): Promise<TimeEntry> {
    const res = await callHook<{ duplicate: boolean; entry: TimeEntry }>(
      '/backend/v1/time/resume',
      { entry_id: entryId, op_id: newOpId() },
    )
    return res.entry
  },

  /** Registro manual: dia + duração positiva; sem horário inventado. */
  async manual(input: {
    targetType: TimeTargetType
    targetId: string
    entryDate: string
    durationSeconds: number
    note?: string
  }): Promise<TimeEntry> {
    const res = await callHook<{ duplicate: boolean; entry: TimeEntry }>(
      '/backend/v1/time/manual',
      {
        target_type: input.targetType,
        target_id: input.targetId,
        entry_date: input.entryDate,
        duration_seconds: input.durationSeconds,
        note: input.note || '',
        op_id: newOpId(),
      },
    )
    return res.entry
  },

  /** Corrige registro encerrado (mantém valores anteriores p/ conferência). */
  async update(input: {
    entryId: string
    entryDate: string
    durationSeconds: number
    note?: string
    expectedUpdated?: string
  }): Promise<TimeEntry> {
    const res = await callHook<{ duplicate: boolean; entry: TimeEntry }>(
      '/backend/v1/time/update',
      {
        entry_id: input.entryId,
        entry_date: input.entryDate,
        duration_seconds: input.durationSeconds,
        note: input.note || '',
        expected_updated: input.expectedUpdated || '',
        op_id: newOpId(),
      },
    )
    return res.entry
  },

  /** Anulação lógica (nunca apaga fisicamente tempo). */
  async softDelete(entryId: string, reason = ''): Promise<void> {
    await callHook<{ duplicate: boolean; entry: TimeEntry }>('/backend/v1/time/delete', {
      entry_id: entryId,
      reason,
      op_id: newOpId(),
    })
  },

  /**
   * TODAS as entradas válidas de um alvo (sem recortar na primeira página e
   * sem uma chamada por linha): base do total e do histórico.
   */
  async listByTarget(targetType: TimeTargetType, targetId: string): Promise<TimeEntry[]> {
    const filter =
      targetType === 'action' ? `action_id = '${targetId}'` : `project_id = '${targetId}'`
    const res = await pb.collection('time_entries').getFullList<TimeEntry>({
      filter,
      sort: '-entry_date,-created',
    })
    return res
  },
}

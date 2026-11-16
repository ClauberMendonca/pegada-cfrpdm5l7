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
  entry_date: string
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
  target_status?: string
  project_status?: string | null
  updated?: string | null
  resumed_by?: string | null
}
export class TimeServiceError extends Error {
  constructor(
    message: string,
    public status = 500,
    public code = 'internal',
    public running: { id: string; target_title: string } | null = null,
  ) {
    super(message)
  }
}
interface ErrorResponse {
  status?: number
  message?: string
  error?: string
  running?: { id: string; target_title: string }
  data?: { running?: { id: string; target_title: string }; message?: string }
}
function parseError(err: unknown): TimeServiceError {
  const e = err as { status?: number; message?: string; response?: ErrorResponse }
  const r = e?.response
  const status = e?.status || r?.status || 0
  const uncertain = status === 0 || status >= 500 || status === 408
  const message = uncertain
    ? 'Não foi possível confirmar a operação. Confira o cronômetro e o histórico; uma nova confirmação deste mesmo pedido reutilizará sua identidade.'
    : r?.message || e?.message || 'Falha na operação de tempo.'
  return new TimeServiceError(
    message,
    status,
    r?.error || (uncertain ? 'uncertain' : 'rejected'),
    r?.running || r?.data?.running || null,
  )
}

// Persistimos somente hash e UUID: uma resposta perdida/reabertura não cria
// outra identidade. Não guardamos notas em texto nem executamos retry automático.
// A exclusividade entre dispositivos é responsabilidade do servidor.
const identities = new Map<string, string>()
async function operationIdentity(
  path: string,
  body: Record<string, unknown>,
): Promise<{ key: string; id: string }> {
  const owner = pb.authStore.record?.id
  if (!owner || !pb.authStore.isValid)
    throw new TimeServiceError('Entre novamente para registrar tempo.', 401, 'session')
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.randomUUID)
    throw new TimeServiceError(
      'Registro de tempo exige conexão segura e Web Crypto disponível.',
      400,
      'crypto',
    )
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify([owner, path, body])),
  )
  const hash = Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
  const key = `ginga-time-op:${hash}`
  let id = identities.get(key)
  try {
    id = id || localStorage.getItem(key) || undefined
  } catch {
    /* fallback em memória */
  }
  if (!id) {
    id = crypto.randomUUID()
    try {
      localStorage.setItem(key, id)
    } catch {
      /* conserva identidade nesta sessão */
    }
  }
  identities.set(key, id)
  return { key, id }
}
function forget(key: string) {
  identities.delete(key)
  try {
    localStorage.removeItem(key)
  } catch {
    /* sem alteração do registro persistido */
  }
}
async function mutate(path: string, body: Record<string, unknown>): Promise<TimeEntry> {
  const intent = await operationIdentity(path, body)
  try {
    const res = await pb.send<{ entry: TimeEntry; duplicate: boolean }>(path, {
      method: 'POST',
      body: { ...body, op_id: intent.id },
    })
    if (!res?.entry?.id)
      throw new TimeServiceError('Resposta de tempo sem confirmação.', 502, 'uncertain')
    forget(intent.key)
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('ginga-time-changed'))
      try {
        localStorage.setItem('ginga-time-refresh', crypto.randomUUID())
      } catch {
        /* sinal entre abas opcional */
      }
    }
    return res.entry
  } catch (err) {
    const e = err instanceof TimeServiceError ? err : parseError(err)
    if ([400, 401, 403, 404, 422].includes(e.status)) forget(intent.key)
    throw e
  }
}
function ownedFilter(field: string, id: string, extra = ''): string {
  const owner = pb.authStore.record?.id
  if (!owner || !pb.authStore.isValid) throw new TimeServiceError('Sessão ausente.', 401, 'session')
  return pb.filter(`user_id = {:owner} && ${field} = {:id}${extra}`, { owner, id })
}
export const timeService = {
  async getRunning(): Promise<TimeEntry | null> {
    try {
      const res = await pb.send<{ running: TimeEntry | null }>('/backend/v1/time/running', {
        method: 'POST',
        body: {},
      })
      if (!res || !Object.prototype.hasOwnProperty.call(res, 'running'))
        throw new TimeServiceError('Estado do cronômetro sem confirmação.', 502, 'uncertain')
      return res.running
    } catch (err) {
      throw err instanceof TimeServiceError ? err : parseError(err)
    }
  },
  start(targetType: TimeTargetType, targetId: string): Promise<TimeEntry> {
    return mutate('/backend/v1/time/start', { target_type: targetType, target_id: targetId })
  },
  stop(entryId: string, action: 'pause' | 'end'): Promise<TimeEntry> {
    return mutate('/backend/v1/time/stop', { entry_id: entryId, action })
  },
  resume(entryId: string): Promise<TimeEntry> {
    return mutate('/backend/v1/time/resume', { entry_id: entryId })
  },
  manual(input: {
    targetType: TimeTargetType
    targetId: string
    entryDate: string
    durationSeconds: number
    note?: string
  }): Promise<TimeEntry> {
    return mutate('/backend/v1/time/manual', {
      target_type: input.targetType,
      target_id: input.targetId,
      entry_date: input.entryDate,
      duration_seconds: input.durationSeconds,
      note: input.note || '',
    })
  },
  update(input: {
    entryId: string
    entryDate: string
    durationSeconds: number
    note?: string
    expectedUpdated?: string
  }): Promise<TimeEntry> {
    return mutate('/backend/v1/time/update', {
      entry_id: input.entryId,
      entry_date: input.entryDate,
      duration_seconds: input.durationSeconds,
      note: input.note || '',
      expected_updated: input.expectedUpdated || '',
    })
  },
  async softDelete(entryId: string, reason = ''): Promise<void> {
    await mutate('/backend/v1/time/delete', { entry_id: entryId, reason })
  },
  async listByTarget(targetType: TimeTargetType, targetId: string): Promise<TimeEntry[]> {
    const field = targetType === 'action' ? 'action_id' : 'project_id'
    const extra = targetType === 'project' ? " && target_type = 'project'" : ''
    return pb
      .collection('time_entries')
      .getFullList<TimeEntry>({
        filter: ownedFilter(field, targetId, extra),
        sort: '-entry_date,-created',
      })
  },
  async listByProject(projectId: string): Promise<TimeEntry[]> {
    return pb
      .collection('time_entries')
      .getFullList<TimeEntry>({
        filter: ownedFilter('project_id', projectId),
        sort: '-entry_date,-created',
      })
  },
  async listByActions(actionIds: string[]): Promise<TimeEntry[]> {
    if (!actionIds.length) return []
    const owner = pb.authStore.record?.id
    if (!owner || !pb.authStore.isValid)
      throw new TimeServiceError('Sessão ausente.', 401, 'session')
    const parameters: Record<string, string> = { owner }
    const clauses = [...new Set(actionIds)].map((id, i) => {
      parameters[`a${i}`] = id
      return `action_id = {:a${i}}`
    })
    return pb
      .collection('time_entries')
      .getFullList<TimeEntry>({
        filter: pb.filter(`user_id = {:owner} && (${clauses.join(' || ')})`, parameters),
        sort: '-entry_date,-created',
      })
  },
}

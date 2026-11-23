import pb from '@/lib/pocketbase/client'
import { ActionItem, ActionKind, EntityContext, ActionStatus } from '@/types/execution'
import { op, lote, LoteItem, RegraError } from '@/lib/pegada/api'
import { pedirRastro, TipoComRastro } from '@/lib/pegada/rastro'

export interface CreateActionInput {
  title: string
  /** PEGADA — um dos seis tipos de avanço. Padrão: 'acao'. */
  kind?: ActionKind
  /** PEGADA — rastro (conclusão/decisão/destino) de Estudo, Reflexão e Ideia. */
  trail?: string
  context: EntityContext
  /** DESCRIÇÃO OPCIONAL: texto livre de notas/orientações (não é waiting_for). */
  description?: string
  project_id?: string
  /**
   * FATIA 3C1 — SOMENTE vínculo DIRETO do Avanço SOLTO (sem project_id), mesmo
   * contrato de ActionItem.responsibility_id. Avanço subordinado envia ''
   * explícito no MESMO patch que define/limpa project_id (nunca herança
   * copiada). Outros métodos (status/foco) continuam OMITINDO este campo.
   */
  responsibility_id?: string
  /**
   * FATIA 4B2 — Estratégia OPCIONAL (0..1) do MESMO Resultado do Avanço.
   * NOVO AVANÇO / Nenhuma envia ''; REMOÇÃO explícita na edição envia '';
   * manter o vínculo persistido OMITE o campo; escolha nova envia o ID nativo.
   * Avanço solto (sem project_id) envia '' — nunca ID de outro pai. Outros
   * métodos (status/Hoje/nextstep) continuam OMITINDO este campo.
   */
  strategy_id?: string
  /**
   * FATIA 5A — AGENDAMENTO SIMPLES (persistência de intenção, sem tela):
   * planejamento LOCAL do Avanço. Omissão no update PRESERVA o planejamento;
   * enviar '' limpa explicitamente aquele campo. Grupo coerente: com data o
   * fuso é obrigatório; hora/fuso sem data é recusado pela guarda de modelo.
   * Strings tipadas — nunca null; nenhum default de Hoje/UTC/fuso do perfil.
   */
  planned_date?: string
  planned_time?: string
  planned_timezone?: string
  status?: ActionStatus
  deadline?: string
  is_next_step?: boolean
  is_today_selected?: boolean
  waiting_for?: string
}

export type UpdateActionInput = Partial<CreateActionInput>

// PEGADA — todas as escritas passam pela API do método (/backend/v1/pegada).
// As assinaturas foram mantidas para as telas existentes continuarem iguais.

const EXPAND = { expand: 'project_id,project_id.responsibility_id,strategy_id,responsibility_id' }

export const notificarMudanca = () => window.dispatchEvent(new Event('pegada:mudou'))

function linkInput(data: UpdateActionInput): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (data.project_id !== undefined) out.resultado_id = data.project_id
  if (data.strategy_id !== undefined) out.estrategia_id = data.strategy_id
  if (data.responsibility_id !== undefined) out.responsabilidade_id = data.responsibility_id
  if (data.context !== undefined) out.contexto = data.context
  return Object.keys(out).length ? out : null
}

function editInput(data: UpdateActionInput): Record<string, unknown> | null {
  const out: Record<string, unknown> = {}
  if (data.title !== undefined) out.titulo = data.title
  if (data.kind !== undefined) out.tipo = data.kind
  if (data.description !== undefined) out.descricao = data.description
  if (data.deadline !== undefined) out.prazo = data.deadline
  if (data.planned_date !== undefined) out.data_planejada = data.planned_date
  if (data.planned_time !== undefined) out.hora_planejada = data.planned_time
  if (data.waiting_for !== undefined) out.aguardando = data.waiting_for
  return Object.keys(out).length ? out : null
}

function statusOps(current: ActionItem, status: ActionStatus, reason?: string): LoteItem[] {
  const id = current.id
  if (status === current.status) return []
  if (status === 'feita')
    return [{ op: 'concluir_avanco', entrada: { avanco_id: id, rastro: reason } }]
  if (status === 'cancelada')
    return [{ op: 'cancelar_avanco', entrada: { avanco_id: id, motivo: reason } }]
  const ops: LoteItem[] = []
  if (current.status === 'feita' || current.status === 'cancelada') {
    ops.push({ op: 'reabrir_avanco', entrada: { avanco_id: id } })
  }
  if (status !== 'pronta' || ops.length === 0) {
    ops.push({
      op: 'mudar_situacao_avanco',
      entrada: { avanco_id: id, situacao: status, motivo: reason },
    })
  }
  return ops
}

/** Conclui pedindo o rastro quando a regra exigir (Estudo, Reflexão, Ideia). */
async function concluir(action: ActionItem, rastro?: string, desfazer = true): Promise<void> {
  try {
    await op(
      'concluir_avanco',
      { avanco_id: action.id, rastro },
      { desfazer, onDesfeito: notificarMudanca },
    )
  } catch (err) {
    if (err instanceof RegraError && err.regra === 'REGRA_DO_RASTRO') {
      const texto = await pedirRastro((action.kind || 'estudo') as TipoComRastro, action.title)
      if (!texto) throw new Error('Conclusão cancelada: falta o rastro.')
      await op(
        'concluir_avanco',
        { avanco_id: action.id, rastro: texto },
        { desfazer, onDesfeito: notificarMudanca },
      )
      return
    }
    throw err
  }
}

export const actionService = {
  async list(contextFilter?: EntityContext, projectId?: string): Promise<ActionItem[]> {
    const filters: string[] = []
    if (contextFilter) {
      filters.push(`context = '${contextFilter}'`)
    }
    if (projectId) {
      filters.push(`project_id = '${projectId}'`)
    }
    const filter = filters.length > 0 ? filters.join(' && ') : ''
    return pb.collection('actions').getFullList<ActionItem>({
      filter,
      sort: '-is_next_step,-is_today_selected,-created',
      ...EXPAND,
    })
  },

  async getById(id: string): Promise<ActionItem> {
    return pb.collection('actions').getOne<ActionItem>(id, EXPAND)
  },

  async create(data: CreateActionInput): Promise<ActionItem> {
    const res = await op<{ avanco_id: string }>('criar_avanco', {
      titulo: data.title,
      tipo: data.kind || 'acao',
      resultado_id: data.project_id || undefined,
      estrategia_id: data.strategy_id || undefined,
      responsabilidade_id: data.project_id ? undefined : data.responsibility_id || undefined,
      contexto: data.context,
      descricao: data.description || undefined,
      prazo: data.deadline || undefined,
      data_planejada: data.planned_date || undefined,
      hora_planejada: data.planned_time || undefined,
      aguardando: data.waiting_for || undefined,
      para_hoje: data.is_today_selected === true,
      principal: data.is_next_step === true,
    })
    const id = res.resultado!.avanco_id
    if (data.status && data.status !== 'pronta' && data.status !== 'aguardando') {
      const created = await actionService.getById(id)
      const ops = statusOps(created, data.status, data.waiting_for)
      if (ops.length) await lote(ops)
    }
    return actionService.getById(id)
  },

  async update(id: string, data: UpdateActionInput): Promise<ActionItem> {
    const current = await actionService.getById(id)
    const ops: LoteItem[] = []
    const edit = editInput(data)
    if (edit) ops.push({ op: 'editar_avanco', entrada: { avanco_id: id, ...edit } })
    const links = linkInput(data)
    if (links) ops.push({ op: 'ligar_avanco', entrada: { avanco_id: id, ...links } })
    if (
      data.is_today_selected !== undefined &&
      data.is_today_selected !== current.is_today_selected
    ) {
      ops.push({
        op: 'escolher_para_hoje',
        entrada: { avanco_id: id, hoje: data.is_today_selected },
      })
    }
    if (data.is_next_step === true && !current.is_next_step) {
      ops.push({ op: 'definir_avanco_principal', entrada: { avanco_id: id } })
    } else if (data.is_next_step === false && current.is_next_step) {
      ops.push({ op: 'definir_avanco_principal', entrada: { avanco_id: '' } })
    }
    let concluirDepois = false
    if (data.status !== undefined && data.status !== current.status) {
      if (data.status === 'feita') concluirDepois = true
      else ops.push(...statusOps(current, data.status, data.waiting_for))
    }
    if (ops.length) await lote(ops)
    if (concluirDepois) await concluir(await actionService.getById(id), data.trail, false)
    return actionService.getById(id)
  },

  async setAsNextStep(id: string): Promise<ActionItem> {
    await op(
      'definir_avanco_principal',
      { avanco_id: id },
      { desfazer: true, onDesfeito: notificarMudanca },
    )
    return actionService.getById(id)
  },

  async unsetNextStep(id: string): Promise<ActionItem> {
    const current = await actionService.getById(id)
    if (current.is_next_step) {
      await op(
        'definir_avanco_principal',
        { avanco_id: '' },
        { desfazer: true, onDesfeito: notificarMudanca },
      )
    }
    return actionService.getById(id)
  },

  async setTodaySelected(id: string, selected: boolean): Promise<ActionItem> {
    await op(
      'escolher_para_hoje',
      { avanco_id: id, hoje: selected },
      { desfazer: true, onDesfeito: notificarMudanca },
    )
    return actionService.getById(id)
  },

  async updateStatus(id: string, status: ActionStatus, reason?: string): Promise<ActionItem> {
    const current = await actionService.getById(id)
    if (status === 'feita') {
      await concluir(current, reason)
    } else {
      const ops = statusOps(current, status, reason)
      if (ops.length === 1) {
        await op(ops[0].op, ops[0].entrada, { desfazer: true, onDesfeito: notificarMudanca })
      } else if (ops.length > 1) {
        await lote(ops)
      }
    }
    return actionService.getById(id)
  },

  async clearAllNextSteps(): Promise<void> {
    await op('definir_avanco_principal', { avanco_id: '' })
  },
}

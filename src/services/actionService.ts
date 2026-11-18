import pb from '@/lib/pocketbase/client'
import { ActionItem, EntityContext, ActionStatus } from '@/types/execution'

export interface CreateActionInput {
  title: string
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
      expand: 'project_id',
    })
  },

  async getById(id: string): Promise<ActionItem> {
    return pb.collection('actions').getOne<ActionItem>(id, {
      expand: 'project_id',
    })
  },

  async create(data: CreateActionInput): Promise<ActionItem> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')

    // If marked as is_next_step, unmark previous next_steps first to ensure singular next step
    if (data.is_next_step) {
      await actionService.clearAllNextSteps()
    }

    return pb.collection('actions').create<ActionItem>(
      {
        user_id: userId,
        status: data.status || 'pronta',
        is_next_step: data.is_next_step ?? false,
        is_today_selected: data.is_today_selected ?? (data.is_next_step ? true : false),
        ...data,
      },
      {
        expand: 'project_id',
      },
    )
  },

  async update(id: string, data: UpdateActionInput): Promise<ActionItem> {
    if (data.is_next_step) {
      await actionService.clearAllNextSteps(id)
    }
    return pb.collection('actions').update<ActionItem>(id, data, {
      expand: 'project_id',
    })
  },

  async setAsNextStep(id: string): Promise<ActionItem> {
    await actionService.clearAllNextSteps(id)
    return pb.collection('actions').update<ActionItem>(
      id,
      {
        is_next_step: true,
        is_today_selected: true,
      },
      {
        expand: 'project_id',
      },
    )
  },

  async unsetNextStep(id: string): Promise<ActionItem> {
    return pb.collection('actions').update<ActionItem>(
      id,
      {
        is_next_step: false,
      },
      {
        expand: 'project_id',
      },
    )
  },

  async setTodaySelected(id: string, selected: boolean): Promise<ActionItem> {
    return pb.collection('actions').update<ActionItem>(
      id,
      {
        is_today_selected: selected,
      },
      {
        expand: 'project_id',
      },
    )
  },

  async updateStatus(id: string, status: ActionStatus, reason?: string): Promise<ActionItem> {
    const data: Record<string, unknown> = { status }
    if (status === 'aguardando' || status === 'bloqueada') {
      data.waiting_for = reason || ''
    }
    return pb.collection('actions').update<ActionItem>(id, data, {
      expand: 'project_id',
    })
  },

  async clearAllNextSteps(exceptId?: string): Promise<void> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')
    const nextSteps = await pb.collection('actions').getFullList<ActionItem>({
      filter: `is_next_step = true && user_id = '${userId}'`,
    })
    for (const action of nextSteps) {
      if (exceptId && action.id === exceptId) continue
      await pb.collection('actions').update<ActionItem>(action.id, {
        is_next_step: false,
      })
    }
  },
}

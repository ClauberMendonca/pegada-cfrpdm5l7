import pb from '@/lib/pocketbase/client'
import { ActionItem, EntityContext, ActionStatus } from '@/types/execution'

export interface CreateActionInput {
  title: string
  context: EntityContext
  project_id?: string
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
    return pb.collection('actions').update<ActionItem>(id, {
      is_next_step: false,
    })
  },

  async setTodaySelected(id: string, selected: boolean): Promise<ActionItem> {
    const patch: Partial<ActionItem> = {
      is_today_selected: selected,
    }
    if (!selected) {
      patch.is_next_step = false
    }
    return pb.collection('actions').update<ActionItem>(id, patch, {
      expand: 'project_id',
    })
  },

  async updateStatus(id: string, status: ActionStatus, waiting_for?: string): Promise<ActionItem> {
    const patch: Record<string, unknown> = { status }
    if (waiting_for !== undefined) {
      patch.waiting_for = waiting_for
    }
    // Note: Concluir uma ação NÃO encerra o projeto nem dá o resultado como garantido
    if (status === 'feita' || status === 'cancelada') {
      patch.is_next_step = false
      patch.is_today_selected = false
    }
    return pb.collection('actions').update<ActionItem>(id, patch, {
      expand: 'project_id',
    })
  },

  async clearAllNextSteps(exceptId?: string): Promise<void> {
    const list = await pb.collection('actions').getFullList<ActionItem>({
      filter: `is_next_step = true`,
    })
    for (const item of list) {
      if (item.id !== exceptId) {
        await pb.collection('actions').update(item.id, { is_next_step: false })
      }
    }
  },
}

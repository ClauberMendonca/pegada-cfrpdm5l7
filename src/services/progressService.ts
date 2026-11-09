import pb from '@/lib/pocketbase/client'
import { ProgressLog, ProgressLogType } from '@/types/execution'

export interface CreateProgressLogInput {
  project_id?: string
  action_id?: string
  text: string
  log_type: ProgressLogType
  date?: string // YYYY-MM-DD
}

export const progressService = {
  async listByProject(projectId: string): Promise<ProgressLog[]> {
    return pb.collection('progress_logs').getFullList<ProgressLog>({
      filter: `project_id = '${projectId}'`,
      sort: '-date,-created',
      expand: 'action_id',
    })
  },

  async listByAction(actionId: string): Promise<ProgressLog[]> {
    return pb.collection('progress_logs').getFullList<ProgressLog>({
      filter: `action_id = '${actionId}'`,
      sort: '-date,-created',
      expand: 'project_id',
    })
  },

  async listRecent(limit = 20): Promise<ProgressLog[]> {
    const res = await pb.collection('progress_logs').getList<ProgressLog>(1, limit, {
      sort: '-date,-created',
      expand: 'project_id,action_id',
    })
    return res.items
  },

  async create(data: CreateProgressLogInput): Promise<ProgressLog> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')

    const todayStr = new Date().toISOString().split('T')[0]
    return pb.collection('progress_logs').create<ProgressLog>(
      {
        user_id: userId,
        date: data.date || todayStr,
        ...data,
      },
      {
        expand: 'project_id,action_id',
      },
    )
  },
}

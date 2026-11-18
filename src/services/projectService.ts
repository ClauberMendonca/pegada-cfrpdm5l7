import pb from '@/lib/pocketbase/client'
import { Project, EntityContext, ProjectStatus } from '@/types/execution'

export interface CreateProjectInput {
  title: string
  context: EntityContext
  status?: ProjectStatus
  aspiration?: string
  controllable_delivery?: string
  completion_condition?: string
  deadline?: string
  learning_asset?: string
  r_resultado?: string
  r_razao?: string
  r_referencia?: string
  r_rumo?: string
  r_recursos?: string
  r_restricoes?: string
  r_riscos?: string
  r_responsavel?: string
  /** FATIA 3C1 — vínculo opcional com Responsabilidade: ID nativo; '' remove;
     OMITIR (undefined) em update mantém o vínculo atual. */
  responsibility_id?: string
}

export type UpdateProjectInput = Partial<CreateProjectInput>

export const projectService = {
  async list(contextFilter?: EntityContext, statusFilter?: ProjectStatus): Promise<Project[]> {
    const filters: string[] = []
    if (contextFilter) {
      filters.push(`context = '${contextFilter}'`)
    }
    if (statusFilter) {
      filters.push(`status = '${statusFilter}'`)
    }
    const filter = filters.length > 0 ? filters.join(' && ') : ''
    return pb.collection('projects').getFullList<Project>({
      filter,
      sort: '-created',
    })
  },

  async getById(id: string): Promise<Project> {
    return pb.collection('projects').getOne<Project>(id)
  },

  async create(data: CreateProjectInput): Promise<Project> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')

    return pb.collection('projects').create<Project>({
      user_id: userId,
      status: data.status || 'rascunho',
      ...data,
    })
  },

  async update(id: string, data: UpdateProjectInput): Promise<Project> {
    return pb.collection('projects').update<Project>(id, data)
  },

  async archive(id: string): Promise<Project> {
    return pb.collection('projects').update<Project>(id, { status: 'arquivado' })
  },

  async complete(id: string): Promise<Project> {
    return pb.collection('projects').update<Project>(id, { status: 'concluido' })
  },

  async activate(id: string): Promise<Project> {
    return pb.collection('projects').update<Project>(id, { status: 'ativo' })
  },

  async pause(id: string): Promise<Project> {
    return pb.collection('projects').update<Project>(id, { status: 'pausado' })
  },
}

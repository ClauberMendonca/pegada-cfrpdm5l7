/**
 * 4B1 — Serviço cliente de Estratégias sobre a API nativa da coleção
 * `strategies` (migration 0012). Nenhum endpoint novo.
 * - listByProject: getFullList do dono da sessão + project_id EXATO, todos os
 *   estados, ordem estável created,id. Sem IN, sem N+1, sem primeira página.
 * - create: user_id da sessão + Resultado confirmado pelo chamador, status 'ativa'.
 * - update: SOMENTE title/description informados (descrição vazia envia '').
 * - setStatus: SOMENTE status. Nenhum delete.
 * O backend (guardas 4A) é a autoridade; aqui não há regra de negócio extra.
 */
import pb from '@/lib/pocketbase/client'
import { Strategy, StrategyStatus } from '@/types/execution'

export interface CreateStrategyInput {
  title: string
  description?: string
}

export interface UpdateStrategyInput {
  title?: string
  description?: string
}

/** Literal de filtro PocketBase com escape de aspas e barras invertidas. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export const strategyService = {
  /** Lista completa das Estratégias do Resultado para o dono da sessão. */
  async listByProject(projectId: string): Promise<Strategy[]> {
    const userId = pb.authStore.model?.id
    if (!userId || !projectId) return []
    return pb.collection('strategies').getFullList<Strategy>({
      filter: `user_id = ${quote(userId)} && project_id = ${quote(projectId)}`,
      sort: 'created,id',
    })
  },

  /** Criação: dono da sessão, Resultado confirmado, status inicial 'ativa'. */
  async create(projectId: string, data: CreateStrategyInput): Promise<Strategy> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')
    return pb.collection('strategies').create<Strategy>({
      user_id: userId,
      project_id: projectId,
      title: data.title,
      description: data.description ?? '',
      status: 'ativa',
    })
  },

  /** Edição: envia somente os campos informados (nunca dono/Resultado/status). */
  async update(id: string, data: UpdateStrategyInput): Promise<Strategy> {
    const patch: Record<string, string> = {}
    if (data.title !== undefined) patch.title = data.title
    if (data.description !== undefined) patch.description = data.description
    return pb.collection('strategies').update<Strategy>(id, patch)
  },

  /** Arquivar/reativar: comando explícito que muda SOMENTE o status. */
  async setStatus(id: string, status: StrategyStatus): Promise<Strategy> {
    return pb.collection('strategies').update<Strategy>(id, { status })
  },
}

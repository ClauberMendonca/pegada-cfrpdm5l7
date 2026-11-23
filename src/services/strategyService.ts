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
import { op } from '@/lib/pegada/api'

export interface CreateStrategyInput {
  title: string
  description?: string
  /** PEGADA — sinal de teste da aposta. */
  test_signal?: string
}

export interface UpdateStrategyInput {
  title?: string
  description?: string
  test_signal?: string
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

  /** PEGADA — escrita pela API do método. */
  async create(projectId: string, data: CreateStrategyInput): Promise<Strategy> {
    const res = await op<{ estrategia_id: string }>('criar_estrategia', {
      resultado_id: projectId,
      titulo: data.title,
      descricao: data.description ?? '',
      sinal_de_teste: data.test_signal,
    })
    return pb.collection('strategies').getOne<Strategy>(res.resultado!.estrategia_id)
  },

  async update(id: string, data: UpdateStrategyInput): Promise<Strategy> {
    const entrada: Record<string, unknown> = { estrategia_id: id }
    if (data.title !== undefined) entrada.titulo = data.title
    if (data.description !== undefined) entrada.descricao = data.description
    if (data.test_signal !== undefined) entrada.sinal_de_teste = data.test_signal
    await op('editar_estrategia', entrada)
    return pb.collection('strategies').getOne<Strategy>(id)
  },

  async setStatus(id: string, status: StrategyStatus): Promise<Strategy> {
    await op('arquivar_estrategia', { estrategia_id: id, reativar: status === 'ativa' })
    return pb.collection('strategies').getOne<Strategy>(id)
  },
}

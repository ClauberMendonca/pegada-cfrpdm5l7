/**
 * ENTREGA 3B — Serviço cliente de Responsabilidades sobre a API existente
 * (fatia 3A: coleção responsibilities + relations projects/actions).
 * NENHUM backend novo, nenhuma exclusão definitiva (deleteRule locked):
 * arquivar/desarquivar é somente via status. Dono SEMPRE da sessão
 * autenticada (nunca de campo editável/URL); os guardas de modelo do backend
 * são a autoridade — os filtros de dono aqui complementam as regras.
 *
 * Escrita mínima e explícita:
 * - criar envia title/description/context/status='ativa' (+ user_id derivado
 *   da sessão, padrão existente — nunca valor arbitrário do formulário);
 * - editar envia SOMENTE title/description/context;
 * - arquivar/reativar envia SOMENTE status.
 * Nenhum spread de IDs/created/updated, filhos ou outros campos.
 */
import pb from '@/lib/pocketbase/client'
import { Responsibility, ResponsibilityStatus } from '@/types/execution'
import { op } from '@/lib/pegada/api'

export interface CreateResponsibilityInput {
  title: string
  description?: string
  context: 'vida' | 'trabalho'
  /** PEGADA — escolhida por mim ou para mim. */
  chosen_by?: 'mim' | 'para_mim'
}

export interface UpdateResponsibilityInput {
  chosen_by?: 'mim' | 'para_mim'
  title?: string
  description?: string
  context?: 'vida' | 'trabalho'
}

export interface ListResponsibilitiesInput {
  /** Contexto global da sessão (vida/trabalho) — undefined = Todos. */
  context?: 'vida' | 'trabalho'
}

export const responsibilityService = {
  /** Lista completa do dono (getFullList: nunca tratar 1ª página como tudo). */
  async list(input?: ListResponsibilitiesInput): Promise<Responsibility[]> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')

    const filters: string[] = [`user_id = "${userId}"`]
    if (input?.context === 'vida' || input?.context === 'trabalho') {
      filters.push(`context = "${input.context}"`)
    }
    return pb.collection('responsibilities').getFullList<Responsibility>({
      filter: filters.join(' && '),
      sort: '-created',
    })
  },

  /** Leitura autenticada por ID nativo (ficha retomável /?id=ID). */
  async getById(id: string): Promise<Responsibility> {
    return pb.collection('responsibilities').getOne<Responsibility>(id)
  },

  /** PEGADA — criação pela API do método (status inicial 'ativa'). */
  async create(data: CreateResponsibilityInput): Promise<Responsibility> {
    const res = await op<{ responsabilidade_id: string }>('criar_responsabilidade', {
      titulo: data.title,
      descricao: data.description ?? '',
      contexto: data.context,
      escolhida_por: data.chosen_by,
    })
    return responsibilityService.getById(res.resultado!.responsabilidade_id)
  },

  async update(id: string, data: UpdateResponsibilityInput): Promise<Responsibility> {
    const entrada: Record<string, unknown> = { responsabilidade_id: id }
    if (data.title !== undefined) entrada.titulo = data.title
    if (data.description !== undefined) entrada.descricao = data.description
    if (data.context !== undefined) entrada.contexto = data.context
    if (data.chosen_by !== undefined) entrada.escolhida_por = data.chosen_by
    await op('editar_responsabilidade', entrada)
    return responsibilityService.getById(id)
  },

  async setStatus(id: string, status: ResponsibilityStatus): Promise<Responsibility> {
    await op('arquivar_responsabilidade', { responsabilidade_id: id, reativar: status === 'ativa' })
    return responsibilityService.getById(id)
  },
}

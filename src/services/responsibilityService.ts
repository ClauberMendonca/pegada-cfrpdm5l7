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

export interface CreateResponsibilityInput {
  title: string
  description?: string
  context: 'vida' | 'trabalho'
}

export interface UpdateResponsibilityInput {
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

  /** Criação pelo contrato da 3A; status inicial sempre 'ativa'. */
  async create(data: CreateResponsibilityInput): Promise<Responsibility> {
    const userId = pb.authStore.model?.id
    if (!userId) throw new Error('Usuário não autenticado')

    return pb.collection('responsibilities').create<Responsibility>({
      user_id: userId,
      title: data.title,
      description: data.description ?? '',
      context: data.context,
      status: 'ativa',
    })
  },

  /** Edição envia SOMENTE title/description/context (nunca user_id/status). */
  async update(id: string, data: UpdateResponsibilityInput): Promise<Responsibility> {
    const patch: Record<string, string> = {}
    if (data.title !== undefined) patch.title = data.title
    if (data.description !== undefined) patch.description = data.description
    if (data.context !== undefined) patch.context = data.context
    return pb.collection('responsibilities').update<Responsibility>(id, patch)
  },

  /** Arquivar/reativar: comando explícito que muda SOMENTE o status. */
  async setStatus(id: string, status: ResponsibilityStatus): Promise<Responsibility> {
    return pb.collection('responsibilities').update<Responsibility>(id, { status })
  },
}

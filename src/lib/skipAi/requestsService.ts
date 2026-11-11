// FATIA M1B1 — leitura read-only de pedidos locais do copiloto.
//
// Fonte ÚNICA de dados: a coleção ai_requests via API padrão do banco
// (getList/getFullList do cliente PocketBase). NÃO chama /backend/v1/ai/*:
// o GET de requests pode sincronizar com o remoto quando o gate estiver ON,
// e esta fatia permanece com integração desligada.
//
// O filtro por user_id é DEFESA EXTRA no frontend — a autorização real é a
// regra nativa da coleção (listRule/viewRule user_id = @request.auth.id).
// Sem sessão autenticada, este serviço NÃO consulta.

import pb from '@/lib/pocketbase/client'
import type { EntityContext } from '@/types/execution'
import type { AiRequestRecord } from './types'

export interface ListAiRequestsInput {
  originId: string
  context: EntityContext
  /** ID do usuário autenticado; ausente ⇒ não consulta (retorna null). */
  userId: string | undefined
}

export interface ListAiRequestsResult {
  ok: boolean
  requests: AiRequestRecord[]
  error: string
}

/**
 * Lista pedidos locais de uma captura em um contexto, do mais recente ao mais
 * antigo (-created). Falha de leitura é retornada (não lançada) para o painel
 * mostrar erro local com "Tentar novamente" — nenhum endpoint alternativo.
 */
export async function listAiRequestsForCapture(
  input: ListAiRequestsInput,
): Promise<ListAiRequestsResult> {
  if (!input.userId) {
    return {
      ok: false,
      requests: [],
      error: 'Sem sessão autenticada — consulta local não realizada.',
    }
  }
  try {
    const requests = await pb.collection('ai_requests').getFullList<AiRequestRecord>({
      filter:
        `origin_type = 'captura' && ` +
        `origin_id = '${input.originId.replace(/'/g, "''")}' && ` +
        `context = '${input.context}' && ` +
        `user_id = '${input.userId.replace(/'/g, "''")}'`,
      sort: '-created',
    })
    return { ok: true, requests, error: '' }
  } catch (err: unknown) {
    const msg =
      err instanceof Error && err.message
        ? err.message
        : 'Falha ao consultar registros locais do copiloto.'
    return { ok: false, requests: [], error: msg }
  }
}

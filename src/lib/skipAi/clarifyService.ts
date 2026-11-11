// M1B2a — apenas comando explícito de esclarecimento; não ativa a integração.
// Nunca chamar este serviço no mount, em efeito, seleção ou consulta local.
import pb from '@/lib/pocketbase/client'
import type { CaptureItem, EntityContext } from '@/types/execution'
import type { AiRequestRecord } from './types'

export interface ClarifyIntent {
  userId: string
  captureId: string
  context: EntityContext
  revision: string
  localRequestId: string
  rawText: string
}

export type ClarifyOutcome =
  | { kind: 'confirmed'; message: string; request: AiRequestRecord; duplicate: boolean }
  | { kind: 'existing'; message: string; request: AiRequestRecord }
  | { kind: 'uncertain'; message: string; request?: AiRequestRecord }
  | { kind: 'unavailable'; message: string }
  | { kind: 'blocked'; message: string }

// Mesmo ID não inicia outro POST nesta sessão, mesmo após fechar o diálogo.
// A reserva e a deduplicação duráveis continuam sendo responsabilidade do backend.
const submissions = new Map<string, Promise<ClarifyOutcome>>()

export async function prepareClarifyIntent(
  capture: CaptureItem,
  context: EntityContext,
  userId: string,
): Promise<ClarifyIntent> {
  if (!userId || pb.authStore.model?.id !== userId)
    throw new Error('Sessão inválida; entre novamente.')
  if (!capture.id || capture.status !== 'pendente')
    throw new Error('A captura não está disponível para esclarecimento.')
  if (context !== 'vida' && context !== 'trabalho') throw new Error('Escolha Vida ou Trabalho.')
  if (typeof capture.raw_text !== 'string' || typeof capture.updated !== 'string') {
    throw new Error('Não foi possível conferir a revisão da captura.')
  }
  if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
    throw new Error('O envio requer conexão segura e suporte a Web Crypto.')
  }
  const revision = capture.raw_text + '|' + capture.updated
  // JSON de array fixo evita ambiguidades entre campos. NÃO usar ID aleatório,
  // trim, Date.now, nonce por clique ou mudar esta versão sem decisão explícita.
  const identity = JSON.stringify(['clarify-intent-v1', userId, capture.id, context, revision])
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(identity),
  )
  const localRequestId =
    'clarify-v1-' +
    Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return {
    userId,
    captureId: capture.id,
    context,
    revision,
    localRequestId,
    rawText: capture.raw_text,
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseOutcome(value: unknown, intent: ClarifyIntent): ClarifyOutcome {
  if (!object(value) || typeof value.duplicate !== 'boolean' || !object(value.request)) {
    return {
      kind: 'uncertain',
      message: 'Não foi possível confirmar o pedido. Não reenviar; confira os registros locais.',
    }
  }
  const r = value.request
  if (
    typeof r.id !== 'string' ||
    !r.id.trim() ||
    r.user_id !== intent.userId ||
    r.origin_type !== 'captura' ||
    r.origin_id !== intent.captureId ||
    r.origin_revision !== intent.revision ||
    r.context !== intent.context ||
    r.local_request_id !== intent.localRequestId ||
    typeof r.state !== 'string'
  ) {
    return {
      kind: 'uncertain',
      message: 'A identidade do pedido não pôde ser confirmada. Não reenviar.',
    }
  }
  const request = r as unknown as AiRequestRecord
  const linked = typeof r.remote_task_id === 'string' && r.remote_task_id.trim() !== ''
  if (r.state === 'registrado' || r.state === 'criacao_incerta') {
    return {
      kind: 'uncertain',
      message: 'Criação sem confirmação. Não reenviar; confira os registros locais.',
      request,
    }
  }
  if (linked && r.state === 'em_execucao') {
    return {
      kind: 'confirmed',
      message: value.duplicate
        ? 'Pedido já existente no Manus; nenhuma nova tarefa criada.'
        : 'Tarefa criada no Manus. O resultado ainda não foi acompanhado.',
      request,
      duplicate: value.duplicate,
    }
  }
  if (
    value.duplicate &&
    linked &&
    ['aguardando_pergunta', 'decisao_externa', 'pronta', 'falha'].includes(r.state)
  ) {
    return {
      kind: 'existing',
      message: 'Pedido já existente — exibindo seu estado local, sem nova tarefa.',
      request,
    }
  }
  return {
    kind: 'uncertain',
    message:
      'O estado retornado não confirma a criação. Não reenviar; confira os registros locais.',
    request,
  }
}

export function submitClarifyIntent(intent: ClarifyIntent): Promise<ClarifyOutcome> {
  // Defesa do cliente: autorização real continua sendo a sessão e as regras server-side.
  if (pb.authStore.model?.id !== intent.userId) {
    return Promise.resolve({
      kind: 'blocked',
      message: 'A sessão mudou. Feche o painel e entre novamente.',
    })
  }
  const prior = submissions.get(intent.localRequestId)
  if (prior) return prior
  const pending = sendOnce(intent)
  submissions.set(intent.localRequestId, pending)
  // Gate OFF conhecido não reservou intenção. Liberar só essa memória local
  // permite confirmação MANUAL futura após configuração, nunca reenvio automático.
  void pending.then((outcome) => {
    if (outcome.kind === 'unavailable' && submissions.get(intent.localRequestId) === pending) {
      submissions.delete(intent.localRequestId)
    }
  })
  return pending
}

async function sendOnce(intent: ClarifyIntent): Promise<ClarifyOutcome> {
  try {
    // Prefixo relativo igual ao transporte nativo já funcional da conversão.
    // O PocketBase SDK inclui a sessão. Nunca enviar chave/userId/projeto remoto.
    const value: unknown = await pb.send('backend/v1/ai/clarify', {
      method: 'POST',
      requestKey: null,
      body: {
        capture_id: intent.captureId,
        context: intent.context,
        local_request_id: intent.localRequestId,
        expected_origin_revision: intent.revision,
      },
    })
    return parseOutcome(value, intent)
  } catch (err: unknown) {
    // Somente a resposta nativa conhecida de gate/chave permite dizer que está OFF.
    // Um 503 de gateway genérico também pode ser ambíguo; não inferir cancelamento.
    if (
      object(err) &&
      err.status === 503 &&
      object(err.response) &&
      err.response.message === 'Integração Manus desligada/não configurada.'
    ) {
      return {
        kind: 'unavailable',
        message:
          'Integração Manus desligada/não configurada. Nenhum pedido enviado por esta tentativa.',
      }
    }
    if (object(err) && err.status === 401) {
      return {
        kind: 'blocked',
        message: 'Sessão ausente ou expirada. Entre novamente e confira os registros locais.',
      }
    }
    if (object(err) && err.status === 403) {
      return {
        kind: 'blocked',
        message:
          'Você não tem acesso a esta captura. Nenhum novo envio será tentado automaticamente.',
      }
    }
    if (object(err) && err.status === 409) {
      return {
        kind: 'uncertain',
        message:
          'Pedido bloqueado ou confirmação pendente. Confira a captura e os registros locais; não reenviar.',
      }
    }
    return {
      kind: 'uncertain',
      message:
        'A confirmação do pedido não foi recebida. Pode haver tarefa no Manus; não reenviar.',
    }
  }
}

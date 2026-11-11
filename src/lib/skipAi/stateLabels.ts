// FATIA M1B1 — rótulos e derivações honestas de estado do pedido do copiloto.
//
// Semântica registrada (sem alegar envio/sincronização que não se comprova):
// - registrado       ⇒ pode ser remanescente de crash: NUNCA "ainda não enviado".
// - criacao_incerta  ⇒ criação pode ter acontecido; não reenviar.
// - pronta           ⇒ proposta é registro local, sem alegar sincronização.
// - aguardando_pergunta ⇒ mostra o texto da pergunta; sem caixa de resposta.
// - answer_delivery enviando/incerta ⇒ incerteza visível; answered sem
//   evidência de confirmação não é apresentado como confirmado.

import type { AiQuestion, AiRequestRecord, AiResult, AiRequestState } from './types'

export interface AiStateInfo {
  /** Rótulo principal exibido. */
  label: string
  /** Tonalidade do badge: neutro | atencao | erro | ok. */
  tone: 'neutro' | 'atencao' | 'erro' | 'ok'
  /** Aviso extra de incerteza (answer_delivery), quando houver. */
  deliveryNote: string | null
}

export function stateInfo(request: AiRequestRecord): AiStateInfo {
  const q = isObj(request.question) ? (request.question as AiQuestion) : null
  const delivery = q && isObj(q.answer_delivery) ? q.answer_delivery : null
  const dStatus = delivery && typeof delivery.state === 'string' ? delivery.state : ''
  let deliveryNote: string | null = null
  if (dStatus === 'enviando' || dStatus === 'incerta') {
    deliveryNote =
      'Entrega da resposta à pergunta: ' +
      (dStatus === 'enviando' ? 'em envio, confirmação pendente.' : 'incerta — sem confirmação.')
  }

  // Pergunta preservada no histórico não significa que falta nova resposta.
  // Uma marca legada de answered não comprova entrega; não pedir reenvio.
  if (request.state === 'aguardando_pergunta') {
    if (dStatus === 'enviando' || dStatus === 'incerta') {
      return {
        label: 'Resposta com confirmação pendente; não reenviar',
        tone: 'atencao',
        deliveryNote,
      }
    }
    if (q?.answered === true || dStatus === 'confirmada') {
      return {
        label: 'Resposta registrada — estado do pedido a conferir',
        tone: 'neutro',
        deliveryNote:
          'O registro de resposta não substitui a conferência do estado atual da tarefa.',
      }
    }
  }

  const base: Record<AiRequestState, { label: string; tone: AiStateInfo['tone'] }> = {
    registrado: {
      label: 'Pedido registrado; confirmação ainda não comprovada',
      tone: 'atencao',
    },
    criacao_incerta: {
      label: 'Criação sem confirmação; não reenviar',
      tone: 'atencao',
    },
    em_execucao: {
      label: 'Em execução — estado local',
      tone: 'neutro',
    },
    aguardando_pergunta: {
      label: 'Aguardando sua resposta a uma pergunta',
      tone: 'atencao',
    },
    decisao_externa: {
      label: 'Decisão externa necessária',
      tone: 'atencao',
    },
    pronta: {
      label: 'Proposta disponível — registro local',
      tone: 'ok',
    },
    falha: {
      label: 'Falha registrada neste pedido',
      tone: 'erro',
    },
  }
  const found = base[request.state]
  if (!found) {
    return {
      label: 'Estado desconhecido — exibição de segurança',
      tone: 'neutro',
      deliveryNote,
    }
  }
  return { ...found, deliveryNote }
}

/** Texto da pergunta pendente, apenas se existir de fato (sem invenção). */
export function questionText(request: AiRequestRecord): string | null {
  const q = isObj(request.question) ? (request.question as AiQuestion) : null
  if (!q) return null
  if (typeof q.text === 'string' && q.text.trim() !== '') return q.text
  return null
}

/** Resultado estruturado somente se for objeto (dados malformados ⇒ null). */
export function resultOf(request: AiRequestRecord): AiResult | null {
  return isObj(request.result) ? (request.result as AiResult) : null
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

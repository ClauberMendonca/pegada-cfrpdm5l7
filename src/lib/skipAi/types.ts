// FATIA M1B1 — tipos locais da coleção ai_requests (SOMENTE LEITURA).
//
// Espelham o schema da migration 0005 (ver src/lib/pocketbase/schema.json).
// Nenhum tipo aqui autoriza escrita, envio ou reconciliação: o painel do
// copiloto nesta fatia apenas exibe registros já existentes.

import type { EntityContext } from '@/types/execution'

/** Estados reais gravados pelo hook Manus (select da migration 0005). */
export type AiRequestState =
  | 'registrado'
  | 'criacao_incerta'
  | 'aguardando_pergunta'
  | 'decisao_externa'
  | 'em_execucao'
  | 'pronta'
  | 'falha'

/** Estado de entrega da resposta à pergunta, dentro de question (M1A2a). */
export interface AiAnswerDelivery {
  status?: string // 'enviando' | 'incerta' | 'confirmada'
  question_id?: string
  answer_request_id?: string
  [key: string]: unknown
}

/** Pergunta pendente associada ao pedido (question, JSON). */
export interface AiQuestion {
  type?: string
  text?: string
  message_id?: string
  task_id?: string
  answered?: boolean
  question_expectation?: unknown
  answer_delivery?: AiAnswerDelivery
  [key: string]: unknown
}

/** Proposta estruturada devolvida pelo resultado (result.proposal). */
export interface AiProposal {
  kind?: 'projeto' | 'acao'
  title?: string
  context?: string
  aspiration?: string | null
  controllable_delivery?: string | null
  completion_condition?: string | null
}

/** Resultado estruturado (result, JSON) — somente leitura, tolerante. */
export interface AiResult {
  kind?: 'esclarecimento' | 'projeto' | 'acao'
  missing_data?: boolean
  waiting_or_decision?: boolean
  explanation?: string | null
  proposal?: AiProposal | null
  next_step_suggestion?: string | null
  [key: string]: unknown
}

/** Registro da coleção ai_requests, tal como lido da API padrão. */
export interface AiRequestRecord {
  id: string
  user_id: string
  origin_type: string
  origin_id: string
  origin_revision: string
  context: EntityContext
  local_request_id: string
  remote_task_id?: string
  remote_request_id?: string
  task_url?: string
  schema_version: string
  prompt_revision: string
  state: AiRequestState
  question?: AiQuestion | null
  result?: AiResult | null
  last_polled_at?: string
  error?: string
  created: string
  updated: string
}

/**
 * URL da tarefa Manus exibível: só quando veio gravada no registro, é HTTPS e
 * aponta para um host oficial do Manus. Nunca fabricada a partir de IDs.
 */
export function safeManusTaskUrl(value: string | null | undefined): string | null {
  const v = (value || '').trim()
  if (v === '') return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase()
    if (
      host !== 'manus.im' &&
      host !== 'manus.ai' &&
      !host.endsWith('.manus.im') &&
      !host.endsWith('.manus.ai')
    ) {
      return null
    }
    return u.toString()
  } catch {
    return null
  }
}

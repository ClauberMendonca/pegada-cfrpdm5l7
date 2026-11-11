import pb from '@/lib/pocketbase/client'
import type { CaptureItem, EntityContext } from '@/types/execution'
import type { AiQuestion, AiRequestRecord } from './types'

const NATIVE_UNAVAILABLE_MESSAGE = 'Integração Manus desligada/não configurada.'

type JsonObject = Record<string, unknown>

export interface RefreshAiRequestResult {
  kind: 'updated' | 'unavailable' | 'blocked'
  request?: AiRequestRecord
  synced?: boolean
  message: string
}

export interface AnswerIntent {
  requestId: string
  userId: string
  localRequestId: string
  originId: string
  context: EntityContext
  questionId: string
  answerRequestId: string
  text: string
  remoteTaskId: string
  originRevision: string
}

export type AnswerSubmissionResult =
  | {
      kind: 'confirmed'
      request: AiRequestRecord
      duplicate: boolean
      answerRequestId: string
      message: string
    }
  | {
      kind: 'uncertain'
      request?: AiRequestRecord
      answerRequestId?: string
      message: string
    }
  | {
      kind: 'unavailable'
      answerRequestId?: string
      message: string
    }
  | {
      kind: 'blocked'
      answerRequestId?: string
      message: string
    }

export class TaskServiceError extends Error {
  readonly reason: 'blocked' | 'read' | 'crypto'

  constructor(message: string, reason: 'blocked' | 'read' | 'crypto' = 'blocked') {
    super(message)
    this.name = 'TaskServiceError'
    this.reason = reason
  }
}

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nonEmpty(value: unknown): string {
  return text(value).trim()
}

function optionalText(value: unknown): string {
  return nonEmpty(value)
}

function errorStatus(error: unknown): number | null {
  if (!object(error)) return null
  return typeof error.status === 'number'
    ? error.status
    : typeof error.statusCode === 'number'
      ? error.statusCode
      : null
}

function errorMessage(error: unknown): string {
  if (!object(error)) return ''
  const response = object(error.response) ? error.response : null
  return nonEmpty(response?.message) || nonEmpty(error.message)
}

function isKnownNativeUnavailable(error: unknown): boolean {
  return errorStatus(error) === 503 && errorMessage(error) === NATIVE_UNAVAILABLE_MESSAGE
}

function identityValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sameRequestIdentity(
  expected: AiRequestRecord,
  actual: unknown,
): actual is AiRequestRecord {
  if (!object(actual)) return false
  return (
    identityValue(actual.id) === expected.id &&
    identityValue(actual.user_id) === expected.user_id &&
    identityValue(actual.origin_type) === expected.origin_type &&
    identityValue(actual.origin_id) === expected.origin_id &&
    identityValue(actual.origin_revision) === expected.origin_revision &&
    identityValue(actual.context) === expected.context &&
    identityValue(actual.local_request_id) === expected.local_request_id &&
    optionalText(actual.remote_task_id) === optionalText(expected.remote_task_id)
  )
}

function presentedRequestIsValid(request: AiRequestRecord): boolean {
  return Boolean(
    request &&
    nonEmpty(request.id) &&
    nonEmpty(request.user_id) &&
    request.origin_type === 'captura' &&
    nonEmpty(request.origin_id) &&
    nonEmpty(request.origin_revision) &&
    (request.context === 'vida' || request.context === 'trabalho') &&
    nonEmpty(request.local_request_id),
  )
}

function currentUserId(): string {
  return nonEmpty(pb.authStore.model?.id)
}

function requireSession(request: AiRequestRecord): string {
  const userId = currentUserId()
  if (!userId || userId !== request.user_id) {
    throw new TaskServiceError('A sessão mudou ou não corresponde ao dono do pedido.')
  }
  return userId
}

function requestFrom(value: unknown): AiRequestRecord | null {
  if (!object(value) || !nonEmpty(value.id) || !nonEmpty(value.user_id)) return null
  return value as unknown as AiRequestRecord
}

function captureRevision(capture: CaptureItem): string {
  return capture.raw_text + '|' + capture.updated
}

function captureIsValid(capture: CaptureItem, userId: string): boolean {
  return Boolean(
    capture &&
    nonEmpty(capture.id) &&
    capture.user_id === userId &&
    capture.status === 'pendente' &&
    typeof capture.raw_text === 'string' &&
    typeof capture.updated === 'string',
  )
}

function commonQuestion(question: unknown): question is AiQuestion {
  if (!object(question)) return false
  return question.type === 'messageAskUser' || question.type === 'cascadeAskUser'
}

function currentQuestion(request: AiRequestRecord): AiQuestion | null {
  return object(request.question) ? (request.question as AiQuestion) : null
}

function answerDeliveryState(question: AiQuestion): string {
  return object(question.answer_delivery) ? nonEmpty(question.answer_delivery.state) : ''
}

function responseWithIdentity(expected: AiRequestRecord, value: unknown): AiRequestRecord | null {
  if (!sameRequestIdentity(expected, value)) return null
  return requestFrom(value)
}

/** Trim + colapso de espaços, idêntico à normalização usada pelo hook. */
export function normalizeAnswerText(value: string): string {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
}

/**
 * ID determinístico da resposta. A ordem e os quatro elementos são parte do
 * contrato; não usar nonce, relógio, UUID ou fallback aleatório.
 */
export async function buildAnswerRequestId(
  owner: string,
  localRequestId: string,
  questionId: string,
  normalizedText: string,
): Promise<string> {
  if (!nonEmpty(owner) || !nonEmpty(localRequestId) || !nonEmpty(questionId)) {
    throw new TaskServiceError('Não foi possível formar a identificação estável da resposta.')
  }
  const cryptoApi = globalThis.crypto
  if (
    (typeof globalThis.isSecureContext === 'boolean' && !globalThis.isSecureContext) ||
    !cryptoApi?.subtle
  ) {
    throw new TaskServiceError('O envio requer conexão segura e suporte a Web Crypto.', 'crypto')
  }
  const identity = JSON.stringify([owner, localRequestId, questionId, normalizedText])
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  return (
    'answer-v1-' +
    Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  )
}

/**
 * Consulta explícita do pedido local/remoto. Mesmo `synced:false` pode trazer
 * um registro atual legítimo; nesse caso ele é entregue ao painel, mas nunca é
 * apresentado como confirmação de sincronização.
 */
export async function refreshAiRequest(request: AiRequestRecord): Promise<RefreshAiRequestResult> {
  if (!presentedRequestIsValid(request)) {
    return { kind: 'blocked', message: 'O pedido exibido não tem uma identidade válida.' }
  }
  try {
    requireSession(request)
  } catch (error) {
    return { kind: 'blocked', message: error instanceof Error ? error.message : 'Sessão inválida.' }
  }

  try {
    const value: unknown = await pb.send(
      `backend/v1/ai/requests/${encodeURIComponent(request.id)}`,
      { method: 'GET' },
    )
    if (!object(value) || typeof value.synced !== 'boolean') {
      return {
        kind: 'blocked',
        message: 'A consulta devolveu um formato que não pôde ser conferido.',
      }
    }
    const current = responseWithIdentity(request, value.request)
    if (!current) {
      return {
        kind: 'blocked',
        message: 'A resposta não corresponde ao pedido exibido; o registro local foi preservado.',
      }
    }
    if (currentUserId() !== request.user_id) {
      return {
        kind: 'blocked',
        message: 'A sessão mudou durante a consulta; o registro local foi preservado.',
      }
    }
    return {
      kind: 'updated',
      request: current,
      synced: value.synced,
      message: value.synced
        ? 'Andamento atualizado no Manus.'
        : 'Registro atualizado localmente; esta consulta não confirmou sincronização no Manus.',
    }
  } catch (error: unknown) {
    if (isKnownNativeUnavailable(error)) {
      return {
        kind: 'unavailable',
        message:
          'Integração Manus desligada/não configurada. O pedido local foi preservado; tente manualmente depois.',
      }
    }
    return {
      kind: 'blocked',
      message:
        errorStatus(error) === 503
          ? 'A consulta ficou indisponível sem confirmação. O pedido local foi preservado; confira os registros antes de tentar novamente.'
          : 'Não foi possível confirmar o andamento. O pedido local foi preservado; confira os registros antes de tentar novamente.',
    }
  }
}

/** Leitura padrão e validação completa que antecedem qualquer POST de resposta. */
export async function prepareAnswerIntent(
  request: AiRequestRecord,
  capture: CaptureItem,
  rawAnswer: string,
): Promise<AnswerIntent> {
  if (!presentedRequestIsValid(request)) {
    throw new TaskServiceError('O pedido exibido não tem uma identidade válida.')
  }
  const userId = requireSession(request)
  if (!captureIsValid(capture, userId)) {
    throw new TaskServiceError('A captura não está pendente ou não corresponde ao dono atual.')
  }
  const normalizedText = normalizeAnswerText(rawAnswer)
  if (!normalizedText) throw new TaskServiceError('Escreva uma resposta antes de confirmar.')
  const shownQuestion = currentQuestion(request)
  if (
    request.state !== 'aguardando_pergunta' ||
    !shownQuestion ||
    !commonQuestion(shownQuestion) ||
    !nonEmpty(shownQuestion.message_id) ||
    !nonEmpty(shownQuestion.text) ||
    !nonEmpty(shownQuestion.task_id)
  ) {
    throw new TaskServiceError('A pergunta exibida não está completa ou não é uma pergunta comum.')
  }

  let freshRequest: AiRequestRecord
  let freshCapture: CaptureItem
  try {
    const [requestValue, captureValue] = await Promise.all([
      pb.collection('ai_requests').getOne<AiRequestRecord>(request.id),
      pb.collection('captures').getOne<CaptureItem>(capture.id),
    ])
    freshRequest = requestValue
    freshCapture = captureValue
  } catch {
    throw new TaskServiceError(
      'Não foi possível reler o pedido e a captura; nada foi enviado.',
      'read',
    )
  }

  if (!sameRequestIdentity(request, freshRequest) || freshRequest.user_id !== userId) {
    throw new TaskServiceError(
      'O pedido mudou ou não pertence à sessão atual; revise o pedido antes de responder.',
      'read',
    )
  }
  if (
    !captureIsValid(freshCapture, userId) ||
    freshCapture.id !== request.origin_id ||
    freshCapture.status !== capture.status ||
    freshCapture.raw_text !== capture.raw_text ||
    freshCapture.updated !== capture.updated
  ) {
    throw new TaskServiceError(
      'A captura mudou, foi convertida ou não pertence à sessão atual; nada foi enviado.',
      'read',
    )
  }
  const revision = captureRevision(freshCapture)
  if (request.origin_revision !== revision || freshRequest.origin_revision !== revision) {
    throw new TaskServiceError(
      'A captura mudou desde este pedido; revise a pergunta e o texto antes de confirmar.',
      'read',
    )
  }

  const question = currentQuestion(freshRequest)
  if (freshRequest.state !== 'aguardando_pergunta' || !question || !commonQuestion(question)) {
    throw new TaskServiceError(
      'A pergunta não está mais aguardando uma resposta comum; não enviar.',
      'blocked',
    )
  }
  const questionId = nonEmpty(question.message_id)
  const questionText = nonEmpty(question.text)
  const remoteTaskId = nonEmpty(freshRequest.remote_task_id)
  const deliveryState = answerDeliveryState(question)
  if (
    question.type !== shownQuestion.type ||
    question.message_id !== shownQuestion.message_id ||
    question.text !== shownQuestion.text ||
    question.task_id !== shownQuestion.task_id
  ) {
    throw new TaskServiceError(
      'A pergunta mudou desde a leitura exibida; atualize o pedido e revise antes de confirmar.',
      'read',
    )
  }
  if (
    !questionId ||
    !questionText ||
    !remoteTaskId ||
    nonEmpty(question.task_id) !== remoteTaskId
  ) {
    throw new TaskServiceError('A pergunta atual não tem identidade completa; não enviar.')
  }
  if (
    question.answered === true ||
    (nonEmpty(question.answer_request_id) !== '' && !deliveryState) ||
    ['enviando', 'incerta', 'confirmada'].includes(deliveryState)
  ) {
    throw new TaskServiceError('Esta pergunta já tem entrega registrada ou pendente; não reenviar.')
  }

  const answerRequestId = await buildAnswerRequestId(
    userId,
    freshRequest.local_request_id,
    questionId,
    normalizedText,
  )
  if (currentUserId() !== userId) {
    throw new TaskServiceError('A sessão mudou durante a preparação; nada foi enviado.')
  }
  return {
    requestId: freshRequest.id,
    userId,
    localRequestId: freshRequest.local_request_id,
    originId: freshRequest.origin_id,
    context: freshRequest.context,
    questionId,
    answerRequestId,
    text: normalizedText,
    remoteTaskId,
    originRevision: revision,
  }
}

function legitimateAnswerRequest(intent: AnswerIntent, value: unknown): AiRequestRecord | null {
  if (
    !sameRequestIdentity(
      {
        id: intent.requestId,
        user_id: intent.userId,
        origin_type: 'captura',
        origin_id: intent.originId,
        origin_revision: intent.originRevision,
        context: intent.context,
        local_request_id: intent.localRequestId,
        remote_task_id: intent.remoteTaskId,
        state: 'em_execucao',
        schema_version: '',
        prompt_revision: '',
        created: '',
        updated: '',
      } as AiRequestRecord,
      value,
    )
  ) {
    return null
  }
  const response = requestFrom(value)
  if (!response || response.origin_id === '' || response.context !== intent.context) {
    return null
  }
  if (response.origin_revision !== intent.originRevision) return null
  return response
}

function confirmedAnswer(intent: AnswerIntent, request: AiRequestRecord): boolean {
  const question = currentQuestion(request)
  if (!question || !commonQuestion(question)) return false
  const delivery = object(question.answer_delivery) ? question.answer_delivery : null
  return Boolean(
    request.state === 'em_execucao' &&
    question.answered === true &&
    nonEmpty(question.message_id) === intent.questionId &&
    nonEmpty(question.task_id) === intent.remoteTaskId &&
    delivery &&
    delivery.state === 'confirmada' &&
    nonEmpty(delivery.question_id) === intent.questionId &&
    nonEmpty(delivery.answer_request_id) === intent.answerRequestId &&
    nonEmpty(delivery.remote_task_id) === intent.remoteTaskId &&
    normalizeAnswerText(text(delivery.text)) === intent.text,
  )
}

async function sendAnswerOnce(intent: AnswerIntent): Promise<AnswerSubmissionResult> {
  if (currentUserId() !== intent.userId) {
    return {
      kind: 'blocked',
      answerRequestId: intent.answerRequestId,
      message: 'A sessão mudou antes do envio; nada foi enviado.',
    }
  }
  try {
    const value: unknown = await pb.send(
      `backend/v1/ai/requests/${encodeURIComponent(intent.requestId)}/answer`,
      {
        method: 'POST',
        body: {
          text: intent.text,
          question_id: intent.questionId,
          answer_request_id: intent.answerRequestId,
        },
      },
    )
    if (
      object(value) &&
      (typeof value.status === 'number' || typeof value.statusCode === 'number') &&
      ![value.status, value.statusCode].some(
        (status) => typeof status === 'number' && status >= 200 && status < 300,
      )
    ) {
      return {
        kind: 'uncertain',
        answerRequestId: intent.answerRequestId,
        message: 'A resposta foi tentada, mas o HTTP não confirmou aceitação; não reenviar.',
      }
    }
    if (!object(value) || typeof value.duplicate !== 'boolean') {
      return {
        kind: 'uncertain',
        answerRequestId: intent.answerRequestId,
        message: 'A resposta foi tentada, mas o retorno não confirmou o registro; não reenviar.',
      }
    }
    const response = legitimateAnswerRequest(intent, value.request)
    if (!response || !confirmedAnswer(intent, response)) {
      return {
        kind: 'uncertain',
        answerRequestId: intent.answerRequestId,
        message:
          'A resposta foi tentada, mas o pedido devolvido não confirmou a entrega; não reenviar.',
      }
    }
    return {
      kind: 'confirmed',
      request: response,
      duplicate: value.duplicate,
      answerRequestId: intent.answerRequestId,
      message: value.duplicate
        ? 'Resposta já confirmada neste pedido; nenhum novo envio foi feito.'
        : 'Resposta confirmada pelo servidor.',
    }
  } catch (error: unknown) {
    if (isKnownNativeUnavailable(error)) {
      return {
        kind: 'unavailable',
        answerRequestId: intent.answerRequestId,
        message:
          'Integração Manus desligada/não configurada. Nenhum envio foi reservado; a confirmação manual poderá ser feita depois.',
      }
    }
    return {
      kind: 'uncertain',
      answerRequestId: intent.answerRequestId,
      message:
        errorStatus(error) === 409
          ? 'A resposta ficou incerta ou foi bloqueada por uma reserva do servidor; confira os registros e não reenviar.'
          : 'A confirmação da resposta não foi recebida. Pode haver entrega no Manus; confira os registros e não reenviar.',
    }
  }
}

type SubmissionEntry = {
  answerRequestId: string
  normalizedText: string
  promise: Promise<AnswerSubmissionResult>
  outcome?: AnswerSubmissionResult
}

const submissionsByQuestion = new Map<string, SubmissionEntry>()
const submissionsById = new Map<string, SubmissionEntry>()

function questionSessionKey(request: AiRequestRecord): string {
  return `${request.user_id}:${request.id}:${nonEmpty(currentQuestion(request)?.message_id)}`
}

/**
 * Deduplicação da sessão. Uma tentativa incerta continua bloqueando qualquer
 * novo texto para a mesma pergunta; somente a indisponibilidade nativa, que não
 * reservou o backend, pode ser tentada manualmente mais tarde.
 */
export async function submitAnswer(
  request: AiRequestRecord,
  capture: CaptureItem,
  rawAnswer: string,
): Promise<AnswerSubmissionResult> {
  if (!presentedRequestIsValid(request) || currentUserId() !== request.user_id) {
    return Promise.resolve({
      kind: 'blocked',
      message: 'A sessão não corresponde ao pedido; nada foi enviado.',
    })
  }
  const normalizedInput = normalizeAnswerText(rawAnswer)
  const qKey = questionSessionKey(request)
  const priorQuestion = submissionsByQuestion.get(qKey)
  if (priorQuestion) {
    if (priorQuestion.normalizedText === normalizedInput) return priorQuestion.promise
    return Promise.resolve({
      kind: 'blocked',
      message: 'Já existe uma tentativa para esta pergunta; o novo texto não será reenviado.',
    })
  }

  let intent: AnswerIntent
  try {
    intent = await prepareAnswerIntent(request, capture, rawAnswer)
  } catch (error: unknown) {
    return {
      kind: 'blocked',
      message:
        error instanceof Error
          ? error.message
          : 'Não foi possível preparar a resposta; nada foi enviado.',
    }
  }

  const priorId = submissionsById.get(intent.answerRequestId)
  if (priorId) return priorId.promise
  const raceQuestion = submissionsByQuestion.get(qKey)
  if (raceQuestion) return raceQuestion.promise

  const promise = sendAnswerOnce(intent)
  const entry: SubmissionEntry = {
    answerRequestId: intent.answerRequestId,
    normalizedText: intent.text,
    promise,
  }
  submissionsByQuestion.set(qKey, entry)
  submissionsById.set(intent.answerRequestId, entry)
  void promise.then((outcome) => {
    entry.outcome = outcome
    if (outcome.kind === 'unavailable') {
      if (submissionsByQuestion.get(qKey) === entry) submissionsByQuestion.delete(qKey)
      if (submissionsById.get(intent.answerRequestId) === entry) {
        submissionsById.delete(intent.answerRequestId)
      }
    }
  })
  return promise
}

// Alias explícito para integrações que preferem o verbo do botão.
export const answerAiQuestion = submitAnswer
export const updateAiRequest = refreshAiRequest

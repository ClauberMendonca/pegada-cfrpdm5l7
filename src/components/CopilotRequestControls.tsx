import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { CaptureItem } from '@/types/execution'
import type { AiQuestion, AiRequestRecord } from '@/lib/skipAi/types'
import { normalizeAnswerText, refreshAiRequest, submitAnswer } from '@/lib/skipAi/taskService'
import { usableProposal } from '@/lib/skipAi/proposalService'

export interface CopilotRequestControlsProps {
  request: AiRequestRecord
  capture: CaptureItem
  disabled?: boolean
  onUpdated: (request: AiRequestRecord) => void
  onUseProposal?: (request: AiRequestRecord) => Promise<void>
  onBusyChange?: (busy: boolean) => void
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function questionOf(request: AiRequestRecord): AiQuestion | null {
  return object(request.question) ? (request.question as AiQuestion) : null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function isCommonQuestion(question: AiQuestion | null): boolean {
  return question?.type === 'messageAskUser' || question?.type === 'cascadeAskUser'
}

function canAnswer(request: AiRequestRecord, capture: CaptureItem): boolean {
  const question = questionOf(request)
  const deliveryState = object(question?.answer_delivery)
    ? text(question?.answer_delivery.state).trim()
    : ''
  const hasLegacyAnswerMarker = Boolean(text(question?.answer_request_id).trim()) && !deliveryState
  return Boolean(
    request.state === 'aguardando_pergunta' &&
    request.origin_type === 'captura' &&
    request.origin_id === capture.id &&
    request.user_id === capture.user_id &&
    capture.status === 'pendente' &&
    request.origin_revision === `${capture.raw_text}|${capture.updated}` &&
    question &&
    isCommonQuestion(question) &&
    text(question.message_id).trim() &&
    text(question.text).trim() &&
    question.answered !== true &&
    !hasLegacyAnswerMarker &&
    !['enviando', 'incerta', 'confirmada'].includes(deliveryState),
  )
}

function identityKey(request: AiRequestRecord, capture: CaptureItem): string {
  return [
    request.id,
    request.user_id,
    request.local_request_id,
    request.origin_type,
    request.origin_id,
    request.context,
    request.origin_revision,
    request.remote_task_id,
    text(questionOf(request)?.message_id),
    capture.id,
    capture.user_id,
    capture.status,
    capture.raw_text,
    capture.updated,
  ].join('|')
}

export const CopilotRequestControls: React.FC<CopilotRequestControlsProps> = ({
  request,
  capture,
  disabled = false,
  onUpdated,
  onUseProposal,
  onBusyChange,
}) => {
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState('')
  const [notice, setNotice] = useState('')
  const actionLock = useRef(false)
  const generation = useRef(0)
  const active = useRef(true)
  const currentIdentity = useRef('')
  const key = identityKey(request, capture)
  currentIdentity.current = key

  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
      generation.current += 1
      actionLock.current = false
    }
  }, [])

  const begin = (): number | null => {
    if (!active.current || disabled || actionLock.current) return null
    actionLock.current = true
    const token = ++generation.current
    setBusy(true)
    onBusyChange?.(true)
    return token
  }

  const isCurrent = (token: number): boolean =>
    active.current && token === generation.current && currentIdentity.current === key

  const finish = (token: number): void => {
    if (!active.current || token !== generation.current) return
    actionLock.current = false
    setBusy(false)
    onBusyChange?.(false)
  }

  const update = async (): Promise<void> => {
    const token = begin()
    if (token === null) return
    try {
      const outcome = await refreshAiRequest(request)
      if (!isCurrent(token)) return
      if (outcome.request) onUpdated(outcome.request)
      setNotice(outcome.message)
    } catch {
      if (isCurrent(token))
        setNotice('Não foi possível atualizar; o registro local foi preservado.')
    } finally {
      finish(token)
    }
  }

  const confirmAnswer = async (): Promise<void> => {
    if (!canAnswer(request, capture)) {
      setNotice('A pergunta não está mais disponível para resposta; atualize o pedido e revise-o.')
      return
    }
    const normalized = normalizeAnswerText(answer)
    if (!normalized) {
      setNotice('Escreva uma resposta antes de confirmar.')
      return
    }
    const token = begin()
    if (token === null) return
    try {
      const outcome = await submitAnswer(request, capture, answer)
      if (!isCurrent(token)) return
      if ('request' in outcome && outcome.request) onUpdated(outcome.request)
      setNotice(outcome.message)
    } catch {
      if (isCurrent(token)) {
        setNotice(
          'Não foi possível confirmar a resposta. O texto foi preservado; não reenviar sem conferir.',
        )
      }
    } finally {
      finish(token)
    }
  }

  // Nome local sem o prefixo "use": não é um Hook React; evita falso positivo
  // do oxlint (rules-of-hooks). Comportamento idêntico ao pacote original.
  const handleUseProposal = async (): Promise<void> => {
    if (!onUseProposal || !usableProposal(request, capture)) {
      setNotice(
        'A proposta não corresponde mais à captura atual; atualize antes de preparar o formulário.',
      )
      return
    }
    const token = begin()
    if (token === null) return
    try {
      await onUseProposal(request)
      if (isCurrent(token)) setNotice('Campos preparados para conferência no formulário manual.')
    } catch {
      if (isCurrent(token))
        setNotice('Não foi possível preparar o formulário; a captura não foi alterada.')
    } finally {
      finish(token)
    }
  }

  const question = questionOf(request)
  const showAnswer = canAnswer(request, capture)
  const showProposal = Boolean(onUseProposal && usableProposal(request, capture))
  const normalizedPreview = normalizeAnswerText(answer)

  return (
    <div className="space-y-3 text-sm text-slate-700" aria-busy={busy}>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="border-violet-200 text-violet-700 hover:bg-violet-50"
          disabled={disabled || busy}
          onClick={() => void update()}
        >
          Atualizar andamento no Manus
        </Button>
        {showProposal ? (
          <Button
            type="button"
            variant="outline"
            className="border-violet-200 text-violet-700 hover:bg-violet-50"
            disabled={disabled || busy}
            onClick={() => void handleUseProposal()}
          >
            Levar ao formulário de conversão
          </Button>
        ) : null}
      </div>

      {showAnswer && question ? (
        <section
          className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3"
          aria-label="Responder pergunta do Manus"
        >
          <p>
            <strong>Revise a pergunta antes de responder</strong>
          </p>
          <blockquote className="border-l-2 border-violet-300 pl-3 text-slate-600">
            {question.text}
          </blockquote>
          <label className="block space-y-1">
            Sua resposta
            <Textarea
              value={answer}
              disabled={disabled || busy}
              onChange={(event) => setAnswer(event.target.value)}
              rows={3}
            />
          </label>
          <p>
            <small>
              Será enviado após normalização de espaços: “{normalizedPreview || '—'}”. A continuação
              pode consumir créditos.
            </small>
          </p>
          <Button
            type="button"
            className="bg-violet-600 text-white hover:bg-violet-700"
            disabled={disabled || busy || !normalizedPreview}
            onClick={() => void confirmAnswer()}
          >
            Confirmar resposta
          </Button>
        </section>
      ) : null}

      {notice ? (
        <p
          className="rounded-md bg-slate-50 px-3 py-2 text-slate-600"
          role="status"
          aria-live="polite"
        >
          {notice}
        </p>
      ) : null}
    </div>
  )
}

export default CopilotRequestControls

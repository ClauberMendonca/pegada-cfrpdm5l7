import React, { useCallback, useRef, useState } from 'react'
import { ActionItem, Project } from '@/types/execution'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { actionService } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import { checkEligibility } from '@/lib/eligibility'
import pb from '@/lib/pocketbase/client'
import { Button } from '@/components/ui/button'
import { Loader2, Play } from 'lucide-react'

export type StatusSuggestionOutcome =
  | 'dismissed'
  | 'already_in_progress'
  | 'blocked'
  | 'confirmed'
  | 'failed'

interface StatusSuggestionStepProps {
  /** Ação do registro EFETIVAMENTE ENVIADO (snapshot no momento do create). */
  actionId: string
  actionTitle: string
  /** NUMERAÇÃO PERMANENTE — número da ação enviada (leitura persistida, só
     apresentação). Opcional: sem número, o título segue legível. */
  actionNumber?: number | null
  onDone: (outcome: StatusSuggestionOutcome) => void
}

/**
 * BLOCO 9 — Etapa curta de sucesso dentro do próprio modal, após o log
 * confirmado. Não é formulário: o log já foi salvo e não pode ser reenviado
 * aqui. A única escrita possível é o clique explícito em "Marcar em andamento",
 * que revalida o estado ATUAL antes de enviar. Guarda de frontend, não
 * garantia transacional entre dispositivos.
 *
 * Regras:
 *  - A leitura da ação falhou / vínculo não resolvido → informa e não assume
 *    projeto ativo (a verificação de elegibilidade decide, sem suposição).
 *  - Já em andamento → informa, sem gravar de novo.
 *  - Outro estado/projeto impede → informa o motivo legível, não grava.
 *  - Falha do update → "Progresso já registrado; não foi possível confirmar a
 *    alteração de status"; o log continua salvo.
 */
export const StatusSuggestionStep: React.FC<StatusSuggestionStepProps> = ({
  actionId,
  actionTitle,
  actionNumber,
  onDone,
}) => {
  const [checking, setChecking] = useState(true)
  const [applying, setApplying] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [feedbackTone, setFeedbackTone] = useState<'neutral' | 'error'>('neutral')
  // Guarda de identidade: retorno tardio de outra sessão não aplica escolha.
  const sessionRef = useRef(0)

  React.useEffect(() => {
    const session = ++sessionRef.current
    setChecking(true)
    let live: ActionItem | null = null
    actionService
      .getById(actionId)
      .then(async (fresh) => {
        if (session !== sessionRef.current) return
        live = fresh
        // Projeto atual resolvido por leitura autenticada — nunca assumido ativo.
        let project: Project | null | undefined = fresh.project_id ? undefined : null
        if (fresh.project_id) {
          try {
            project = await projectService.getById(fresh.project_id)
          } catch {
            if (session !== sessionRef.current) return
            project = undefined
          }
        }
        if (session !== sessionRef.current) return
        if (fresh.status === 'em_andamento') {
          setFeedback('O avanço já está em andamento — nada foi alterado.')
          setChecking(false)
          return
        }
        const check = checkEligibility(fresh, project)
        if (!check.ok) {
          setFeedback(
            `O avanço não pode mudar de status agora: ${check.label ?? 'impedimento'}. Nada foi alterado.`,
          )
          setChecking(false)
          return
        }
        setFeedback(null)
        setChecking(false)
      })
      .catch(() => {
        if (session !== sessionRef.current) return
        setFeedback(
          'Não foi possível confirmar o estado atual do avanço. A sugestão foi mantida fora desta rodada; o progresso continua registrado.',
        )
        setFeedbackTone('error')
        setChecking(false)
      })
    return () => {
      ++sessionRef.current
      void live
    }
  }, [actionId])

  const handleConfirm = useCallback(async () => {
    if (applying || checking) return
    const session = ++sessionRef.current
    setApplying(true)
    try {
      // Revalidação ANTES de enviar (estado + vínculo atuais).
      const fresh = await actionService.getById(actionId)
      if (session !== sessionRef.current || !pb.authStore.model?.id) return
      let project: Project | null | undefined = fresh.project_id ? undefined : null
      if (fresh.project_id) {
        try {
          project = await projectService.getById(fresh.project_id)
        } catch {
          project = undefined
        }
      }
      if (fresh.status === 'em_andamento') {
        setFeedback('O avanço já está em andamento — nada foi alterado.')
        setFeedbackTone('neutral')
        onDone('already_in_progress')
        return
      }
      const check = checkEligibility(fresh, project)
      if (!check.ok || fresh.status !== 'pronta') {
        setFeedback(
          `O avanço não pode mudar de status agora: ${check.label ?? 'impedimento'}. Nada foi alterado.`,
        )
        setFeedbackTone('error')
        onDone('blocked')
        return
      }
      await actionService.updateStatus(fresh.id, 'em_andamento')
      if (session !== sessionRef.current) return
      onDone('confirmed')
    } catch {
      if (session !== sessionRef.current) return
      setFeedback('Progresso já registrado; não foi possível confirmar a alteração de status.')
      setFeedbackTone('error')
      onDone('failed')
    } finally {
      if (session === sessionRef.current) setApplying(false)
    }
  }, [actionId, applying, checking, onDone])

  if (checking) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Verificando o estado atual do avanço…
      </p>
    )
  }

  // Sem sugestão disponível (falha de leitura ou estado impedido): só sair.
  if (feedback && feedbackTone === 'error') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-xl"
          onClick={() => onDone('dismissed')}
        >
          Entendi
        </Button>
      </div>
    )
  }

  if (feedback) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground" role="status">
          {feedback}
        </p>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-xl"
          onClick={() => onDone('dismissed')}
        >
          Entendi
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-foreground">
        O avanço{' '}
        <span className="inline-flex flex-wrap items-baseline gap-1.5 font-semibold">
          <EntityNumberBadge kind="action" n={actionNumber} />
          {actionTitle}
        </span>{' '}
        segue com status <span className="font-semibold">Pronto</span>. Quer marcá-lo como{' '}
        <span className="font-semibold">Em andamento</span> agora?
      </p>
      <p className="text-xs text-muted-foreground">
        Esta é uma escolha separada: o registro de progresso já foi salvo e nada muda de status sem
        o seu clique.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          className="min-h-11 rounded-xl"
          disabled={applying}
          onClick={() => onDone('dismissed')}
        >
          Agora não
        </Button>
        <Button
          type="button"
          className="min-h-11 gap-1.5 rounded-xl"
          disabled={applying}
          onClick={() => void handleConfirm()}
        >
          {applying ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Atualizando…
            </>
          ) : (
            <>
              <Play className="h-4 w-4" aria-hidden="true" />
              Marcar em andamento
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

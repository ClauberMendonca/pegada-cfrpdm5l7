// FATIA M1B1 — painel do copiloto em Capturas (SOMENTE LEITURA).
// FATIA M1B2a — confirmação e comando de criação do esclarecimento.
//
// Integração real AINDA DESLIGADA: abrir/selecionar/consultar NÃO envia
// nada ao Manus. A criação só ocorre após o clique explícito em
// 'Revisar pedido de esclarecimento' e depois em 'Confirmar envio'
// (card inline em ClarifyConfirmCard + clarifyService.ts). Fechar o
// painel NÃO cancela eventual tarefa Manus nem libera reserva.

import React, { useEffect, useRef, useState } from 'react'
import { Bot, Calendar, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import { ClarifyConfirmCard } from '@/components/ClarifyConfirmCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/contexts/AuthContext'
import { ownerTimezone, formatInstantInZone } from '@/lib/datetime'
import type { CaptureItem, EntityContext } from '@/types/execution'
import type { AiProposal, AiRequestRecord } from '@/lib/skipAi/types'
import { safeManusTaskUrl } from '@/lib/skipAi/types'
import { listAiRequestsForCapture } from '@/lib/skipAi/requestsService'
import { questionText, resultOf, stateInfo } from '@/lib/skipAi/stateLabels'
import { prepareClarifyIntent, submitClarifyIntent } from '@/lib/skipAi/clarifyService'
import type { ClarifyIntent, ClarifyOutcome } from '@/lib/skipAi/clarifyService'

const AVISO_PERSISTENTE =
  'Abrir o painel consulta registros locais. Atualizar no Manus e enviar respostas são comandos explícitos; podem estar indisponíveis se a integração estiver desligada.'

interface CopilotPanelProps {
  capture: CaptureItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

type LoadState =
  | { phase: 'sem_contexto' }
  | { phase: 'carregando'; reqId: number }
  | { phase: 'erro'; message: string; reqId: number }
  | { phase: 'vazio'; reqId: number }
  | { phase: 'lista'; requests: AiRequestRecord[]; reqId: number }

// Uma sessão visual por dono/captura. Fechar desmonta a sessão; abrir outra
// captura nunca reaproveita a seleção ou as listas da sessão anterior.
export const CopilotPanel: React.FC<CopilotPanelProps> = (props) => {
  const { user } = useAuth()
  if (!props.open || !props.capture) return null
  return (
    <CopilotPanelSession
      key={JSON.stringify([user?.id ?? '', props.capture.id])}
      capture={props.capture}
      open={props.open}
      onOpenChange={props.onOpenChange}
    />
  )
}

interface CopilotPanelSessionProps extends Omit<CopilotPanelProps, 'capture'> {
  capture: CaptureItem
}

const CopilotPanelSession: React.FC<CopilotPanelSessionProps> = ({
  capture,
  open,
  onOpenChange,
}) => {
  const { user } = useAuth()
  const timezone = ownerTimezone(user?.timezone)

  const [context, setContext] = useState<EntityContext | null>(null)
  const [load, setLoad] = useState<LoadState>({ phase: 'sem_contexto' })
  const requestIdRef = useRef(0)

  const captureId = capture.id
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      ++requestIdRef.current
    }
  }, [])

  // Invalidar no próprio evento, antes de qualquer efeito ou retorno tardio.
  const selectContext = (next: EntityContext) => {
    if (!activeRef.current || next === context) return
    ++requestIdRef.current
    setLoad({ phase: 'sem_contexto' })
    setContext(next)
  }

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) {
      activeRef.current = false
      ++requestIdRef.current
    }
    onOpenChange(nextOpen)
  }

  // Carrega pedidos locais SOMENTE após a escolha explícita do contexto.
  useEffect(() => {
    if (!open || !activeRef.current || !context) return
    const reqId = ++requestIdRef.current
    setLoad({ phase: 'carregando', reqId })
    let cancelled = false
    listAiRequestsForCapture({ originId: capture.id, context, userId: user?.id }).then((res) => {
      if (cancelled || !activeRef.current || reqId !== requestIdRef.current) return
      if (!res.ok || res.requests.length === 0) {
        setLoad(res.ok ? { phase: 'vazio', reqId } : { phase: 'erro', message: res.error, reqId })
      } else {
        setLoad({ phase: 'lista', requests: res.requests, reqId })
      }
    })
    return () => {
      cancelled = true
    }
  }, [open, context, captureId, capture, user?.id])

  // Releitura local (getFullList nativo) — usada pelo botão 'Atualizar
  // registros locais' e após um envio confirmado. Erro aqui não desfaz
  // confirmação anterior nem autoriza reenvio.
  const refreshLocalRequests = () => {
    if (!open || !activeRef.current || !context) return
    const reqId = ++requestIdRef.current
    setLoad({ phase: 'carregando', reqId })
    listAiRequestsForCapture({ originId: captureId, context, userId: user?.id }).then((res) => {
      if (!activeRef.current || reqId !== requestIdRef.current) return
      if (!res.ok || res.requests.length === 0) {
        setLoad(res.ok ? { phase: 'vazio', reqId } : { phase: 'erro', message: res.error, reqId })
      } else {
        setLoad({ phase: 'lista', requests: res.requests, reqId })
      }
    })
  }

  const requests = load.phase === 'lista' ? load.requests : []

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="bg-slate-900 border-slate-800 text-slate-100 max-w-2xl max-h-[85vh] flex flex-col"
        aria-describedby="copilot-panel-desc"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
            <Bot className="w-5 h-5 text-violet-400" />
            Copiloto — pedidos locais
          </DialogTitle>
          <DialogDescription id="copilot-panel-desc" className="text-xs text-slate-400">
            Visualização somente leitura dos pedidos registrados nesta captura. Fechar não cancela
            nenhuma tarefa.
          </DialogDescription>
        </DialogHeader>

        {/* Aviso persistente — texto exato exigido nesta fatia */}
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {AVISO_PERSISTENTE}
        </div>

        <div className="space-y-4 py-1 overflow-y-auto pr-1">
          {/* Origem: raw_text em modo SOMENTE LEITURA */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-slate-400">
              Captura (somente leitura)
            </Label>
            <p className="text-sm text-slate-200 whitespace-pre-wrap break-words rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2">
              {capture ? capture.raw_text : ''}
            </p>
          </div>

          {/* Contexto explícito — começa sem seleção */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-slate-400">
              Contexto (apenas filtra a visualização — não grava nem envia)
            </Label>
            <div className="flex gap-2">
              {(['vida', 'trabalho'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => selectContext(c)}
                  aria-pressed={context === c}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    context === c
                      ? 'bg-violet-500/20 border-violet-500/40 text-violet-200'
                      : 'bg-slate-950/70 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  {c === 'vida' ? 'Vida' : 'Trabalho'}
                </button>
              ))}
            </div>
          </div>

          {/* Pedidos locais */}
          {!context ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              Escolha Vida ou Trabalho para carregar os pedidos locais desta captura.
            </p>
          ) : load.phase === 'carregando' || load.phase === 'sem_contexto' ? (
            <p className="text-sm text-slate-400 py-4 text-center">Carregando pedidos locais…</p>
          ) : load.phase === 'erro' ? (
            <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-3 space-y-2">
              <p className="text-sm text-rose-200 break-words">{load.message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={refreshLocalRequests}
                className="border-rose-500/40 text-rose-200 hover:bg-rose-500/10 gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Tentar novamente
              </Button>
            </div>
          ) : load.phase === 'vazio' ? (
            <p className="text-sm text-slate-400 py-4 text-center">
              Nenhum pedido local registrado para esta captura neste contexto.
            </p>
          ) : (
            <ul className="space-y-3">
              {requests.map((r) => (
                <CopilotRequestItem key={r.id} request={r} capture={capture} timezone={timezone} />
              ))}
            </ul>
          )}

          {/* M1B2a — comando explícito de criação; NUNCA no mount/consulta */}
          {user && (
            <ClarifyCommand
              capture={capture}
              context={context}
              userId={user.id}
              existingRequests={requests}
              onSubmitted={refreshLocalRequests}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => changeOpen(false)} className="text-slate-400">
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * FATIA M1B2a — comando de criação do esclarecimento (componente pequeno
 * extra, arquivo próprio ClarifyConfirmCard.tsx para o cartão visual).
 * Ciclo: 'Revisar pedido de esclarecimento' (prepara intenção) →
 * 'Confirmar envio' (submitClarifyIntent). Identities invalidam: dono,
 * captura, status, texto/revisão ou contexto mudou => preparação perdida.
 * Retorno tardio após fechar/mudar identidade é ignorado. Fechar o painel
 * NÃO aborta POST em curso (não é cancelamento) e não libera reserva.
 */
const ClarifyCommand: React.FC<{
  capture: CaptureItem
  context: EntityContext | null
  userId: string
  existingRequests: AiRequestRecord[]
  onSubmitted: () => void
}> = ({ capture, context, userId, existingRequests, onSubmitted }) => {
  const [prepared, setPrepared] = useState<ClarifyIntent | null>(null)
  const [prepError, setPrepError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submittingPrep, setSubmittingPrep] = useState(false)
  const [outcome, setOutcome] = useState<ClarifyOutcome | null>(null)
  const [outcomeKey, setOutcomeKey] = useState<string | null>(null)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const activeRef = useRef(true)
  const busyRef = useRef(false)
  const preparedRef = useRef<ClarifyIntent | null>(null)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])

  const currentRevision = `${capture.raw_text}|${capture.updated}`
  const outcomeKeyOf = (intent: ClarifyIntent) =>
    JSON.stringify([intent.userId, intent.captureId, intent.context, intent.revision])

  // Prévia/resultado vinculados a contexto/revisão atuais; qualquer mudança
  // de identidade invalida a preparação. Retornos tardios são ignorados.
  useEffect(() => {
    preparedRef.current = null
    setPrepared(null)
    setPrepError(null)
    setOutcome(null)
    setOutcomeKey(null)
    setRefreshNote(null)
    busyRef.current = false
    setSubmitting(false)
    setSubmittingPrep(false)
  }, [userId, capture.id, capture.status, currentRevision, context])

  // Histórico local já tem pedido da mesma revisão/contexto: exibir, sem nova execução.
  const alreadyRequested = existingRequests.some(
    (r) => r.origin_revision === currentRevision && r.context === context,
  )

  const canOffer =
    !!context &&
    capture.status === 'pendente' &&
    !alreadyRequested &&
    !prepared &&
    !prepError &&
    !outcome &&
    !submittingPrep &&
    !submitting

  const startPreparation = async () => {
    if (!activeRef.current || busyRef.current || !context) return
    busyRef.current = true
    setSubmittingPrep(true)
    setPrepError(null)
    try {
      const intent = await prepareClarifyIntent(capture, context, userId)
      if (!activeRef.current) return // retorno tardio: ignorado
      // No clique final conferir que a intenção coincide com os dados atuais;
      // a guarda transacional do backend continua sendo a proteção real.
      if (
        intent.captureId !== capture.id ||
        intent.context !== context ||
        intent.revision !== `${capture.raw_text}|${capture.updated}`
      ) {
        setPrepError('Os dados da captura mudaram durante a preparação; revise e tente novamente.')
        return
      }
      preparedRef.current = intent
      setPrepared(intent)
    } catch (err) {
      if (activeRef.current) {
        setPrepError(err instanceof Error ? err.message : 'Não foi possível preparar o pedido.')
      }
    } finally {
      busyRef.current = false
      if (activeRef.current) setSubmittingPrep(false)
    }
  }

  const confirmSend = async () => {
    const intent = preparedRef.current
    if (!activeRef.current || busyRef.current || submitting || !intent || !context) return
    // Checagem visual no clique final (não substitui a guarda transacional).
    if (
      intent.captureId !== capture.id ||
      intent.context !== context ||
      intent.revision !== `${capture.raw_text}|${capture.updated}` ||
      intent.userId !== userId
    ) {
      setPrepared(null)
      preparedRef.current = null
      setPrepError('Os dados mudaram; a preparação foi descartada. Revise e prepare novamente.')
      return
    }
    busyRef.current = true
    setSubmitting(true)
    setOutcome(null)
    setOutcomeKey(null)
    setRefreshNote(null)
    try {
      const result = await submitClarifyIntent(intent)
      if (!activeRef.current) return // retorno tardio: ignorado
      setOutcome(result)
      setOutcomeKey(outcomeKeyOf(intent))
      if (
        (result.kind === 'confirmed' ||
          result.kind === 'existing' ||
          result.kind === 'uncertain') &&
        result.request
      ) {
        // Releitura APENAS local (getFullList nativo); erro não desfaz nada.
        onSubmitted()
      }
    } finally {
      busyRef.current = false
      if (activeRef.current) setSubmitting(false)
    }
  }

  const key = prepared ? outcomeKeyOf(prepared) : null
  const outcomeStale = !!(prepared && outcome && outcomeKey !== key)
  const sendBlocked = outcomeStale || !!prepError || alreadyRequested

  const buttonLabel =
    alreadyRequested && (!prepared || outcomeStale)
      ? 'Pedido já registrado nesta revisão/contexto'
      : 'Revisar pedido de esclarecimento'

  // Sem contexto/sessão, captura não pendente, consulta local carregando/erro
  // ou Web Crypto indisponível => sem envio (o serviço também bloqueia).
  if (!context || capture.status !== 'pendente') return null

  return (
    <div
      className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/40 p-3"
      data-testid="clarify-command"
    >
      {outcome && !prepared && outcome.kind === 'unavailable' && (
        <p className="text-xs text-amber-200 break-words">{outcome.message}</p>
      )}
      {prepError && !prepared && <p className="text-xs text-rose-200 break-words">{prepError}</p>}
      {alreadyRequested && !prepared && !outcome && (
        <p className="text-xs text-slate-400">
          Já existe pedido registrado para esta captura nesta revisão e contexto — exibido acima;
          não há nova execução desta intenção.
        </p>
      )}
      {canOffer && (
        <Button
          type="button"
          size="sm"
          onClick={startPreparation}
          disabled={submittingPrep || submitting}
          className="bg-violet-600 hover:bg-violet-500 text-white gap-1.5"
        >
          <Bot className="w-3.5 h-3.5" />
          {submittingPrep ? 'Preparando…' : buttonLabel}
        </Button>
      )}
      {prepared && !outcomeStale && (
        <ClarifyConfirmCard
          intent={prepared}
          context={context}
          submitting={submitting}
          sendBlocked={sendBlocked}
          prepError={prepError}
          outcome={outcome}
          onConfirm={confirmSend}
          onBack={() => {
            // Cancela SOMENTE a preparação; nenhum POST é feito aqui.
            preparedRef.current = null
            setPrepared(null)
            setPrepError(null)
            setOutcome(null)
            setOutcomeKey(null)
          }}
        />
      )}
      {prepared && outcomeStale && (
        <p className="text-xs text-amber-200 break-words">
          Os dados da captura ou o contexto mudaram; esta preparação não é mais válida.
        </p>
      )}
      {refreshNote && <p className="text-xs text-slate-500">{refreshNote}</p>}
    </div>
  )
}

/** Um pedido: status honesto, contexto, data local, pergunta/resultado leitura. */
const CopilotRequestItem: React.FC<{
  request: AiRequestRecord
  capture: CaptureItem
  timezone?: string
}> = ({ request, capture, timezone }) => {
  const info = stateInfo(request)
  const question = questionText(request)
  const result = resultOf(request)

  // Comparação da revisão: origin_revision gravado vs estado ATUAL da captura.
  const expectedRevision = `${capture.raw_text}|${capture.updated}`
  const captureChanged = request.origin_revision !== expectedRevision

  const taskUrl = safeManusTaskUrl(request.task_url)
  const createdLabel = formatInstantInZone(request.created, timezone) || 'data indisponível'

  return (
    <li className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={
            info.tone === 'ok'
              ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
              : info.tone === 'erro'
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                : info.tone === 'atencao'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  : 'bg-slate-500/20 text-slate-300 border-slate-500/30'
          }
        >
          {info.label}
        </Badge>
        <Badge variant="outline" className="text-slate-400 border-slate-700">
          {request.context === 'vida' ? 'Vida' : 'Trabalho'}
        </Badge>
        <span className="text-xs text-slate-500 inline-flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {createdLabel}
        </span>
      </div>

      {info.deliveryNote && <p className="text-xs text-amber-200">{info.deliveryNote}</p>}

      {captureChanged && (
        <p className="text-xs text-amber-200 inline-flex items-start gap-1">
          <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          A captura mudou desde este pedido — o conteúdo abaixo pode estar desatualizado.
        </p>
      )}

      {question && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Pergunta do Manus (somente leitura)
          </p>
          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{question}</p>
        </div>
      )}

      {result && <CopilotResultView result={result} />}

      {request.state === 'falha' &&
        typeof request.error === 'string' &&
        request.error.trim() !== '' && (
          <p className="text-xs text-rose-200 break-words">Detalhe registrado: {request.error}</p>
        )}

      {taskUrl && (
        <a
          href={taskUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-violet-300 hover:text-violet-200 inline-flex items-center gap-1"
        >
          <ExternalLink className="w-3 h-3" />
          Abrir no Manus
        </a>
      )}
    </li>
  )
}

/** Resultado estruturado somente leitura; null é lacuna — nada preenchido. */
const CopilotResultView: React.FC<{ result: ReturnType<typeof resultOf> }> = ({ result }) => {
  const explanation = typeof result?.explanation === 'string' ? result.explanation : null
  const nextStep =
    typeof result?.next_step_suggestion === 'string' ? result.next_step_suggestion : null
  const proposal = isProposal(result?.proposal) ? result.proposal : null

  return (
    <div className="space-y-2">
      {explanation !== null && explanation.trim() !== '' && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Explicação
          </p>
          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{explanation}</p>
        </div>
      )}

      {proposal && (
        <div className="space-y-1.5 rounded-md border border-slate-800 bg-slate-900/60 p-2.5">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Proposta</p>
          {typeof proposal.title === 'string' && proposal.title.trim() !== '' && (
            <p className="text-sm text-slate-100 font-medium">{proposal.title}</p>
          )}
          {proposal.kind === 'projeto' ? (
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-slate-500">Aspiração</dt>
              <dd className="text-slate-200 whitespace-pre-wrap break-words">
                {textOrNull(proposal.aspiration)}
              </dd>
              <dt className="text-slate-500">Entrega controlável</dt>
              <dd className="text-slate-200 whitespace-pre-wrap break-words">
                {textOrNull(proposal.controllable_delivery)}
              </dd>
              <dt className="text-slate-500">Condição de término</dt>
              <dd className="text-slate-200 whitespace-pre-wrap break-words">
                {textOrNull(proposal.completion_condition)}
              </dd>
            </dl>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-slate-500">Título da ação</dt>
              <dd className="text-slate-200">
                {typeof proposal.title === 'string' && proposal.title.trim() !== ''
                  ? proposal.title
                  : '—'}
              </dd>
              <dt className="text-slate-500">Contexto</dt>
              <dd className="text-slate-200">{contextLabel(proposal.context)}</dd>
            </dl>
          )}
        </div>
      )}

      {nextStep !== null && nextStep.trim() !== '' && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">
            Próximo avanço sugerido
          </p>
          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{nextStep}</p>
        </div>
      )}
    </div>
  )
}

function textOrNull(v: string | null | undefined): string {
  return typeof v === 'string' && v.trim() !== '' ? v : '— (não informado)'
}

function contextLabel(v: string | undefined): string {
  if (v === 'vida') return 'Vida'
  if (v === 'trabalho') return 'Trabalho'
  return '— (não informado)'
}

function isProposal(v: unknown): v is AiProposal {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

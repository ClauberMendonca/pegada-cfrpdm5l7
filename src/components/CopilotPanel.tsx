// Marco 2: comandos explícitos para o pedido existente; abrir o painel só consulta o banco local.
import React, { useEffect, useRef, useState } from 'react'
import { Bot, Calendar, ExternalLink, RefreshCw, TriangleAlert } from 'lucide-react'
import { ClarifyConfirmCard } from '@/components/ClarifyConfirmCard'
import { CopilotRequestControls } from '@/components/CopilotRequestControls'
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
  onUseProposal?: (request: AiRequestRecord) => Promise<void>
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
      key={JSON.stringify([
        user?.id ?? '',
        props.capture.id,
        props.capture.raw_text,
        props.capture.updated,
        props.capture.status,
      ])}
      capture={props.capture}
      open={props.open}
      onOpenChange={props.onOpenChange}
      onUseProposal={props.onUseProposal}
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
  onUseProposal,
}) => {
  const { user } = useAuth()
  const timezone = ownerTimezone(user?.timezone)

  const [context, setContext] = useState<EntityContext | null>(null)
  const [load, setLoad] = useState<LoadState>({ phase: 'sem_contexto' })
  const requestIdRef = useRef(0)

  const captureId = capture.id
  const activeRef = useRef(true)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const changeBusy = (value: boolean) => {
    if (!activeRef.current) return
    busyRef.current = value
    setBusy(value)
  }

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      ++requestIdRef.current
    }
  }, [])

  // Invalidar no próprio evento, antes de qualquer efeito ou retorno tardio.
  const selectContext = (next: EntityContext) => {
    if (!activeRef.current || busyRef.current || next === context) return
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
    if (!open || !activeRef.current || !context || busyRef.current) return
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
  const localReady = load.phase === 'lista' || load.phase === 'vazio'
  const updateRequest = (updated: AiRequestRecord) => {
    if (
      !activeRef.current ||
      updated.user_id !== user?.id ||
      updated.origin_id !== captureId ||
      updated.context !== context
    )
      return
    setLoad((current) =>
      current.phase === 'lista'
        ? { ...current, requests: current.requests.map((r) => (r.id === updated.id ? updated : r)) }
        : current,
    )
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="bg-card border-border text-card-foreground max-w-2xl max-h-[85vh] flex flex-col"
        aria-describedby="copilot-panel-desc"
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" />
            Copiloto — da captura ao próximo avanço
          </DialogTitle>
          <DialogDescription id="copilot-panel-desc" className="text-xs text-muted-foreground">
            Revise o andamento, responda quando necessário e leve uma proposta ao formulário manual.
            Fechar não cancela uma tarefa nem um envio em curso.
          </DialogDescription>
        </DialogHeader>

        {/* Aviso persistente — texto exato exigido nesta fatia */}
        <div className="rounded-md border border-ginga-warning/30 bg-ginga-warning-bg px-3 py-2 text-xs text-ginga-warning">
          {AVISO_PERSISTENTE}
        </div>

        <div className="space-y-4 py-1 overflow-y-auto pr-1">
          {/* Origem: raw_text em modo SOMENTE LEITURA */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Captura (somente leitura)
            </Label>
            <p className="text-sm text-foreground whitespace-pre-wrap break-words rounded-md border border-border bg-muted/50 px-3 py-2">
              {capture ? capture.raw_text : ''}
            </p>
          </div>

          {/* Contexto explícito — começa sem seleção */}
          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
              Contexto (apenas filtra a visualização — não grava nem envia)
            </Label>
            <div className="flex gap-2">
              {(['vida', 'trabalho'] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => selectContext(c)}
                  disabled={busy}
                  aria-pressed={context === c}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                    context === c
                      ? 'bg-accent border-primary/40 text-accent-foreground'
                      : 'bg-card border-border text-foreground hover:border-input'
                  }`}
                >
                  {c === 'vida' ? 'Vida' : 'Trabalho'}
                </button>
              ))}
            </div>
          </div>

          {/* Pedidos locais */}
          {!context ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Escolha Vida ou Trabalho para carregar os pedidos locais desta captura.
            </p>
          ) : load.phase === 'carregando' || load.phase === 'sem_contexto' ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Carregando pedidos locais…
            </p>
          ) : load.phase === 'erro' ? (
            <div className="rounded-md border border-destructive/30 bg-ginga-danger-bg px-3 py-3 space-y-2">
              <p className="text-sm text-destructive break-words">{load.message}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={refreshLocalRequests}
                className="border-destructive/40 text-destructive hover:bg-ginga-danger-bg gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Tentar novamente
              </Button>
            </div>
          ) : load.phase === 'vazio' ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              Nenhum pedido local registrado para esta captura neste contexto.
            </p>
          ) : (
            <ul className="space-y-3">
              {requests.map((r) => (
                <CopilotRequestItem
                  key={JSON.stringify([r.id, context])}
                  request={r}
                  capture={capture}
                  timezone={timezone}
                  disabled={busy}
                  onUpdated={updateRequest}
                  onUseProposal={onUseProposal}
                  onBusyChange={changeBusy}
                />
              ))}
            </ul>
          )}

          {/* M1B2a — comando explícito de criação; NUNCA no mount/consulta */}
          {user && (
            <ClarifyCommand
              key={JSON.stringify([
                user.id,
                capture.id,
                context,
                capture.raw_text,
                capture.updated,
              ])}
              capture={capture}
              context={context}
              userId={user.id}
              existingRequests={requests}
              onSubmitted={refreshLocalRequests}
              localReady={localReady}
              disabled={busy}
              onBusyChange={changeBusy}
            />
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => changeOpen(false)}>
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
  localReady: boolean
  disabled: boolean
  onBusyChange: (busy: boolean) => void
}> = ({
  capture,
  context,
  userId,
  existingRequests,
  onSubmitted,
  localReady,
  disabled,
  onBusyChange,
}) => {
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
    !submitting &&
    localReady &&
    !disabled

  const startPreparation = async () => {
    if (!activeRef.current || busyRef.current || !context || !localReady || disabled) return
    busyRef.current = true
    onBusyChange(true)
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
      if (activeRef.current) {
        setSubmittingPrep(false)
        onBusyChange(false)
      }
    }
  }

  const confirmSend = async () => {
    const intent = preparedRef.current
    if (
      !activeRef.current ||
      busyRef.current ||
      submitting ||
      !intent ||
      !context ||
      !localReady ||
      disabled
    )
      return
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
    onBusyChange(true)
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
        onBusyChange(false)
        onSubmitted()
      }
    } finally {
      busyRef.current = false
      if (activeRef.current) {
        setSubmitting(false)
        onBusyChange(false)
      }
    }
  }

  const key = prepared ? outcomeKeyOf(prepared) : null
  const outcomeStale = !!(prepared && outcome && outcomeKey !== key)
  const sendBlocked = outcomeStale || !!prepError || alreadyRequested || !localReady || disabled

  const buttonLabel =
    alreadyRequested && (!prepared || outcomeStale)
      ? 'Pedido já registrado nesta revisão/contexto'
      : 'Revisar pedido de esclarecimento'

  // Sem contexto/sessão, captura não pendente, consulta local carregando/erro
  // ou Web Crypto indisponível => sem envio (o serviço também bloqueia).
  if (!context || capture.status !== 'pendente') return null

  return (
    <div
      className="space-y-2 rounded-lg border border-border bg-muted/40 p-3"
      data-testid="clarify-command"
    >
      {outcome && !prepared && outcome.kind === 'unavailable' && (
        <p className="text-xs text-ginga-warning break-words">{outcome.message}</p>
      )}
      {prepError && !prepared && (
        <p className="text-xs text-destructive break-words">{prepError}</p>
      )}
      {alreadyRequested && !prepared && !outcome && (
        <p className="text-xs text-muted-foreground">
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
          className="gap-1.5"
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
        <p className="text-xs text-ginga-warning break-words">
          Os dados da captura ou o contexto mudaram; esta preparação não é mais válida.
        </p>
      )}
      {refreshNote && <p className="text-xs text-muted-foreground">{refreshNote}</p>}
    </div>
  )
}

/** Um pedido: status honesto, contexto, data local, pergunta/resultado leitura. */
const CopilotRequestItem: React.FC<{
  request: AiRequestRecord
  capture: CaptureItem
  timezone?: string
  disabled: boolean
  onUpdated: (request: AiRequestRecord) => void
  onUseProposal?: (request: AiRequestRecord) => Promise<void>
  onBusyChange: (busy: boolean) => void
}> = ({ request, capture, timezone, disabled, onUpdated, onUseProposal, onBusyChange }) => {
  const info = stateInfo(request)
  const question = questionText(request)
  const result = resultOf(request)

  // Comparação da revisão: origin_revision gravado vs estado ATUAL da captura.
  const expectedRevision = `${capture.raw_text}|${capture.updated}`
  const captureChanged = request.origin_revision !== expectedRevision

  const taskUrl = safeManusTaskUrl(request.task_url)
  const createdLabel = formatInstantInZone(request.created, timezone) || 'data indisponível'

  return (
    <li className="rounded-lg border border-border bg-card p-3 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge
          className={
            info.tone === 'ok'
              ? 'bg-ginga-success-bg text-ginga-success border-ginga-success/30'
              : info.tone === 'erro'
                ? 'bg-ginga-danger-bg text-destructive border-destructive/30'
                : info.tone === 'atencao'
                  ? 'bg-ginga-warning-bg text-ginga-warning border-ginga-warning/30'
                  : 'bg-muted text-muted-foreground border-border'
          }
        >
          {info.label}
        </Badge>
        <Badge variant="outline" className="text-muted-foreground border-border">
          {request.context === 'vida' ? 'Vida' : 'Trabalho'}
        </Badge>
        <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {createdLabel}
        </span>
      </div>

      {info.deliveryNote && <p className="text-xs text-ginga-warning">{info.deliveryNote}</p>}

      {captureChanged && (
        <p className="text-xs text-ginga-warning inline-flex items-start gap-1">
          <TriangleAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          A captura mudou desde este pedido — o conteúdo abaixo pode estar desatualizado.
        </p>
      )}

      {question && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Pergunta do Manus (somente leitura)
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">{question}</p>
        </div>
      )}

      {result && <CopilotResultView result={result} />}

      <CopilotRequestControls
        request={request}
        capture={capture}
        disabled={disabled}
        onUpdated={onUpdated}
        onUseProposal={onUseProposal}
        onBusyChange={onBusyChange}
      />

      {request.state === 'falha' &&
        typeof request.error === 'string' &&
        request.error.trim() !== '' && (
          <p className="text-xs text-destructive break-words">
            Detalhe registrado: {request.error}
          </p>
        )}

      {taskUrl && (
        <a
          href={taskUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-1"
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
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Explicação
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">{explanation}</p>
        </div>
      )}

      {proposal && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/40 p-2.5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Proposta
          </p>
          {typeof proposal.title === 'string' && proposal.title.trim() !== '' && (
            <p className="text-sm text-foreground font-medium">{proposal.title}</p>
          )}
          {proposal.kind === 'projeto' ? (
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Aspiração</dt>
              <dd className="text-foreground whitespace-pre-wrap break-words">
                {textOrNull(proposal.aspiration)}
              </dd>
              <dt className="text-muted-foreground">Entrega controlável</dt>
              <dd className="text-foreground whitespace-pre-wrap break-words">
                {textOrNull(proposal.controllable_delivery)}
              </dd>
              <dt className="text-muted-foreground">Condição de término</dt>
              <dd className="text-foreground whitespace-pre-wrap break-words">
                {textOrNull(proposal.completion_condition)}
              </dd>
            </dl>
          ) : (
            <dl className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Título da ação</dt>
              <dd className="text-foreground">
                {typeof proposal.title === 'string' && proposal.title.trim() !== ''
                  ? proposal.title
                  : '—'}
              </dd>
              <dt className="text-muted-foreground">Contexto</dt>
              <dd className="text-foreground">{contextLabel(proposal.context)}</dd>
            </dl>
          )}
        </div>
      )}

      {nextStep !== null && nextStep.trim() !== '' && (
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Próximo avanço sugerido
          </p>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">{nextStep}</p>
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { ActionItem, ActionStatus, Project } from '@/types/execution'
import { TimeEntry, timeService } from '@/services/timeService'
import { actionService } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import { checkEligibility, isSelectableForFocus, resolveProjectState } from '@/lib/eligibility'
import { ActionRow } from '@/components/ActionRow'
import { ActionModal } from '@/components/ActionModal'
import { ProgressLogModal } from '@/components/ProgressLogModal'
import { TimeControl } from '@/components/TimeControlCompact'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ListChecks,
  Plus,
  AlertCircle,
  Search,
  RotateCcw,
  Star,
  SunMedium,
  Link2,
  X,
  SearchX,
  Loader2,
  ArrowRight,
} from 'lucide-react'
import { ownerTimezone, todayInZone } from '@/lib/datetime'
import { entityNumberCode, formatEntityTitle } from '@/lib/entityNumber'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { useToast } from '@/hooks/use-toast'
import { useTimer } from '@/contexts/TimeContext'
import { cn } from '@/lib/utils'
import {
  ListRow,
  SummaryToggle,
  actionSummaryLine,
  useSummaryPreference,
  useViewPreference,
  ViewToggle,
} from '@/components/ViewToggle'

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'object' && err !== null) {
    const anyErr = err as { message?: unknown; response?: { message?: unknown } }
    if (typeof anyErr.message === 'string' && anyErr.message) return anyErr.message
    if (typeof anyErr.response?.message === 'string' && anyErr.response.message)
      return anyErr.response.message
  }
  return fallback
}

function groupTimeEntriesByAction(entries: TimeEntry[]): Record<string, TimeEntry[]> {
  return entries.reduce<Record<string, TimeEntry[]>>((grouped, entry) => {
    if (!entry.action_id) return grouped
    ;(grouped[entry.action_id] ??= []).push(entry)
    return grouped
  }, {})
}

// Valores persistidos (pronta/bloqueada/feita/cancelada) NÃO mudam; só o
// rótulo concorda com o novo substantivo Avanço (masculino).
const STATUS_OPTIONS: { value: ActionStatus | 'todos'; label: string }[] = [
  { value: 'todos', label: 'Todos' },
  { value: 'pronta', label: 'Pronto' },
  { value: 'em_andamento', label: 'Em andamento' },
  { value: 'aguardando', label: 'Aguardando' },
  { value: 'bloqueada', label: 'Bloqueado' },
  { value: 'feita', label: 'Feito' },
  { value: 'cancelada', label: 'Cancelado' },
]

const LINK_OPTIONS: { value: 'todas' | 'sem_projeto' | 'com_projeto'; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'sem_projeto', label: 'Sem resultado' },
  { value: 'com_projeto', label: 'Com resultado' },
]

// BLOCO 2B — resolução do destino de /acoes?id=<ID> (mesmo contrato já usado
// por /projetos?id=<ID> na v0.0.45; sem parâmetros concorrentes).
interface DestResolution {
  id: string
  action: ActionItem | null
  state: 'resolving' | 'ready' | 'notfound' | 'error'
  error: string | null
}

export const ActionsPage: React.FC = () => {
  const { user } = useAuth()
  const { contextFilter } = useGlobalFilter()
  const { toast } = useToast()
  const { revision } = useTimer()

  const [actions, setActions] = useState<ActionItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([])
  const [timeLoading, setTimeLoading] = useState(true)
  const [timeError, setTimeError] = useState<string | null>(null)

  // Filtros locais do catálogo (não mexem no filtro global nem no recorte do Hoje).
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ActionStatus | 'todos'>('todos')
  const [linkFilter, setLinkFilter] = useState<'todas' | 'sem_projeto' | 'com_projeto'>('todas')

  // FATIA 3 — gravação em andamento (impede submissão duplicada por controle).
  const [savingActionId, setSavingActionId] = useState<string | null>(null)

  // Catálogo de Ações — apresentação Cards/Lista (preferência por dono nesta área).
  const [view, setView] = useViewPreference('acoes', user?.id)
  const [showSummary, setShowSummary] = useSummaryPreference('acoes', user?.id)
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})

  // BLOCO 2B — destino retomável por URL: /acoes?id=<ID> abre/destaca a ação
  // dentro deste catálogo; /acoes sem id continua sendo o catálogo completo.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlActionId = searchParams.get('id')?.trim() || null
  const [dest, setDest] = useState<DestResolution | null>(null)
  const [destRetryTick, setDestRetryTick] = useState(0)
  const destElRef = useRef<HTMLDivElement | null>(null)

  // Modals state
  const [isActionModalOpen, setIsActionModalOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null)
  const [logModalAction, setLogModalAction] = useState<ActionItem | null>(null)

  // FATIA P1C — "hoje" no fuso do dono (fonte única: lib/datetime).
  const todayStr = todayInZone(ownerTimezone(user?.timezone))

  // Catálogo: TODAS as ações do dono no contexto global (sem recorte de Hoje,
  // sem filtro de elegibilidade — ações de projetos pausados/concluídos/arquivados
  // continuam localizáveis). Consulta conjunta, sem chamada por linha.
  const loadData = useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const filterContext = contextFilter === 'todos' ? undefined : contextFilter
      const [allActions, allProjects] = await Promise.all([
        actionService.list(filterContext),
        projectService.list(filterContext),
      ])
      setActions(allActions)
      setProjects(allProjects)
    } catch (err: unknown) {
      const msg = errorMessage(
        err,
        'Erro ao carregar dados. Verifique sua conexão e tente novamente.',
      )
      setLoadError(msg)
      toast({ variant: 'destructive', title: 'Erro ao carregar', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [contextFilter, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const loadTimeEntries = useCallback(async () => {
    // BLOCO 2B — inclui o destino da URL na MESMA consulta batelada (nunca
    // uma consulta por linha), mesmo quando ele está fora da lista carregada.
    const actionIds = [
      ...new Set([...actions.map((action) => action.id), ...(urlActionId ? [urlActionId] : [])]),
    ]
    if (actionIds.length === 0) {
      setTimeEntries([])
      setTimeError(null)
      setTimeLoading(false)
      return
    }
    setTimeLoading(true)
    setTimeError(null)
    try {
      const list = await timeService.listByActions(actionIds)
      setTimeEntries(list)
    } catch (err: unknown) {
      setTimeError(errorMessage(err, 'Não foi possível carregar o tempo dos avanços.'))
    } finally {
      setTimeLoading(false)
    }
  }, [actions, urlActionId])

  useEffect(() => {
    if (!isLoading) void loadTimeEntries()
  }, [isLoading, loadTimeEntries, revision])

  // BLOCO 2B(1)(6) — resolve o destino da URL na sessão do dono. Primeiro na
  // batelada já carregada (mesma consulta do catálogo); fora dela, leitura
  // pontual por ID com o vínculo expandido. A leitura é escopada à sessão
  // autenticada — filtro visual nunca vira regra de autorização. Guarda contra
  // retornos tardios: só o resultado do ID corrente é aplicado.
  useEffect(() => {
    if (!urlActionId) {
      setDest(null)
      return
    }
    if (isLoading) {
      // Catálogo ainda carregando: não exibe destino de outro ID nem decide cedo.
      setDest((prev) => (prev && prev.id === urlActionId ? prev : null))
      return
    }
    let cancelled = false
    if (actions.some((a) => a.id === urlActionId)) {
      // Já está nos dados carregados — sem consulta extra, sem cópia duplicada.
      setDest((prev) =>
        prev && prev.id === urlActionId && prev.state === 'ready'
          ? prev
          : { id: urlActionId, action: null, state: 'ready', error: null },
      )
      return
    }
    setDest((prev) =>
      prev && prev.id === urlActionId && prev.state === 'ready' && prev.action
        ? prev // destino já aberto por leitura direta: mantém em tela
        : { id: urlActionId, action: null, state: 'resolving', error: null },
    )
    actionService
      .getById(urlActionId)
      .then((a) => {
        if (cancelled) return
        setDest({ id: urlActionId, action: a, state: 'ready', error: null })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const status = (err as { status?: number } | null)?.status
        setDest((prev) =>
          prev && prev.id === urlActionId && prev.state === 'ready' && prev.action
            ? prev // falha transitória ao revalidar: mantém o destino visível
            : {
                id: urlActionId,
                action: null,
                state: status === 404 ? 'notfound' : 'error',
                error: errorMessage(err, 'Não foi possível abrir o avanço deste link.'),
              },
        )
      })
    return () => {
      cancelled = true
    }
  }, [urlActionId, isLoading, actions, destRetryTick])

  // FATIA 2 — resolvedor de situação REAL do projeto: usa a lista carregada do
  // backend (mesma consulta). Nunca assume "ativo" para relação não carregada.
  const resolveProject = useCallback(
    (a: ActionItem): Project | null | undefined => resolveProjectState(a, projects),
    [projects],
  )

  const timeEntriesByAction = useMemo(() => groupTimeEntriesByAction(timeEntries), [timeEntries])

  const renderActionTimeControl = (action: ActionItem) => {
    const actionProject = resolveProject(action)
    return (
      <TimeControl
        targetType="action"
        targetId={action.id}
        targetTitle={action.title}
        targetNumberCode={entityNumberCode('action', action.sequence_number)}
        contextLabel={formatEntityTitle(
          'project',
          actionProject?.sequence_number,
          actionProject?.title ?? '',
        )}
        targetStatus={action.status}
        projectStatus={actionProject?.status ?? null}
        actionHasProject={Boolean(action.project_id)}
        entries={timeEntriesByAction[action.id] ?? []}
        entriesLoading={timeLoading}
        entriesError={timeError}
        onRetryEntries={loadTimeEntries}
        onChanged={loadTimeEntries}
      />
    )
  }

  // Catálogo filtrado: busca + status + vínculo. O filtro global de contexto já
  // veio da consulta; aqui só recorta a exibição local. A busca cobre título,
  // descrição/notas e o título do resultado já resolvido (mesma resolução da
  // linha), sem nova consulta. Campos ausentes não geram erro nem texto
  // inventado. Código/número é match INTEGRAL (exato): "3" acha o avanço 3 e
  // nunca o 13; "AV-1" não localiza o AV-12 por substring. Aceita o código novo
  // (AV-12) e o legado (A-12) para o próprio avanço, e R-N/P-N para o vínculo.
  const filteredActions = useMemo(() => {
    const query = search.trim().toLowerCase()
    return actions.filter((a) => {
      if (query) {
        const inTitle = a.title.toLowerCase().includes(query)
        const inDescription = (a.description ?? '').toLowerCase().includes(query)
        const project = resolveProject(a)
        const inProject = (project?.title ?? '').toLowerCase().includes(query)
        // NUMERAÇÃO PERMANENTE: busca local também pelo código/número — dados
        // já carregados, sem nova consulta. Campos de código: igualdade exata.
        const inCode =
          typeof a.sequence_number === 'number' &&
          (query === entityNumberCode('action', a.sequence_number)?.toLowerCase() ||
            query === `av-${a.sequence_number}` ||
            query === `a-${a.sequence_number}`)
        const inProjectCode =
          typeof project?.sequence_number === 'number' &&
          (query === entityNumberCode('project', project.sequence_number)?.toLowerCase() ||
            query === `r-${project.sequence_number}` ||
            query === `p-${project.sequence_number}`)
        const inNumber = /^\d+$/.test(query) && a.sequence_number === Number(query)
        if (!inTitle && !inDescription && !inProject && !inCode && !inProjectCode && !inNumber)
          return false
      }
      if (statusFilter !== 'todos' && a.status !== statusFilter) return false
      if (linkFilter === 'sem_projeto' && a.project_id) return false
      if (linkFilter === 'com_projeto' && !a.project_id) return false
      return true
    })
  }, [actions, resolveProject, search, statusFilter, linkFilter])

  const hasActiveLocalFilters =
    search.trim() !== '' || statusFilter !== 'todos' || linkFilter !== 'todas'

  // BLOCO 2B — o que fazer com o destino resolvido: se está no recorte visível,
  // abre/destaca na própria listagem; se está fora (filtros locais ou recorte
  // global de contexto), aparece em um agrupamento próprio — sem limpar ou
  // trocar filtros e sem renderizar a ação duas vezes.
  const destReady = Boolean(dest && dest.id === urlActionId && dest.state === 'ready')
  const catalogDestAction = urlActionId ? (actions.find((a) => a.id === urlActionId) ?? null) : null
  const destDisplayAction = destReady ? (catalogDestAction ?? dest?.action ?? null) : null
  const destInFiltered = Boolean(
    destDisplayAction && urlActionId && filteredActions.some((a) => a.id === urlActionId),
  )
  const showDestGroup = Boolean(destDisplayAction) && !destInFiltered
  const destResolving =
    Boolean(urlActionId) && (!dest || dest.id !== urlActionId || dest.state === 'resolving')
  const destContextMismatch = Boolean(
    destDisplayAction && contextFilter !== 'todos' && destDisplayAction.context !== contextFilter,
  )

  const clearLocalFilters = () => {
    setSearch('')
    setStatusFilter('todos')
    setLinkFilter('todas')
  }

  // BLOCO 2B(5) — fechar o destino remove o id da URL sem empilhar histórico
  // (sem laço de reabrir); voltar pelo navegador também remove a seleção.
  const closeDest = useCallback(() => {
    setSearchParams({}, { replace: true })
  }, [setSearchParams])

  // BLOCO 2B(4) — abrir/recolher em Lista usa o mesmo contrato navegável:
  // abrir reflete /acoes?id=<ID> (push: voltar fecha), recolher remove o id.
  // Só muda a visualização — nunca grava, nem altera status ou tempo.
  const handleRowToggle = useCallback(
    (id: string) => {
      const isOpen = Boolean(openRows[id]) || urlActionId === id
      if (isOpen) {
        setOpenRows((prev) => ({ ...prev, [id]: false }))
        if (urlActionId === id) closeDest()
      } else {
        setOpenRows((prev) => ({ ...prev, [id]: true }))
        if (urlActionId !== id) {
          setSearchParams(new URLSearchParams({ id }), { state: { from: 'catalog' } })
        }
      }
    },
    [openRows, urlActionId, closeDest, setSearchParams],
  )

  // BLOCO 2B(2) — traz o destino à área visível quando ele está na listagem
  // (Cards ou Lista). O grupo próprio já fica no topo, sem rolagem.
  useEffect(() => {
    if (!destReady || !destInFiltered) return
    destElRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [destReady, destInFiltered, view])

  // FATIA 2 + FATIA 3 — seleção de foco com a MESMA regra compartilhada do Hoje;
  // estado pendente; sucesso só após confirmação real do backend.
  const handleToggleNextStep = async (id: string, current: boolean) => {
    if (savingActionId) return
    // BLOCO 2B — destino fora da batelada também passa pelas guardas de
    // elegibilidade (mesma regra compartilhada do Hoje).
    const action =
      actions.find((a) => a.id === id) ?? (destDisplayAction?.id === id ? destDisplayAction : null)
    if (!current && action) {
      const check = checkEligibility(action, resolveProject(action))
      if (!check.ok || !isSelectableForFocus(action, resolveProject(action))) {
        toast({
          variant: 'destructive',
          title: 'Não é possível selecionar',
          description:
            check.label ||
            'Somente avanços "prontos" podem ser o próximo avanço único. Tente outro avanço ou reavalie este.',
        })
        return
      }
    }
    setSavingActionId(id)
    try {
      if (current) {
        await actionService.unsetNextStep(id)
      } else {
        await actionService.setAsNextStep(id)
      }
      await loadData()
    } catch (err: unknown) {
      const msg = errorMessage(
        err,
        'Não foi possível gravar. Verifique a conexão e tente novamente.',
      )
      toast({ variant: 'destructive', title: 'Falha ao gravar escolha', description: msg })
    } finally {
      setSavingActionId(null)
    }
  }

  const handleToggleTodaySelected = async (id: string, current: boolean) => {
    if (savingActionId) return
    // BLOCO 2B — mesma guarda de elegibilidade para o destino fora da batelada.
    const action =
      actions.find((a) => a.id === id) ?? (destDisplayAction?.id === id ? destDisplayAction : null)
    if (!current && action) {
      const check = checkEligibility(action, resolveProject(action))
      if (!check.ok || !isSelectableForFocus(action, resolveProject(action))) {
        toast({
          variant: 'destructive',
          title: 'Não é possível selecionar',
          description:
            check.label ||
            'Somente avanços "prontos" podem ir para as Poucas Ações de Hoje. Tente outro avanço ou reavalie este.',
        })
        return
      }
    }
    setSavingActionId(id)
    try {
      await actionService.setTodaySelected(id, !current)
      await loadData()
    } catch (err: unknown) {
      const msg = errorMessage(
        err,
        'Não foi possível gravar. Verifique a conexão e tente novamente.',
      )
      toast({ variant: 'destructive', title: 'Falha ao gravar escolha', description: msg })
    } finally {
      setSavingActionId(null)
    }
  }

  const handleStatusChange = async (id: string, status: ActionStatus, reason?: string) => {
    if (savingActionId) return
    setSavingActionId(id)
    try {
      await actionService.updateStatus(id, status, reason)
      await loadData()
    } catch (err: unknown) {
      const msg = errorMessage(
        err,
        'Não foi possível gravar. Verifique a conexão e tente novamente.',
      )
      toast({ variant: 'destructive', title: 'Falha ao atualizar status', description: msg })
    } finally {
      setSavingActionId(null)
    }
  }

  const handleModalSaved = () => {
    void loadData()
  }

  const renderActionRow = (action: ActionItem, isDest = false) => {
    const project = resolveProject(action)
    const linkLabel = project ? project.title : action.project_id ? 'vínculo indisponível' : null
    return (
      <div className={cn('space-y-1 rounded-lg', isDest && 'ring-1 ring-primary/40')}>
        <div className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
          {isDest && (
            <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
              <Link2 className="h-3 w-3" aria-hidden="true" />
              Destino do link
            </Badge>
          )}
          {/* Vínculo: título do projeto carregado, ou indisponível sem inventar projeto. */}
          {linkLabel && (
            <span
              className={cn('inline-flex items-center gap-1', !project && 'text-ginga-warning')}
            >
              {project ? (
                <span className="truncate">Resultado: {project.title}</span>
              ) : (
                <span>Vínculo de resultado indisponível</span>
              )}
            </span>
          )}
          {!linkLabel && <span>Sem resultado</span>}
          {project && ['pausado', 'arquivado', 'concluido'].includes(project.status) && (
            <Badge variant="outline" className="text-[10px] uppercase">
              {project.status}
            </Badge>
          )}
          {action.deadline && (
            <span className="tabular-nums">
              Prazo: {action.deadline}
              {action.deadline < todayStr &&
              action.status !== 'feita' &&
              action.status !== 'cancelada'
                ? ' (atrasada)'
                : ''}
            </span>
          )}
          {action.is_next_step && (
            <span className="inline-flex items-center gap-1 text-ginga-warning">
              <Star className="h-3 w-3 fill-current" aria-hidden="true" />
              Próximo avanço
            </span>
          )}
          {!action.is_next_step && action.is_today_selected && (
            <span className="inline-flex items-center gap-1 text-primary">
              <SunMedium className="h-3 w-3" aria-hidden="true" />
              Selecionada para Hoje
            </span>
          )}
        </div>
        <ActionRow
          action={action}
          saving={savingActionId === action.id}
          onToggleNextStep={handleToggleNextStep}
          onToggleTodaySelected={handleToggleTodaySelected}
          onStatusChange={handleStatusChange}
          onOpenLogModal={setLogModalAction}
          timeControl={renderActionTimeControl(action)}
          onEdit={(a) => {
            setEditingAction(a)
            setIsActionModalOpen(true)
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-ginga-info-bg text-ginga-info border border-ginga-info/30">
              <ListChecks className="w-4 h-4" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Avanços</h2>
            {contextFilter !== 'todos' && (
              <Badge
                variant="outline"
                className="text-xs uppercase font-medium border-border text-foreground bg-muted"
              >
                Filtro: {contextFilter}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-0.5">
            Catálogo completo de todos os seus avanços, com ou sem resultado, independentemente da
            seleção para Hoje. Hoje continua sendo um recorte deliberado, não o catálogo.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          {view === 'list' && <SummaryToggle checked={showSummary} onChange={setShowSummary} />}
          <Button
            onClick={() => {
              setEditingAction(null)
              setIsActionModalOpen(true)
            }}
            disabled={savingActionId !== null}
            className="gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Novo avanço
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-destructive/30 bg-ginga-danger-bg p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">Falha ao carregar o catálogo.</p>
            <p className="text-xs text-destructive mt-0.5">{loadError}</p>
            <Button size="sm" variant="outline" onClick={loadData} className="mt-2 text-xs">
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {timeError && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-ginga-danger-bg p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="text-sm font-medium text-destructive">
              Falha ao carregar tempos dos avanços.
            </p>
            <p className="mt-0.5 text-xs text-destructive">{timeError}</p>
            <Button size="sm" variant="outline" onClick={loadTimeEntries} className="mt-2 text-xs">
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {/* BLOCO 2B(6) — estados do destino da URL, distintos entre si: resolução
          em curso, ID inexistente/inacessível e falha com nova tentativa. */}
      {urlActionId && destResolving && (
        <div className="rounded-xl border border-border bg-muted p-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden="true" />
          Abrindo o avanço deste link…
        </div>
      )}

      {dest && dest.id === urlActionId && dest.state === 'notfound' && (
        <div className="rounded-xl border border-destructive/30 bg-ginga-danger-bg p-4 flex items-start gap-3">
          <SearchX className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">Avanço não encontrado.</p>
            <p className="text-xs text-destructive mt-0.5">
              O link aponta para um avanço que não existe, foi removido ou não está acessível nesta
              sessão.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={closeDest}
              className="mt-2 gap-1.5 text-xs"
            >
              <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
              Voltar ao catálogo
            </Button>
          </div>
        </div>
      )}

      {dest && dest.id === urlActionId && dest.state === 'error' && (
        <div className="rounded-xl border border-destructive/30 bg-ginga-danger-bg p-4 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">
              Não foi possível abrir o avanço deste link.
            </p>
            <p className="text-xs text-destructive mt-0.5">{dest.error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDestRetryTick((t) => t + 1)}
              className="mt-2 text-xs"
            >
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {/* Busca + filtros locais */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título, descrição, código (AV-12/A-12) ou resultado…"
            aria-label="Buscar avanços por título, descrição, código (novo AV-N ou legado A-N) ou resultado vinculado"
            className="min-h-11 border-input bg-card pl-9 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-ring sm:text-sm"
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(val) => setStatusFilter(val as ActionStatus | 'todos')}
        >
          <SelectTrigger
            aria-label="Filtrar por status"
            className="min-h-11 w-full border-input bg-card text-base text-foreground sm:w-44 sm:text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-border bg-popover text-popover-foreground">
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                Status: {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={linkFilter} onValueChange={(val) => setLinkFilter(val as typeof linkFilter)}>
          <SelectTrigger
            aria-label="Filtrar por vínculo de resultado"
            className="min-h-11 w-full border-input bg-card text-base text-foreground sm:w-40 sm:text-sm"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-border bg-popover text-popover-foreground">
            {LINK_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                Vínculo: {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* BLOCO 2B(3) — destino fora do recorte visível: agrupamento contextual
          próprio, com indicação clara. Filtros e modo preservados; a ação não é
          renderizada duas vezes (neste caso ela não está na listagem abaixo). */}
      {showDestGroup && destDisplayAction && (
        <div className="rounded-xl border border-ring/40 bg-card p-3 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {destContextMismatch ? (
                <span className="text-ginga-warning">
                  Este avanço é de {destDisplayAction.context === 'trabalho' ? 'Trabalho' : 'Vida'}{' '}
                  e está fora do recorte atual ({contextFilter === 'trabalho' ? 'Trabalho' : 'Vida'}
                  ). O filtro foi preservado.
                </span>
              ) : catalogDestAction ? (
                <span>
                  Este avanço está fora dos filtros atuais do catálogo (busca, status ou vínculo).
                  Os filtros foram preservados.
                </span>
              ) : (
                <span>
                  Este avanço não está nos dados carregados do catálogo; foi aberto por leitura
                  direta do link.
                </span>
              )}
            </div>
            <Button size="sm" variant="ghost" onClick={closeDest} className="gap-1 text-xs">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Fechar destino
            </Button>
          </div>
          {renderActionRow(destDisplayAction, true)}
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm text-muted-foreground">Carregando avanços…</span>
          </div>
        </div>
      ) : filteredActions.length === 0 ? (
        /* Vazio: distingue "nenhuma cadastrada" de "nada corresponde aos filtros". */
        <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
          {actions.length === 0 ? (
            <>
              <p className="text-sm font-medium text-muted-foreground">
                Nenhum avanço cadastrado ainda.
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                Crie seu primeiro avanço com "Novo avanço" — não precisa estar vinculado a um
                resultado.
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-muted-foreground">
                Nenhum avanço corresponde aos filtros atuais.
              </p>
              {hasActiveLocalFilters && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearLocalFilters}
                  className="mt-3 gap-1.5 text-xs"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Limpar filtros
                </Button>
              )}
            </>
          )}
        </div>
      ) : view === 'cards' ? (
        <div className="grid gap-3">
          {filteredActions.map((action) => {
            const isDest = urlActionId === action.id
            return (
              <div key={action.id} ref={isDest ? destElRef : undefined}>
                {renderActionRow(action, isDest)}
              </div>
            )
          })}
        </div>
      ) : (
        /* Lista: apenas o título em cada linha; abrir expande a apresentação
           completa existente (descrição, comandos, tempo) — recolher só altera
           a visualização, sem encerrar cronômetro nem gravar nada. O destino
           da URL abre automaticamente, com selo "Destino", pelo mesmo contrato. */
        <div className="grid gap-2">
          {filteredActions.map((action) => {
            const isDest = urlActionId === action.id
            return (
              <div key={action.id} ref={isDest ? destElRef : undefined}>
                <ListRow
                  title={action.title}
                  numberKind="action"
                  numberValue={action.sequence_number}
                  numberEntityId={action.id}
                  open={Boolean(openRows[action.id]) || isDest}
                  hint={
                    isDest ? (
                      <Badge
                        variant="outline"
                        className="gap-1 border-primary/40 text-primary text-[10px]"
                      >
                        <Link2 className="h-3 w-3" aria-hidden="true" />
                        Destino
                      </Badge>
                    ) : undefined
                  }
                  onToggle={() => handleRowToggle(action.id)}
                  summary={
                    showSummary
                      ? actionSummaryLine(action, {
                          projectTitle:
                            formatEntityTitle(
                              'project',
                              resolveProject(action)?.sequence_number,
                              resolveProject(action)?.title ?? '',
                            ) || null,
                          today: todayStr,
                        })
                      : undefined
                  }
                >
                  {renderActionRow(action, isDest)}
                </ListRow>
              </div>
            )
          })}
        </div>
      )}

      {/* Action Create/Edit Modal */}
      <ActionModal
        isOpen={isActionModalOpen}
        onClose={() => {
          setIsActionModalOpen(false)
          setEditingAction(null)
        }}
        actionToEdit={editingAction}
        defaultContext={contextFilter === 'todos' ? 'trabalho' : contextFilter}
        onSaved={handleModalSaved}
      />

      {/* Progress Log Modal */}
      <ProgressLogModal
        isOpen={Boolean(logModalAction)}
        onClose={() => setLogModalAction(null)}
        action={logModalAction}
        onSaved={handleModalSaved}
      />
    </div>
  )
}

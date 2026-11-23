import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { ActionItem, ActionStatus, Project } from '@/types/execution'
import { TimeEntry, timeService } from '@/services/timeService'
import { actionService } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import {
  checkEligibility,
  ineligibilityLabel,
  isEligibleForFocusDisplay,
  isSelectableForFocus,
  resolveProjectState,
} from '@/lib/eligibility'
import { ActionRow } from '@/components/ActionRow'
import { ActionModal } from '@/components/ActionModal'
import { ProgressLogModal } from '@/components/ProgressLogModal'
import { TimeControl } from '@/components/TimeControlCompact'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Sparkles,
  Plus,
  Calendar,
  AlertCircle,
  ChevronDown,
  RotateCcw,
  CheckCircle,
  Clock,
  Loader2,
  ExternalLink,
} from 'lucide-react'
import { todayInZone, ownerTimezone } from '@/lib/datetime'
import { useToast } from '@/hooks/use-toast'
import { useTimer } from '@/contexts/TimeContext'
import {
  ListRow,
  SummaryToggle,
  actionSummaryLine,
  useSummaryPreference,
  useViewPreference,
  ViewToggle,
} from '@/components/ViewToggle'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { entityNumberCode, formatEntityTitle } from '@/lib/entityNumber'
import { usePegadaMudou } from '@/lib/pegada/useMudou'

function projectBlockLabel(p: Project): string {
  if (p.status === 'pausado') return 'resultado pausado'
  if (p.status === 'arquivado') return 'resultado arquivado'
  if (p.status === 'concluido') return 'resultado encerrado'
  return 'sem próximo avanço definido'
}

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

export const TodayPage: React.FC = () => {
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

  // FATIA 3 — gravação em andamento (impede submissão duplicada por controle)
  const [savingActionId, setSavingActionId] = useState<string | null>(null)

  // Hoje — apresentação Cards/Lista (preferência por dono nesta área).
  const [view, setView] = useViewPreference('hoje', user?.id)
  const [showSummary, setShowSummary] = useSummaryPreference('hoje', user?.id)
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const toggleRow = useCallback((id: string) => {
    setOpenRows((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  // Modals state
  const [isActionModalOpen, setIsActionModalOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null)
  const [logModalAction, setLogModalAction] = useState<ActionItem | null>(null)
  const [isReevaluateOpen, setIsReevaluateOpen] = useState(false)

  // FATIA P1C — "hoje" no fuso do dono (fonte única: lib/datetime).
  const todayStr = todayInZone(ownerTimezone(user?.timezone))

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
  usePegadaMudou(loadData)

  useEffect(() => {
    loadData()
  }, [loadData])

  const loadTimeEntries = useCallback(async () => {
    const actionIds = [...new Set(actions.map((action) => action.id))]
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
      setTimeError(errorMessage(err, 'Não foi possível carregar o tempo das ações.'))
    } finally {
      setTimeLoading(false)
    }
  }, [actions])

  useEffect(() => {
    if (!isLoading) void loadTimeEntries()
  }, [isLoading, loadTimeEntries, revision])

  // FATIA 2 — resolvedor de situação REAL do projeto: usa a lista carregada do
  // backend (mesma consulta). Nunca assume "ativo" para relação não carregada:
  // sem expand e fora da lista = impedimento visível na seção Reavaliar.
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
        contextLabel={actionProject?.title ?? ''}
        targetStatus={action.status}
        projectStatus={actionProject?.status ?? null}
        actionHasProject={Boolean(action.project_id)}
        targetNumberCode={entityNumberCode('action', action.sequence_number)}
        entries={timeEntriesByAction[action.id] ?? []}
        entriesLoading={timeLoading}
        entriesError={timeError}
        onRetryEntries={loadTimeEntries}
        onChanged={loadTimeEntries}
      />
    )
  }

  // FATIA 2 — RENDERIZAÇÃO do foco já escolhido: pronta ou em andamento, e
  // nunca se o projeto estiver pausado/arquivado/encerrado, mesmo com flags antigas.
  const nextAdvanceAction = useMemo(
    () => actions.find((a) => a.is_next_step && isEligibleForFocusDisplay(a, resolveProject)),
    [actions, resolveProject],
  )

  const todaySelectedActions = useMemo(
    () =>
      actions.filter(
        (a) =>
          a.is_today_selected && !a.is_next_step && isEligibleForFocusDisplay(a, resolveProject),
      ),
    [actions, resolveProject],
  )

  // Prazos de hoje em seção separada (prazo não escolhe foco nem altera estado).
  const todayDeadlineActions = useMemo(
    () =>
      actions.filter(
        (a) =>
          a.deadline === todayStr &&
          a.status !== 'feita' &&
          a.status !== 'cancelada' &&
          !a.is_next_step &&
          !a.is_today_selected,
      ),
    [actions, todayStr],
  )

  const overdueActions = useMemo(
    () =>
      actions.filter(
        (a) =>
          a.deadline && a.deadline < todayStr && a.status !== 'feita' && a.status !== 'cancelada',
      ),
    [actions, todayStr],
  )

  const blockedOrWaitingActions = useMemo(
    () =>
      actions.filter(
        (a) =>
          (a.status === 'aguardando' || a.status === 'bloqueada') &&
          (!a.deadline || a.deadline >= todayStr),
      ),
    [actions, todayStr],
  )

  // FATIA 2 — impedimentos de foco (flags antigas preservadas, motivo legível):
  // escolhidas (is_next_step / is_today_selected) mas que não passam na regra
  // compartilhada nem caem nas seções acima → visíveis só em "Reavaliar".
  const focusImpediments = useMemo(
    () =>
      actions.filter((a) => {
        if (!a.is_next_step && !a.is_today_selected) return false
        if (a.is_next_step && a === nextAdvanceAction) return false
        if (a.is_today_selected && todaySelectedActions.includes(a)) return false
        if (a.deadline === todayStr && todayDeadlineActions.includes(a)) return false
        return !checkEligibility(a, resolveProject(a)).ok
      }),
    [actions, nextAdvanceAction, todaySelectedActions, todayDeadlineActions, resolveProject],
  )

  // Projetos pausados/arquivados ou ativos sem próxima ação viável:
  const reevaluateProjects = useMemo(
    () =>
      projects.filter((p) => {
        if (p.status === 'pausado' || p.status === 'arquivado') return true
        if (p.status === 'ativo') {
          const projActions = actions.filter((a) => a.project_id === p.id)
          const hasReadyAction = projActions.some(
            (a) => a.status === 'pronta' || a.status === 'em_andamento',
          )
          return !hasReadyAction // sem próxima ação definida
        }
        return false
      }),
    [projects, actions],
  )

  const reevaluateCount =
    overdueActions.length +
    blockedOrWaitingActions.length +
    focusImpediments.length +
    reevaluateProjects.length

  // FATIA 2 + FATIA 3 — seleção de novo foco: valida com a MESMA regra
  // compartilhada; estado pendente; sucesso só após confirmação real do
  // backend (sem atualização otimista: a lista local é o estado do servidor).
  const handleToggleNextStep = async (id: string, current: boolean) => {
    if (savingActionId) return
    const action = actions.find((a) => a.id === id)
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
      toast({
        variant: 'destructive',
        title: 'Falha ao gravar escolha',
        description: msg,
      })
    } finally {
      setSavingActionId(null)
    }
  }

  const handleToggleTodaySelected = async (id: string, current: boolean) => {
    if (savingActionId) return
    const action = actions.find((a) => a.id === id)
    if (!current && action) {
      const check = checkEligibility(action, resolveProject(action))
      if (!check.ok || !isSelectableForFocus(action, resolveProject(action))) {
        toast({
          variant: 'destructive',
          title: 'Não é possível selecionar',
          description:
            check.label ||
            'Somente avanços "prontos" podem ir para os Poucos Avanços de Hoje. Tente outro avanço ou reavalie este.',
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
      toast({
        variant: 'destructive',
        title: 'Falha ao gravar escolha',
        description: msg,
      })
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
      toast({
        variant: 'destructive',
        title: 'Falha ao atualizar status',
        description: msg,
      })
    } finally {
      setSavingActionId(null)
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Title & Context Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Hoje</h2>
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
            Execução deliberada. Apenas o que você escolhe mover hoje, sem algoritmos de urgência
            artificial.
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
            Novo Avanço
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="rounded-xl border border-destructive/30 bg-ginga-danger-bg p-4 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">Falha ao carregar dados do Hoje.</p>
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

      {/* 1. SEÇÃO PRINCIPAL: Próximo Avanço (singular, deliberado) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-ginga-warning-bg text-ginga-warning border border-ginga-warning/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-wide uppercase text-ginga-warning">
                Próximo Avanço Único
              </h3>
              <p className="text-xs text-muted-foreground">
                O único avanço que, se feito hoje, garante tração real no dia.
              </p>
            </div>
          </div>
        </div>

        {nextAdvanceAction ? (
          <div className="relative">
            {savingActionId === nextAdvanceAction.id && (
              <p className="mb-1.5 text-xs text-ginga-warning flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Gravando escolha…
              </p>
            )}
            {/* Em Lista: o título do item expande a apresentação completa (comandos,
               tempo, descrição); a seção continua identificando o foco. */}
            <ListRow
              title={nextAdvanceAction.title}
              numberKind="action"
              numberValue={nextAdvanceAction.sequence_number}
              numberEntityId={nextAdvanceAction.id}
              open={view === 'cards' || Boolean(openRows[nextAdvanceAction.id])}
              onToggle={() => view === 'list' && toggleRow(nextAdvanceAction.id)}
              summary={
                showSummary && view === 'list'
                  ? actionSummaryLine(nextAdvanceAction, {
                      projectTitle:
                        formatEntityTitle(
                          'project',
                          resolveProject(nextAdvanceAction)?.sequence_number,
                          resolveProject(nextAdvanceAction)?.title ?? '',
                        ) || null,
                      today: todayStr,
                    })
                  : undefined
              }
            >
              <ActionRow
                action={nextAdvanceAction}
                isNextAdvance={true}
                saving={savingActionId === nextAdvanceAction.id}
                onToggleNextStep={handleToggleNextStep}
                onToggleTodaySelected={handleToggleTodaySelected}
                onStatusChange={handleStatusChange}
                onOpenLogModal={setLogModalAction}
                timeControl={renderActionTimeControl(nextAdvanceAction)}
                onEdit={(a) => {
                  setEditingAction(a)
                  setIsActionModalOpen(true)
                }}
              />
            </ListRow>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted p-6 text-center">
            <p className="text-sm text-muted-foreground font-medium">
              Qual avanço você quer fazer agora?
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Escolha deliberadamente um avanço "pronto" da sua lista (estrela) para torná-lo o foco
              do dia. Nada é promovido automaticamente. O catálogo completo está em{' '}
              <span className="font-medium text-foreground">Avanços</span>.
            </p>
          </div>
        )}
      </section>

      {/* 2. Poucas ações selecionadas para Hoje */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
              Poucos Avanços de Hoje ({todaySelectedActions.length})
            </h3>
          </div>
        </div>

        {todaySelectedActions.length > 0 ? (
          <div className="grid gap-2.5">
            {todaySelectedActions.map((action) => (
              <ListRow
                key={action.id}
                title={action.title}
                numberKind="action"
                numberValue={action.sequence_number}
                numberEntityId={action.id}
                open={view === 'cards' || Boolean(openRows[action.id])}
                onToggle={() => view === 'list' && toggleRow(action.id)}
                summary={
                  showSummary && view === 'list'
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
              </ListRow>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted p-4 text-center">
            <p className="text-xs text-muted-foreground">
              Nenhum outro avanço secundário selecionado para hoje. Você pode puxar mais do catálogo
              em <span className="font-medium text-foreground">Avanços</span> — o recorte de Hoje
              continua sendo escolha deliberada, não o catálogo completo.
            </p>
          </div>
        )}
      </section>

      {/* 3. Prazos de Hoje Separados */}
      {todayDeadlineActions.length > 0 && (
        <section className="space-y-3 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-ginga-info-bg text-ginga-info">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-ginga-info">
                Prazos Fatuais de Hoje ({todayDeadlineActions.length})
              </h3>
              <p className="text-xs text-muted-foreground">
                Compromissos externos ou datas limite com vencimento hoje. Prazo não escolhe foco.
              </p>
            </div>
          </div>

          <div className="grid gap-2.5">
            {todayDeadlineActions.map((action) => (
              <ListRow
                key={action.id}
                title={action.title}
                numberKind="action"
                numberValue={action.sequence_number}
                numberEntityId={action.id}
                open={view === 'cards' || Boolean(openRows[action.id])}
                onToggle={() => view === 'list' && toggleRow(action.id)}
                summary={
                  showSummary && view === 'list'
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
              </ListRow>
            ))}
          </div>
        </section>
      )}

      {/* 4. SEÇÃO REAVALIAR (Recolhível) */}
      <section className="pt-4 border-t border-border">
        <Collapsible open={isReevaluateOpen} onOpenChange={setIsReevaluateOpen}>
          <div className="flex items-center justify-between bg-muted border border-border rounded-xl p-3.5 px-4">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-ginga-warning-bg text-ginga-warning">
                <RotateCcw className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-semibold text-foreground">
                  Reavaliar ({reevaluateCount})
                </span>
                <p className="text-xs text-muted-foreground">
                  Atrasadas, aguardando, bloqueadas, fora do foco por impedimento e resultados
                  pausados ou sem avanço
                </p>
              </div>
            </div>

            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground gap-1 text-xs"
              >
                <span>{isReevaluateOpen ? 'Recolher' : 'Expandir'}</span>
                <ChevronDown
                  className={`w-4 h-4 transition-transform ${isReevaluateOpen ? 'rotate-180' : ''}`}
                />
              </Button>
            </CollapsibleTrigger>
          </div>

          <CollapsibleContent className="mt-3 space-y-4 pl-1">
            {/* Ações Atrasadas */}
            {overdueActions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-destructive uppercase tracking-wider">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Avanços com Prazo Passado ({overdueActions.length})</span>
                </div>
                <div className="grid gap-2">
                  {overdueActions.map((action) => (
                    <ListRow
                      key={action.id}
                      title={action.title}
                      numberKind="action"
                      numberValue={action.sequence_number}
                      numberEntityId={action.id}
                      open={view === 'cards' || Boolean(openRows[action.id])}
                      onToggle={() => view === 'list' && toggleRow(action.id)}
                      summary={
                        showSummary && view === 'list'
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
                    </ListRow>
                  ))}
                </div>
              </div>
            )}

            {/* Ações Aguardando ou Bloqueadas */}
            {blockedOrWaitingActions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-ginga-warning uppercase tracking-wider">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Aguardando ou Bloqueados ({blockedOrWaitingActions.length})</span>
                </div>
                <div className="grid gap-2">
                  {blockedOrWaitingActions.map((action) => (
                    <div key={action.id}>
                      <p className="mb-1 text-[11px] text-muted-foreground px-1">
                        Motivo: {ineligibilityLabel(action, resolveProject) || '—'}
                        {action.waiting_for ? ` — ${action.waiting_for}` : ''}
                      </p>
                      <ListRow
                        title={action.title}
                        numberKind="action"
                        numberValue={action.sequence_number}
                        numberEntityId={action.id}
                        open={view === 'cards' || Boolean(openRows[action.id])}
                        onToggle={() => view === 'list' && toggleRow(action.id)}
                        summary={
                          showSummary && view === 'list'
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
                      </ListRow>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* FATIA 2 — ações com flags antigas que não podem aparecer no foco */}
            {focusImpediments.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <CheckCircle className="w-3.5 h-3.5" />
                  <span>Fora do Foco por Impedimento ({focusImpediments.length})</span>
                </div>
                <div className="grid gap-2">
                  {focusImpediments.map((action) => (
                    <div
                      key={action.id}
                      className="p-3 rounded-lg border border-border bg-card flex items-center justify-between gap-3 text-xs"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                        <EntityNumberBadge
                          kind="action"
                          n={action.sequence_number}
                          entityId={action.id}
                        />
                        <span className="truncate">{action.title}</span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0 min-w-0">
                        <span className="text-ginga-warning truncate">
                          Motivo: {ineligibilityLabel(action, resolveProject)}
                        </span>
                        {/* BLOCO 2C — atalho que SOMENTE navega: /avancos?id=<ID>
                           (equivalente ao /acoes?id= da v0.0.45/v0.0.46). Não
                           libera foco, status ou qualquer gravação. */}
                        <Button asChild size="sm" variant="outline" className="text-xs gap-1.5">
                          <Link to={`/avancos?id=${encodeURIComponent(action.id)}`}>
                            <ExternalLink className="w-3.5 h-3.5" />
                            Abrir avanço
                          </Link>
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Projetos que precisam de reavaliação */}
            {reevaluateProjects.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <span>
                    Resultados Pausados ou Sem Próximo Avanço ({reevaluateProjects.length})
                  </span>
                </div>
                <div className="grid gap-2">
                  {reevaluateProjects.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-lg border border-border bg-card flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-center gap-2 truncate min-w-0">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {p.status}
                        </Badge>
                        <EntityNumberBadge kind="project" n={p.sequence_number} entityId={p.id} />
                        <span className="font-medium text-foreground truncate">{p.title}</span>
                      </div>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">{projectBlockLabel(p)}</span>
                        {/* BLOCO 2C — atalho que SOMENTE navega: /resultados?id=<ID>
                          (equivalente ao /projetos?id=). Não pausa/ativa projeto
                          nem altera estado. */}
                        <Button asChild size="sm" variant="outline" className="text-xs gap-1.5">
                          <Link to={`/resultados?id=${encodeURIComponent(p.id)}`}>
                            <ExternalLink className="w-3.5 h-3.5" />
                            Abrir resultado
                          </Link>
                        </Button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reevaluateCount === 0 && (
              <p className="text-xs text-muted-foreground py-2 text-center">
                Nada para reavaliar no momento. Tudo limpo e fluindo.
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      </section>

      {/* Action Create/Edit Modal */}
      <ActionModal
        isOpen={isActionModalOpen}
        onClose={() => {
          setIsActionModalOpen(false)
          setEditingAction(null)
        }}
        actionToEdit={editingAction}
        defaultContext={contextFilter === 'todos' ? 'trabalho' : contextFilter}
        onSaved={loadData}
      />

      {/* Progress Log Modal */}
      <ProgressLogModal
        isOpen={Boolean(logModalAction)}
        onClose={() => setLogModalAction(null)}
        action={logModalAction}
        onSaved={loadData}
      />
    </div>
  )
}

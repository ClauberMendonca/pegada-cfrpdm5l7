import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { ActionItem, ActionStatus, Project } from '@/types/execution'
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
} from 'lucide-react'
import { todayInZone, ownerTimezone } from '@/lib/datetime'
import { useToast } from '@/hooks/use-toast'

function projectBlockLabel(p: Project): string {
  if (p.status === 'pausado') return 'projeto pausado'
  if (p.status === 'arquivado') return 'projeto arquivado'
  if (p.status === 'concluido') return 'projeto encerrado'
  return 'sem próxima ação definida'
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

export const TodayPage: React.FC = () => {
  const { user } = useAuth()
  const { contextFilter } = useGlobalFilter()
  const { toast } = useToast()

  const [actions, setActions] = useState<ActionItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // FATIA 3 — gravação em andamento (impede submissão duplicada por controle)
  const [savingActionId, setSavingActionId] = useState<string | null>(null)

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

  useEffect(() => {
    loadData()
  }, [loadData])

  // FATIA 2 — resolvedor de situação REAL do projeto: usa a lista carregada do
  // backend (mesma consulta). Nunca assume "ativo" para relação não carregada:
  // sem expand e fora da lista = impedimento visível na seção Reavaliar.
  const resolveProject = useCallback(
    (a: ActionItem): Project | null | undefined => resolveProjectState(a, projects),
    [projects],
  )

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
            'Somente ações "pronta" podem ser o próximo avanço único. Tente outra ação ou reavalie esta.',
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
            'Somente ações "pronta" podem ir para as Poucas Ações de Hoje. Tente outra ação ou reavalie esta.',
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

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              setEditingAction(null)
              setIsActionModalOpen(true)
            }}
            disabled={savingActionId !== null}
            className="gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Ação
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
                A única ação que, se feita hoje, garante tração real no dia.
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
            <ActionRow
              action={nextAdvanceAction}
              isNextAdvance={true}
              saving={savingActionId === nextAdvanceAction.id}
              onToggleNextStep={handleToggleNextStep}
              onToggleTodaySelected={handleToggleTodaySelected}
              onStatusChange={handleStatusChange}
              onOpenLogModal={setLogModalAction}
              onEdit={(a) => {
                setEditingAction(a)
                setIsActionModalOpen(true)
              }}
            />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-muted p-6 text-center">
            <p className="text-sm text-muted-foreground font-medium">
              Qual avanço você quer fazer agora?
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Escolha deliberadamente uma ação "pronta" da sua lista (estrela) para torná-la o foco
              do dia. Nada é promovido automaticamente.
            </p>
          </div>
        )}
      </section>

      {/* 2. Poucas ações selecionadas para Hoje */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground">
              Poucas Ações de Hoje ({todaySelectedActions.length})
            </h3>
          </div>
        </div>

        {todaySelectedActions.length > 0 ? (
          <div className="grid gap-2.5">
            {todaySelectedActions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
                saving={savingActionId === action.id}
                onToggleNextStep={handleToggleNextStep}
                onToggleTodaySelected={handleToggleTodaySelected}
                onStatusChange={handleStatusChange}
                onOpenLogModal={setLogModalAction}
                onEdit={(a) => {
                  setEditingAction(a)
                  setIsActionModalOpen(true)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-muted p-4 text-center">
            <p className="text-xs text-muted-foreground">
              Nenhuma outra ação secundária selecionada para hoje. Você pode navegar em Projetos e
              marcar as que deseja puxar.
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
              <ActionRow
                key={action.id}
                action={action}
                saving={savingActionId === action.id}
                onToggleNextStep={handleToggleNextStep}
                onToggleTodaySelected={handleToggleTodaySelected}
                onStatusChange={handleStatusChange}
                onOpenLogModal={setLogModalAction}
                onEdit={(a) => {
                  setEditingAction(a)
                  setIsActionModalOpen(true)
                }}
              />
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
                  Atrasadas, aguardando, bloqueadas, fora do foco por impedimento e projetos
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
                  <span>Ações com Prazo Passado ({overdueActions.length})</span>
                </div>
                <div className="grid gap-2">
                  {overdueActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      saving={savingActionId === action.id}
                      onToggleNextStep={handleToggleNextStep}
                      onToggleTodaySelected={handleToggleTodaySelected}
                      onStatusChange={handleStatusChange}
                      onOpenLogModal={setLogModalAction}
                      onEdit={(a) => {
                        setEditingAction(a)
                        setIsActionModalOpen(true)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Ações Aguardando ou Bloqueadas */}
            {blockedOrWaitingActions.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-ginga-warning uppercase tracking-wider">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Aguardando ou Bloqueadas ({blockedOrWaitingActions.length})</span>
                </div>
                <div className="grid gap-2">
                  {blockedOrWaitingActions.map((action) => (
                    <div key={action.id}>
                      <p className="mb-1 text-[11px] text-muted-foreground px-1">
                        Motivo: {ineligibilityLabel(action, resolveProject) || '—'}
                        {action.waiting_for ? ` — ${action.waiting_for}` : ''}
                      </p>
                      <ActionRow
                        action={action}
                        saving={savingActionId === action.id}
                        onToggleNextStep={handleToggleNextStep}
                        onToggleTodaySelected={handleToggleTodaySelected}
                        onStatusChange={handleStatusChange}
                        onOpenLogModal={setLogModalAction}
                        onEdit={(a) => {
                          setEditingAction(a)
                          setIsActionModalOpen(true)
                        }}
                      />
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
                      <span className="font-medium text-foreground truncate">{action.title}</span>
                      <span className="text-ginga-warning shrink-0">
                        Motivo: {ineligibilityLabel(action, resolveProject)}
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
                  <span>Projetos Pausados ou Sem Próxima Ação ({reevaluateProjects.length})</span>
                </div>
                <div className="grid gap-2">
                  {reevaluateProjects.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-lg border border-border bg-card flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {p.status}
                        </Badge>
                        <span className="font-medium text-foreground truncate">{p.title}</span>
                      </div>
                      <span className="text-muted-foreground shrink-0">{projectBlockLabel(p)}</span>
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

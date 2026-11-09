import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { ActionItem, ActionStatus, Project } from '@/types/execution'
import { actionService } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import { ActionRow } from '@/components/ActionRow'
import { ActionModal } from '@/components/ActionModal'
import { ProgressLogModal } from '@/components/ProgressLogModal'
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
  Inbox,
  Clock,
  Briefcase,
  Heart,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'

export const TodayPage: React.FC = () => {
  const { user } = useAuth()
  const { contextFilter } = useGlobalFilter()
  const { toast } = useToast()

  const [actions, setActions] = useState<ActionItem[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modals state
  const [isActionModalOpen, setIsActionModalOpen] = useState(false)
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null)
  const [logModalAction, setLogModalAction] = useState<ActionItem | null>(null)
  const [isReevaluateOpen, setIsReevaluateOpen] = useState(false)

  // Today calculation in user's timezone or ISO fallback
  const getTodayDateStr = () => {
    try {
      if (user?.timezone) {
        const parts = new Intl.DateTimeFormat('en-CA', {
          timeZone: user.timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date())
        return parts // formatted as YYYY-MM-DD
      }
    } catch {
      /* intentionally ignored */
    }
    return new Date().toISOString().split('T')[0]
  }

  const todayStr = getTodayDateStr()

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const filterContext = contextFilter === 'todos' ? undefined : contextFilter
      const [allActions, allProjects] = await Promise.all([
        actionService.list(filterContext),
        projectService.list(filterContext),
      ])
      setActions(allActions)
      setProjects(allProjects)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar dados'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [contextFilter, toast])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filter actions for Today views
  // 1. Next advance (chosen explicitly, singular)
  const nextAdvanceAction = actions.find(
    (a) => a.is_next_step && a.status !== 'feita' && a.status !== 'cancelada',
  )

  // 2. Few selected actions for today (excluding next advance to avoid duplication)
  const todaySelectedActions = actions.filter(
    (a) =>
      a.is_today_selected && !a.is_next_step && a.status !== 'feita' && a.status !== 'cancelada',
  )

  // 3. Separated deadlines of today (deadline === todayStr, regardless of whether is_today_selected was clicked)
  const todayDeadlineActions = actions.filter(
    (a) =>
      a.deadline === todayStr &&
      a.status !== 'feita' &&
      a.status !== 'cancelada' &&
      !a.is_next_step &&
      !a.is_today_selected,
  )

  // 4. "Reavaliar" collapsible items:
  // - Ações atrasadas (deadline < todayStr and not feita/cancelada)
  // - Ações aguardando ou bloqueadas
  // - Projetos pausados, arquivados ou sem ações prontas
  const overdueActions = actions.filter(
    (a) => a.deadline && a.deadline < todayStr && a.status !== 'feita' && a.status !== 'cancelada',
  )

  const blockedOrWaitingActions = actions.filter(
    (a) =>
      (a.status === 'aguardando' || a.status === 'bloqueada') &&
      (!a.deadline || a.deadline >= todayStr),
  )

  // Inactive or stuck projects:
  const reevaluateProjects = projects.filter((p) => {
    if (p.status === 'pausado' || p.status === 'arquivado') return true
    if (p.status === 'ativo') {
      // Check if project has ready/in-progress actions
      const projActions = actions.filter((a) => a.project_id === p.id)
      const hasReadyAction = projActions.some(
        (a) => a.status === 'pronta' || a.status === 'em_andamento',
      )
      return !hasReadyAction // sem próxima ação definida
    }
    return false
  })

  const reevaluateCount =
    overdueActions.length + blockedOrWaitingActions.length + reevaluateProjects.length

  // Handlers
  const handleToggleNextStep = async (id: string, current: boolean) => {
    try {
      if (current) {
        await actionService.unsetNextStep(id)
      } else {
        await actionService.setAsNextStep(id)
      }
      loadData()
    } catch {
      /* intentionally ignored */
    }
  }

  const handleToggleTodaySelected = async (id: string, current: boolean) => {
    try {
      await actionService.setTodaySelected(id, !current)
      loadData()
    } catch {
      /* intentionally ignored */
    }
  }

  const handleStatusChange = async (id: string, status: ActionStatus, reason?: string) => {
    try {
      await actionService.updateStatus(id, status, reason)
      loadData()
    } catch {
      /* intentionally ignored */
    }
  }

  return (
    <div className="space-y-8">
      {/* Page Title & Context Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-900">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold tracking-tight text-white">Hoje</h2>
            {contextFilter !== 'todos' && (
              <Badge
                variant="outline"
                className={`text-xs uppercase font-medium ${
                  contextFilter === 'trabalho'
                    ? 'border-sky-500/40 text-sky-400 bg-sky-950/30'
                    : 'border-amber-500/40 text-amber-400 bg-amber-950/30'
                }`}
              >
                Filtro: {contextFilter}
              </Badge>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
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
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Nova Ação
          </Button>
        </div>
      </div>

      {/* 1. SEÇÃO PRINCIPAL: Próximo Avanço (singular, explícito) */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-wide uppercase text-amber-300">
                Próximo Avanço Único
              </h3>
              <p className="text-xs text-slate-400">
                A única ação que, se feita hoje, garante tração real no dia.
              </p>
            </div>
          </div>
        </div>

        {nextAdvanceAction ? (
          <ActionRow
            action={nextAdvanceAction}
            isNextAdvance={true}
            onToggleNextStep={handleToggleNextStep}
            onToggleTodaySelected={handleToggleTodaySelected}
            onStatusChange={handleStatusChange}
            onOpenLogModal={setLogModalAction}
            onEdit={(a) => {
              setEditingAction(a)
              setIsActionModalOpen(true)
            }}
          />
        ) : (
          <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 p-6 text-center">
            <p className="text-sm text-slate-400 font-medium">
              Nenhum próximo avanço definido para hoje.
            </p>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Escolha deliberadamente uma ação da sua lista ou crie uma nova clicando na estrela
              para torná-la o foco do dia.
            </p>
          </div>
        )}
      </section>

      {/* 2. Poucas ações selecionadas para Hoje */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
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
          <div className="rounded-xl border border-slate-850 bg-slate-900/20 p-4 text-center">
            <p className="text-xs text-slate-400">
              Nenhuma outra ação secundária selecionada para hoje. Você pode navegar em Projetos e
              marcar as que deseja puxar.
            </p>
          </div>
        )}
      </section>

      {/* 3. Prazos de Hoje Separados */}
      {todayDeadlineActions.length > 0 && (
        <section className="space-y-3 pt-2 border-t border-slate-900">
          <div className="flex items-center gap-2">
            <div className="p-1 rounded bg-sky-500/10 text-sky-400">
              <Calendar className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold uppercase tracking-wider text-sky-300">
                Prazos Fatuais de Hoje ({todayDeadlineActions.length})
              </h3>
              <p className="text-xs text-slate-400">
                Compromissos externos ou datas limite com vencimento hoje.
              </p>
            </div>
          </div>

          <div className="grid gap-2.5">
            {todayDeadlineActions.map((action) => (
              <ActionRow
                key={action.id}
                action={action}
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
      <section className="pt-4 border-t border-slate-900">
        <Collapsible open={isReevaluateOpen} onOpenChange={setIsReevaluateOpen}>
          <div className="flex items-center justify-between bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 px-4">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-400">
                <RotateCcw className="w-4 h-4" />
              </div>
              <div>
                <span className="text-sm font-semibold text-slate-200">
                  Reavaliar ({reevaluateCount})
                </span>
                <p className="text-xs text-slate-400">
                  Atrasadas, aguardando, bloqueadas e projetos pausados ou sem avanço
                </p>
              </div>
            </div>

            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="text-slate-400 hover:text-white gap-1 text-xs"
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
                <div className="flex items-center gap-2 text-xs font-semibold text-rose-400 uppercase tracking-wider">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>Ações com Prazo Passado ({overdueActions.length})</span>
                </div>
                <div className="grid gap-2">
                  {overdueActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
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
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 uppercase tracking-wider">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Aguardando ou Bloqueadas ({blockedOrWaitingActions.length})</span>
                </div>
                <div className="grid gap-2">
                  {blockedOrWaitingActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
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

            {/* Projetos que precisam de reavaliação */}
            {reevaluateProjects.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  <span>Projetos Pausados ou Sem Próxima Ação ({reevaluateProjects.length})</span>
                </div>
                <div className="grid gap-2">
                  {reevaluateProjects.map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-lg border border-slate-800 bg-slate-900/40 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {p.status}
                        </Badge>
                        <span className="font-medium text-slate-300 truncate">{p.title}</span>
                      </div>
                      <span className="text-slate-500 shrink-0">
                        {p.status === 'ativo' ? 'Sem ação pronta' : p.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {reevaluateCount === 0 && (
              <p className="text-xs text-slate-500 py-2 text-center">
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

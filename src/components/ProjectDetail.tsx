import { Escada } from '@/components/Escada'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { TimeEntry } from '@/services/timeService'
import { Project, ActionItem, ProgressLog, ActionStatus, ProjectStatus } from '@/types/execution'
import { projectService } from '@/services/projectService'
import { actionService } from '@/services/actionService'
import { progressService } from '@/services/progressService'
import { ActionRow } from '@/components/ActionRow'
import { StrategySection } from '@/components/StrategySection'
import { ActionModal } from '@/components/ActionModal'
import { ProgressLogModal } from '@/components/ProgressLogModal'
import { ProjectModal } from '@/components/ProjectModal'
import { CompleteProjectDialog } from '@/components/CompleteProjectDialog'
import { ResponsibilityReference } from '@/components/ResponsibilitySelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Target,
  Sparkles,
  CheckCircle2,
  Clock,
  BookOpen,
  Compass,
  ChevronDown,
  Plus,
  ArrowLeft,
  Flame,
  Trophy,
  Edit3,
  PauseCircle,
  PlayCircle,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { formatCalendarDay, ownerTimezone, todayInZone } from '@/lib/datetime'
import { ProjectTimeHistory } from '@/components/TimeControl'
import { TimeControl } from '@/components/TimeControlCompact'
import { useProjectTimeTotals } from '@/components/TimeControlCompact'
import { useTimer } from '@/contexts/TimeContext'
import { formatDuration } from '@/lib/timeHelpers'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { entityNumberCode, formatEntityTitle } from '@/lib/entityNumber'
import {
  ListRow,
  SummaryToggle,
  actionSummaryLine,
  useSummaryPreference,
  useViewPreference,
  ViewToggle,
} from '@/components/ViewToggle'
import { checkEligibility, isSelectableForFocus } from '@/lib/eligibility'
import { usePegadaMudou } from '@/lib/pegada/useMudou'

interface ProjectDetailProps {
  projectId: string
  onBack: () => void
  onProjectUpdated?: () => void
}

export const ProjectDetail: React.FC<ProjectDetailProps> = ({
  projectId,
  onBack,
  onProjectUpdated,
}) => {
  const { toast } = useToast()
  const { user } = useAuth()
  // FATIA P1C — fuso de referência para instantes (created/updated) e rótulo "hoje".
  const timeTotals = useProjectTimeTotals(projectId)
  const { running } = useTimer()
  const [project, setProject] = useState<Project | null>(null)
  const [actions, setActions] = useState<ActionItem[]>([])
  const [logs, setLogs] = useState<ProgressLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // FATIA 3 — gravação em andamento (impede submissão duplicada)
  const [savingActionId, setSavingActionId] = useState<string | null>(null)

  // Ações do projeto — apresentação Cards/Lista (chave comum aos detalhes de projeto).
  const [view, setView] = useViewPreference('detalhe-projeto', user?.id)
  const [showSummary, setShowSummary] = useSummaryPreference('detalhe-projeto', user?.id)
  // BLOCO 4C — "hoje" no fuso do dono, apenas para marcar prazos no resumo.
  const todayStr = todayInZone(ownerTimezone(user?.timezone))
  const [openRows, setOpenRows] = useState<Record<string, boolean>>({})
  const toggleRow = useCallback((id: string) => {
    setOpenRows((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  // BLOCO 5 — conclusão exige decisão explícita diante da condição de término.
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false)
  // Modals
  const [isActionModalOpen, setIsActionModalOpen] = useState(false)
  // FATIA 4B2 — criação INLINE de Estratégia confirmada no ActionModal:
  // incrementa tick para a StrategySection recarregar SOMENTE sua lista de
  // grupos (sem tocar logs/tempo/handlers). Mínimo necessário na ficha.
  const [inlineStrategyTick, setInlineStrategyTick] = useState(0)
  const [editingAction, setEditingAction] = useState<ActionItem | null>(null)
  const [isLogModalOpen, setIsLogModalOpen] = useState(false)
  const [logAction, setLogAction] = useState<ActionItem | null>(null)
  const [is8RsOpen, setIs8RsOpen] = useState(false)
  // Edição da ficha: modal próprio do detalhe (camada acima do detalhe, sem sair dele)
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false)

  // Recarregamentos (ex.: após salvar a ficha) não voltam ao estado de carregamento:
  // a árvore continua montada, o modal de edição fecha sem perder o foco do detalhe.
  const loadData = useCallback(async () => {
    try {
      const [proj, actList, logList] = await Promise.all([
        projectService.getById(projectId),
        actionService.list(undefined, projectId),
        progressService.listByProject(projectId),
      ])
      setProject(proj)
      setActions(actList)
      setLogs(logList)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao carregar detalhes'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [projectId, toast])
  usePegadaMudou(loadData)

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleStatusChange = async (id: string, status: ActionStatus, reason?: string) => {
    if (savingActionId) return
    setSavingActionId(id)
    try {
      await actionService.updateStatus(id, status, reason)
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível gravar. Tente novamente.'
      toast({ variant: 'destructive', title: 'Falha ao atualizar status', description: msg })
    } finally {
      setSavingActionId(null)
    }
  }

  const handleToggleNextStep = async (id: string, current: boolean) => {
    if (savingActionId) return
    // B1 (detalhe) — MESMA regra compartilhada de Hoje/Ações antes de gravar.
    // Retirada explícita (current=true) sempre passa; nova escolha exige
    // elegibilidade (pronta + projeto ativo/rascunho).
    if (!current) {
      const action = actions.find((a) => a.id === id)
      if (!action) return
      const projectState = checkEligibility(action, project)
      if (!projectState.ok || !isSelectableForFocus(action, project)) {
        toast({
          variant: 'destructive',
          title: 'Seleção não permitida',
          description: `${projectState.label ?? 'somente ações "pronta" recebem nova seleção'}. O próximo avanço anterior não foi alterado.`,
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
      const msg = err instanceof Error ? err.message : 'Não foi possível gravar. Tente novamente.'
      toast({ variant: 'destructive', title: 'Falha ao gravar escolha', description: msg })
    } finally {
      setSavingActionId(null)
    }
  }

  const handleToggleTodaySelected = async (id: string, current: boolean) => {
    if (savingActionId) return
    // B1 (detalhe) — retirada explícita (current=true) sempre passa; nova
    // seleção exige elegibilidade, sem gravar flags nem alterar o avanço.
    if (!current) {
      const action = actions.find((a) => a.id === id)
      if (!action) return
      const projectState = checkEligibility(action, project)
      if (!projectState.ok || !isSelectableForFocus(action, project)) {
        toast({
          variant: 'destructive',
          title: 'Seleção não permitida',
          description: `${projectState.label ?? 'somente ações "pronta" recebem nova seleção'}. Nenhuma flag foi gravada.`,
        })
        return
      }
    }
    setSavingActionId(id)
    try {
      await actionService.setTodaySelected(id, !current)
      await loadData()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Não foi possível gravar. Tente novamente.'
      toast({ variant: 'destructive', title: 'Falha ao gravar escolha', description: msg })
    } finally {
      setSavingActionId(null)
    }
  }

  const handleUpdateProjectStatus = async (newStatus: ProjectStatus) => {
    if (!project) return
    try {
      await projectService.update(project.id, { status: newStatus })
      toast({ title: `Resultado alterado para ${newStatus}` })
      loadData()
      onProjectUpdated?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao alterar status'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    }
  }

  const projectTimeEntries = useMemo(() => timeTotals.entries ?? [], [timeTotals.entries])
  const directTimeEntries = useMemo(
    () => projectTimeEntries.filter((entry) => entry.target_type === 'project'),
    [projectTimeEntries],
  )
  const actionTimeEntries = useMemo(() => {
    const grouped = new Map<string, TimeEntry[]>()
    projectTimeEntries.forEach((entry) => {
      if (entry.target_type !== 'action' || !entry.action_id) return
      const current = grouped.get(entry.action_id) ?? []
      current.push(entry)
      grouped.set(entry.action_id, current)
    })
    return grouped
  }, [projectTimeEntries])

  if (isLoading || !project) {
    return (
      <div className="p-8 text-center text-muted-foreground">Carregando ficha do resultado...</div>
    )
  }

  const has8Rs = Boolean(
    project.r_resultado ||
    project.r_razao ||
    project.r_referencia ||
    project.r_rumo ||
    project.r_recursos ||
    project.r_restricoes ||
    project.r_riscos ||
    project.r_responsavel,
  )

  const timeTotalLabel = (seconds: number) =>
    timeTotals.loading || timeTotals.error
      ? '—'
      : projectTimeEntries.some((e) => !e.is_deleted && e.status !== 'running')
        ? formatDuration(seconds)
        : 'Não registrado'
  const runningInProject = running?.project_id === project.id ? running : null
  // BLOCO 5.1/5.2 — estado REAL do projeto (valores do enum, não inventados).
  // Encerrado = concluido | arquivado: bloqueia NOVAS ações; pausado permite
  // planejar pelo próprio detalhe, com aviso (foco/execução seguem regras v0.0.44).
  const isProjectClosed = project.status === 'concluido' || project.status === 'arquivado'
  const isProjectPaused = project.status === 'pausado'
  // B1 (detalhe) — disponibilidade dos comandos de foco por linha: null = pode
  // selecionar; motivo legível = nova seleção bloqueada (retirada explícita de
  // flags já gravadas continua disponível).
  const focusBlockReason = (action: ActionItem): string | null => {
    if (action.is_next_step || action.is_today_selected) return null
    const state = checkEligibility(action, project)
    return state.ok && isSelectableForFocus(action, project) ? null : (state.label ?? 'impedimento')
  }

  const renderActionTimeControl = (action: ActionItem) => (
    <TimeControl
      targetType="action"
      targetId={action.id}
      targetTitle={action.title}
      targetNumberCode={entityNumberCode('action', action.sequence_number)}
      contextLabel={formatEntityTitle('project', project.sequence_number, project.title)}
      targetStatus={action.status}
      projectStatus={action.project_id ? project.status : null}
      actionHasProject={Boolean(action.project_id)}
      entries={actionTimeEntries.get(action.id) ?? []}
      entriesLoading={timeTotals.loading}
      entriesError={timeTotals.error}
      onRetryEntries={timeTotals.reload}
      onChanged={timeTotals.reload}
    />
  )

  // 4B1 — renderizador ÚNICO dos Avanços (abertos / Feitos-Cancelados) usado
  // pela lista sem agrupamento e por cada grupo da seção de Estratégias.
  const renderActionBlocks = (list: ActionItem[]) => {
    const activeList = list.filter((a) => a.status !== 'feita' && a.status !== 'cancelada')
    const completedList = list.filter((a) => a.status === 'feita' || a.status === 'cancelada')
    return (
      <div className="space-y-4">
        {activeList.length > 0 && (
          <div className="grid gap-2.5 [&>*]:min-w-0">
            {activeList.map((action) => (
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
                    ? actionSummaryLine(action, { today: todayStr })
                    : undefined
                }
              >
                <ActionRow
                  action={action}
                  isNextAdvance={action.is_next_step}
                  saving={savingActionId === action.id}
                  onToggleNextStep={handleToggleNextStep}
                  onToggleTodaySelected={handleToggleTodaySelected}
                  onStatusChange={handleStatusChange}
                  focusBlockedReason={focusBlockReason(action)}
                  onOpenLogModal={(a) => {
                    setLogAction(a)
                    setIsLogModalOpen(true)
                  }}
                  timeControl={renderActionTimeControl(action)}
                  onEdit={(a) => {
                    setEditingAction(a)
                    setIsActionModalOpen(true)
                  }}
                />
              </ListRow>
            ))}
          </div>
        )}

        {completedList.length > 0 && (
          <div className="pt-2">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
              Avanços Feitos / Cancelados ({completedList.length})
            </span>
            <div className="grid gap-2">
              {completedList.map((action) => (
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
                      ? actionSummaryLine(action, { today: todayStr })
                      : undefined
                  }
                >
                  <ActionRow
                    action={action}
                    onStatusChange={handleStatusChange}
                    focusBlockedReason={focusBlockReason(action)}
                    onOpenLogModal={(a) => {
                      setLogAction(a)
                      setIsLogModalOpen(true)
                    }}
                    timeControl={renderActionTimeControl(action)}
                  />
                </ListRow>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top back button and actions — no celular, as ações descem para a
         linha de baixo em vez de vazar da tela. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground -ml-2 text-xs gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Lista de Resultados
        </Button>

        <div className="flex flex-wrap items-center gap-2">
          {project.status === 'ativo' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUpdateProjectStatus('pausado')}
              className="text-xs"
            >
              <PauseCircle className="w-3.5 h-3.5 mr-1" />
              Pausar
            </Button>
          )}

          {project.status === 'pausado' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUpdateProjectStatus('ativo')}
              className="text-xs border-pegada-success/40 text-pegada-success hover:bg-pegada-success-bg"
            >
              <PlayCircle className="w-3.5 h-3.5 mr-1" />
              Ativar
            </Button>
          )}

          {project.status !== 'concluido' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleUpdateProjectStatus('concluido')}
              className="text-xs"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-pegada-success" />
              Concluir resultado
            </Button>
          )}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => setIsProjectModalOpen(true)}
            className="text-xs gap-1"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Editar Ficha
          </Button>
        </div>
      </div>

      {/* Main Project Header Card */}
      <div className="rounded-2xl border border-border bg-card p-6 space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={`uppercase text-[10px] tracking-wider font-semibold ${
                project.context === 'trabalho'
                  ? 'bg-pegada-info-bg border border-pegada-info/30 text-pegada-info'
                  : 'bg-pegada-warning-bg border border-pegada-warning/30 text-pegada-warning'
              }`}
            >
              {project.context}
            </Badge>
            <Badge
              variant="outline"
              className="border-border text-muted-foreground uppercase text-[10px]"
            >
              {project.status}
            </Badge>
            {project.deadline && (
              <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                Prazo Factual: {formatCalendarDay(project.deadline)}
              </span>
            )}
          </div>
          <h1 className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-2xl font-bold text-foreground tracking-tight">
            <EntityNumberBadge kind="project" n={project.sequence_number} entityId={project.id} />
            <span className="min-w-0">{project.title}</span>
          </h1>
          {/* 3C1 — Responsabilidade do Resultado confirmado: leitura autenticada
              por ID ( ResponsibilitySelect ), discreta e secundária ao título. */}
          <ResponsibilityReference id={project.responsibility_id || null} />
          <Escada
            paraQue={
              project.responsibility_id
                ? {
                    to: `/responsabilidades?id=${encodeURIComponent(project.responsibility_id)}`,
                    nome: 'a responsabilidade de onde este resultado nasce',
                  }
                : { to: '/mapa', nome: 'o seu propósito' }
            }
            como={{ ancora: 'como-chegar', nome: 'as estratégias e os avanços' }}
          />
        </div>

        {/* Separação Pragmática: Aspiração vs Entrega Controlável */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-muted border border-border space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Aspiração (O que quero alcançar)</span>
            </div>
            <p className="text-sm text-foreground">
              {project.aspiration || (
                <span className="text-muted-foreground italic">Nenhuma aspiração preenchida.</span>
              )}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-muted border border-border space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
              <Target className="w-3.5 h-3.5" />
              <span>Entrega Controlável (O que vou entregar)</span>
            </div>
            <p className="text-sm text-foreground">
              {project.controllable_delivery || (
                <span className="text-muted-foreground italic">
                  Nenhuma entrega controlável especificada.
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Condição de término & Aprendizado durável */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-border">
          <div>
            <span className="text-muted-foreground font-semibold uppercase tracking-wider block mb-1">
              Condição Clara de Término
            </span>
            <p className="text-foreground">
              {project.completion_condition || (
                <span className="text-muted-foreground italic">Não definida</span>
              )}
            </p>
          </div>

          <div>
            <span className="text-pegada-info font-semibold uppercase tracking-wider block mb-1 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" />
              Possível Aprendizado ou Ativo Durável
            </span>
            <p className="text-foreground">
              {project.learning_asset || (
                <span className="text-muted-foreground italic">Sem ativo registrado</span>
              )}
            </p>
          </div>
        </div>

        {/* Os 8 Rs (Recolhível) */}
        {has8Rs && (
          <Collapsible
            open={is8RsOpen}
            onOpenChange={setIs8RsOpen}
            className="pt-2 border-t border-border"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-pegada-success" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Ficha dos Oito Rs
                </span>
              </div>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
                  <span>{is8RsOpen ? 'Recolher Rs' : 'Expandir Rs'}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 ml-1 transition-transform ${is8RsOpen ? 'rotate-180' : ''}`}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-muted p-4 rounded-xl border border-border">
              {project.r_resultado && (
                <div>
                  <span className="text-muted-foreground font-medium block">1. Resultado:</span>
                  <p className="text-foreground mt-0.5">{project.r_resultado}</p>
                </div>
              )}
              {project.r_razao && (
                <div>
                  <span className="text-muted-foreground font-medium block">2. Razão:</span>
                  <p className="text-foreground mt-0.5">{project.r_razao}</p>
                </div>
              )}
              {project.r_referencia && (
                <div>
                  <span className="text-muted-foreground font-medium block">3. Referência:</span>
                  <p className="text-foreground mt-0.5">{project.r_referencia}</p>
                </div>
              )}
              {project.r_rumo && (
                <div>
                  <span className="text-muted-foreground font-medium block">4. Rumo:</span>
                  <p className="text-foreground mt-0.5">{project.r_rumo}</p>
                </div>
              )}
              {project.r_recursos && (
                <div>
                  <span className="text-muted-foreground font-medium block">5. Recursos:</span>
                  <p className="text-foreground mt-0.5">{project.r_recursos}</p>
                </div>
              )}
              {project.r_restricoes && (
                <div>
                  <span className="text-muted-foreground font-medium block">6. Restrições:</span>
                  <p className="text-foreground mt-0.5">{project.r_restricoes}</p>
                </div>
              )}
              {project.r_riscos && (
                <div>
                  <span className="text-muted-foreground font-medium block">7. Riscos:</span>
                  <p className="text-foreground mt-0.5">{project.r_riscos}</p>
                </div>
              )}
              {project.r_responsavel && (
                <div>
                  <span className="text-muted-foreground font-medium block">8. Responsável:</span>
                  <p className="text-foreground mt-0.5">{project.r_responsavel}</p>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>

      <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-bold tracking-tight text-foreground">Tempo do resultado</h3>
            <p className="text-xs text-muted-foreground">
              Total encerrado, separado entre avanços vinculados e tempo direto no resultado.
            </p>
          </div>
          {timeTotals.error && (
            <Button size="sm" variant="outline" onClick={timeTotals.reload}>
              Tentar novamente
            </Button>
          )}
        </div>

        {timeTotals.error && (
          <p role="alert" className="text-sm text-destructive">
            Não foi possível carregar os registros de tempo: {timeTotals.error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <span className="text-xs text-muted-foreground">Total encerrado</span>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {timeTotalLabel(timeTotals.totalSeconds)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <span className="text-xs text-muted-foreground">Das ações</span>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {timeTotalLabel(timeTotals.fromActionsSeconds)}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-muted/40 p-3">
            <span className="text-xs text-muted-foreground">Direto no resultado</span>
            <p className="mt-1 text-lg font-semibold tabular-nums">
              {timeTotalLabel(timeTotals.directSeconds)}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">Cronometrar diretamente neste resultado</p>
            <p className="text-xs text-muted-foreground">
              O registro direto fica separado do tempo das ações.
            </p>
          </div>
          <TimeControl
            targetType="project"
            targetId={project.id}
            targetTitle={project.title}
            contextLabel="Direto no resultado"
            targetStatus={project.status}
            projectStatus={project.status}
            targetNumberCode={entityNumberCode('project', project.sequence_number)}
            entries={directTimeEntries}
            entriesLoading={timeTotals.loading}
            entriesError={timeTotals.error}
            onRetryEntries={timeTotals.reload}
            onChanged={timeTotals.reload}
          />
        </div>

        <ProjectTimeHistory
          entries={projectTimeEntries}
          runningEntry={runningInProject}
          loading={timeTotals.loading}
          error={timeTotals.error}
          onRetry={timeTotals.reload}
        />
      </section>

      {/* AÇÕES VINCULADAS AO PROJETO */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground tracking-tight">
              Avanços do Resultado ({actions.length})
            </h3>
            <p className="text-sm text-muted-foreground">
              Avanços executáveis deste resultado. Escolha o próximo avanço ou selecione para Hoje.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ViewToggle view={view} onChange={setView} />
            {view === 'list' && <SummaryToggle checked={showSummary} onChange={setShowSummary} />}
            {/* BLOCO 5.1 — resultado encerrado não recebe novos avanços pela
                interface: comando desabilitado com motivo legível. Reabrir é
                decisão consciente pelo comando Ativar/Editar Ficha existente. */}
            {isProjectClosed ? (
              <Button size="sm" disabled className="text-xs gap-1.5" title="Resultado encerrado">
                <Plus className="w-4 h-4" />
                Adicionar Avanço
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => {
                  setEditingAction(null)
                  setIsActionModalOpen(true)
                }}
                className="text-xs gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Adicionar Avanço
              </Button>
            )}
          </div>
          {/* Aviso legível sobre o estado que impede (ou condiciona) o planejamento. */}
          {isProjectClosed ? (
            <p role="note" className="text-xs text-pegada-warning">
              Resultado encerrado — não recebe novos avanços. Para planejar novamente, reabra o
              resultado pelo comando existente (Ativar / Editar Ficha) antes de criar avanços
              vinculados.
            </p>
          ) : isProjectPaused ? (
            <p role="note" className="text-xs text-pegada-warning">
              Resultado pausado — você pode planejar avanços; execução e seleção de foco continuam
              sujeitas às regras existentes.
            </p>
          ) : null}
        </div>

        <div id="como-chegar" className="scroll-mt-20" />
        <StrategySection
          projectId={project.id}
          projectLabel={formatEntityTitle('project', project.sequence_number, project.title)}
          actions={actions}
          renderActions={renderActionBlocks}
          refreshTick={inlineStrategyTick}
          onAvancosCriados={() => void loadData()}
        />

        {actions.length === 0 && (
          <div className="p-6 rounded-xl border border-dashed border-border text-center bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Nenhum avanço criado para este resultado ainda.
            </p>
          </div>
        )}
      </section>

      {/* REGISTROS DE PROGRESSO INTEGRADOS */}
      <section className="space-y-4 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground tracking-tight">
              Registros de Progresso ({logs.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Histórico factual: 'executei' (esforço controlável) vs 'resultado aconteceu' (efeito
              do ambiente).
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setLogAction(null)
              setIsLogModalOpen(true)
            }}
            className="text-xs gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Registro de Progresso
          </Button>
        </div>

        {logs.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-border text-center bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Nenhum registro de progresso feito neste resultado.
            </p>
          </div>
        ) : (
          <div className="grid gap-2.5 [&>*]:min-w-0">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 rounded-xl border border-border bg-card flex items-start gap-3"
              >
                <div className="mt-0.5 shrink-0">
                  {log.log_type === 'executei' ? (
                    <div
                      className="p-1.5 rounded-md bg-pegada-success-bg text-pegada-success border border-pegada-success/20"
                      title="Executei (Controlável)"
                    >
                      <Flame className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div
                      className="p-1.5 rounded-md bg-pegada-info-bg text-pegada-info border border-pegada-info/20"
                      title="Resultado Aconteceu (Ambiente)"
                    >
                      <Trophy className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded ${
                        log.log_type === 'executei'
                          ? 'bg-pegada-success-bg text-pegada-success border border-pegada-success/30'
                          : 'bg-pegada-info-bg text-pegada-info border border-pegada-info/30'
                      }`}
                    >
                      {log.log_type === 'executei' ? 'Executei' : 'Resultado Aconteceu'}
                    </span>
                    <span className="text-xs font-mono text-muted-foreground">
                      {formatCalendarDay(log.date)}
                    </span>

                    {log.expand?.action_id && (
                      <span className="text-xs text-muted-foreground truncate max-w-xs">
                        • {log.expand.action_id.title}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{log.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* BLOCO 5.4 — conclusão exige confirmação com a condição de término visível. */}
      <CompleteProjectDialog
        isOpen={isCompleteDialogOpen}
        onClose={() => setIsCompleteDialogOpen(false)}
        project={project}
        onCompleted={() => {
          loadData()
          onProjectUpdated?.()
        }}
      />

      {/* Edição da ficha do resultado — mesmo resultado, sem voltar à lista */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        projectToEdit={project}
        defaultContext={project.context}
        onSaved={() => {
          loadData()
          onProjectUpdated?.()
        }}
      />

      {/* Action modal for creating / editing action within this project */}
      <ActionModal
        isOpen={isActionModalOpen}
        onClose={() => {
          setIsActionModalOpen(false)
          setEditingAction(null)
        }}
        actionToEdit={editingAction}
        defaultContext={project.context}
        defaultProjectId={project.id}
        onSaved={loadData}
        onStrategyCreated={() => setInlineStrategyTick((t) => t + 1)}
      />

      {/* Progress Log Modal */}
      <ProgressLogModal
        isOpen={isLogModalOpen}
        onClose={() => {
          setIsLogModalOpen(false)
          setLogAction(null)
        }}
        action={logAction}
        projectId={project.id}
        project={project}
        onSaved={loadData}
      />
    </div>
  )
}

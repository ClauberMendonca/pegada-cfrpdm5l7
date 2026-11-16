import React, { useState, useEffect, useCallback } from 'react'
import { Project, ActionItem, ProgressLog, ActionStatus, ProjectStatus } from '@/types/execution'
import { projectService } from '@/services/projectService'
import { actionService } from '@/services/actionService'
import { progressService } from '@/services/progressService'
import { ActionRow } from '@/components/ActionRow'
import { ActionModal } from '@/components/ActionModal'
import { ProgressLogModal } from '@/components/ProgressLogModal'
import { ProjectModal } from '@/components/ProjectModal'
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
  Archive,
  PauseCircle,
  PlayCircle,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCalendarDay, formatInstantInZone, ownerTimezone } from '@/lib/datetime'
import { useAuth } from '@/contexts/AuthContext'

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
  // FATIA P1C — fuso de referência para instantes (created/updated) e rótulo "hoje".
  const { user } = useAuth()
  const ownerTz = ownerTimezone(user?.timezone)
  const [project, setProject] = useState<Project | null>(null)
  const [actions, setActions] = useState<ActionItem[]>([])
  const [logs, setLogs] = useState<ProgressLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  // FATIA 3 — gravação em andamento (impede submissão duplicada)
  const [savingActionId, setSavingActionId] = useState<string | null>(null)

  // Modals
  const [isActionModalOpen, setIsActionModalOpen] = useState(false)
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
      toast({ title: `Projeto alterado para ${newStatus}` })
      loadData()
      onProjectUpdated?.()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao alterar status'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    }
  }

  if (isLoading || !project) {
    return (
      <div className="p-8 text-center text-muted-foreground">Carregando ficha do projeto...</div>
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

  const activeActions = actions.filter((a) => a.status !== 'feita' && a.status !== 'cancelada')
  const completedActions = actions.filter((a) => a.status === 'feita' || a.status === 'cancelada')

  return (
    <div className="space-y-6">
      {/* Top back button and actions */}
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground -ml-2 text-xs gap-1.5"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Lista de Projetos
        </Button>

        <div className="flex items-center gap-2">
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
              className="text-xs border-ginga-success/40 text-ginga-success hover:bg-ginga-success-bg"
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
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-ginga-success" />
              Concluir Projeto
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
                  ? 'bg-ginga-info-bg border border-ginga-info/30 text-ginga-info'
                  : 'bg-ginga-warning-bg border border-ginga-warning/30 text-ginga-warning'
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
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{project.title}</h1>
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
            <span className="text-ginga-info font-semibold uppercase tracking-wider block mb-1 flex items-center gap-1">
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
                <Compass className="w-4 h-4 text-ginga-success" />
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

      {/* AÇÕES VINCULADAS AO PROJETO */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-foreground tracking-tight">
              Ações do Projeto ({actions.length})
            </h3>
            <p className="text-xs text-muted-foreground">
              Avanços executáveis deste projeto. Escolha o próximo avanço ou selecione para Hoje.
            </p>
          </div>

          <Button
            size="sm"
            onClick={() => {
              setEditingAction(null)
              setIsActionModalOpen(true)
            }}
            className="text-xs gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Adicionar Ação
          </Button>
        </div>

        {actions.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-border text-center bg-muted/50">
            <p className="text-xs text-muted-foreground">
              Nenhuma ação criada para este projeto ainda.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeActions.length > 0 && (
              <div className="grid gap-2.5">
                {activeActions.map((action) => (
                  <ActionRow
                    key={action.id}
                    action={action}
                    isNextAdvance={action.is_next_step}
                    saving={savingActionId === action.id}
                    onToggleNextStep={handleToggleNextStep}
                    onToggleTodaySelected={handleToggleTodaySelected}
                    onStatusChange={handleStatusChange}
                    onOpenLogModal={(a) => {
                      setLogAction(a)
                      setIsLogModalOpen(true)
                    }}
                    onEdit={(a) => {
                      setEditingAction(a)
                      setIsActionModalOpen(true)
                    }}
                  />
                ))}
              </div>
            )}

            {completedActions.length > 0 && (
              <div className="pt-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-2">
                  Ações Concluídas / Canceladas ({completedActions.length})
                </span>
                <div className="grid gap-2">
                  {completedActions.map((action) => (
                    <ActionRow
                      key={action.id}
                      action={action}
                      onStatusChange={handleStatusChange}
                      onOpenLogModal={(a) => {
                        setLogAction(a)
                        setIsLogModalOpen(true)
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
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
              Nenhum registro de progresso feito neste projeto.
            </p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 rounded-xl border border-border bg-card flex items-start gap-3"
              >
                <div className="mt-0.5 shrink-0">
                  {log.log_type === 'executei' ? (
                    <div
                      className="p-1.5 rounded-md bg-ginga-success-bg text-ginga-success border border-ginga-success/20"
                      title="Executei (Controlável)"
                    >
                      <Flame className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div
                      className="p-1.5 rounded-md bg-ginga-info-bg text-ginga-info border border-ginga-info/20"
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
                          ? 'bg-ginga-success-bg text-ginga-success border border-ginga-success/30'
                          : 'bg-ginga-info-bg text-ginga-info border border-ginga-info/30'
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

      {/* Edição da ficha do projeto — mesmo projeto, sem voltar à lista */}
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
        onSaved={loadData}
      />
    </div>
  )
}

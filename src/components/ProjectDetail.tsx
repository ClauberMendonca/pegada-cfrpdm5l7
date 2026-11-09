import React, { useState, useEffect, useCallback } from 'react'
import { Project, ActionItem, ProgressLog, ActionStatus, ProjectStatus } from '@/types/execution'
import { projectService } from '@/services/projectService'
import { actionService } from '@/services/actionService'
import { progressService } from '@/services/progressService'
import { ActionRow } from '@/components/ActionRow'
import { ActionModal } from '@/components/ActionModal'
import { ProgressLogModal } from '@/components/ProgressLogModal'
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

interface ProjectDetailProps {
  projectId: string
  onBack: () => void
  onEditProject: (project: Project) => void
  onProjectUpdated?: () => void
}

export const ProjectDetail: React.FC<ProjectDetailProps> = ({
  projectId,
  onBack,
  onEditProject,
  onProjectUpdated,
}) => {
  const { toast } = useToast()
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

  const loadData = useCallback(async () => {
    setIsLoading(true)
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
    return <div className="p-8 text-center text-slate-500">Carregando ficha do projeto...</div>
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
          className="text-slate-400 hover:text-white -ml-2 text-xs gap-1.5"
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
              className="text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
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
              className="text-xs border-emerald-700/60 text-emerald-400 hover:bg-emerald-950/20"
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
              className="text-xs border-slate-700 text-slate-300 hover:bg-slate-800"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400" />
              Concluir Projeto
            </Button>
          )}

          <Button
            size="sm"
            onClick={() => onEditProject(project)}
            className="bg-slate-800 hover:bg-slate-700 text-white text-xs gap-1"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Editar Ficha
          </Button>
        </div>
      </div>

      {/* Main Project Header Card */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-5">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className={`uppercase text-[10px] tracking-wider font-semibold ${
                project.context === 'trabalho'
                  ? 'bg-sky-950 border border-sky-800 text-sky-400'
                  : 'bg-amber-950 border border-amber-800 text-amber-400'
              }`}
            >
              {project.context}
            </Badge>
            <Badge
              variant="outline"
              className="border-slate-700 text-slate-300 uppercase text-[10px]"
            >
              {project.status}
            </Badge>
            {project.deadline && (
              <span className="flex items-center gap-1 text-xs font-mono text-slate-400">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                Prazo Factual: {project.deadline}
              </span>
            )}
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{project.title}</h1>
        </div>

        {/* Separação Pragmática: Aspiração vs Entrega Controlável */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-slate-950/60 border border-amber-500/20 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-300">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Aspiração (O que quero alcançar)</span>
            </div>
            <p className="text-sm text-slate-200">
              {project.aspiration || (
                <span className="text-slate-500 italic">Nenhuma aspiração preenchida.</span>
              )}
            </p>
          </div>

          <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/20 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
              <Target className="w-3.5 h-3.5" />
              <span>Entrega Controlável (O que vou entregar)</span>
            </div>
            <p className="text-sm text-slate-200">
              {project.controllable_delivery || (
                <span className="text-slate-500 italic">
                  Nenhuma entrega controlável especificada.
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Condição de término & Aprendizado durável */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs pt-2 border-t border-slate-800/80">
          <div>
            <span className="text-slate-400 font-semibold uppercase tracking-wider block mb-1">
              Condição Clara de Término
            </span>
            <p className="text-slate-200">
              {project.completion_condition || (
                <span className="text-slate-500 italic">Não definida</span>
              )}
            </p>
          </div>

          <div>
            <span className="text-sky-400 font-semibold uppercase tracking-wider block mb-1 flex items-center gap-1">
              <BookOpen className="w-3.5 h-3.5" />
              Possível Aprendizado ou Ativo Durável
            </span>
            <p className="text-slate-200">
              {project.learning_asset || (
                <span className="text-slate-500 italic">Sem ativo registrado</span>
              )}
            </p>
          </div>
        </div>

        {/* Os 8 Rs (Recolhível) */}
        {has8Rs && (
          <Collapsible
            open={is8RsOpen}
            onOpenChange={setIs8RsOpen}
            className="pt-2 border-t border-slate-800/80"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                  Ficha dos Oito Rs
                </span>
              </div>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-slate-400">
                  <span>{is8RsOpen ? 'Recolher Rs' : 'Expandir Rs'}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 ml-1 transition-transform ${is8RsOpen ? 'rotate-180' : ''}`}
                  />
                </Button>
              </CollapsibleTrigger>
            </div>

            <CollapsibleContent className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs bg-slate-950/70 p-4 rounded-xl border border-slate-850">
              {project.r_resultado && (
                <div>
                  <span className="text-slate-400 font-medium block">1. Resultado:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_resultado}</p>
                </div>
              )}
              {project.r_razao && (
                <div>
                  <span className="text-slate-400 font-medium block">2. Razão:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_razao}</p>
                </div>
              )}
              {project.r_referencia && (
                <div>
                  <span className="text-slate-400 font-medium block">3. Referência:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_referencia}</p>
                </div>
              )}
              {project.r_rumo && (
                <div>
                  <span className="text-slate-400 font-medium block">4. Rumo:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_rumo}</p>
                </div>
              )}
              {project.r_recursos && (
                <div>
                  <span className="text-slate-400 font-medium block">5. Recursos:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_recursos}</p>
                </div>
              )}
              {project.r_restricoes && (
                <div>
                  <span className="text-slate-400 font-medium block">6. Restrições:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_restricoes}</p>
                </div>
              )}
              {project.r_riscos && (
                <div>
                  <span className="text-slate-400 font-medium block">7. Riscos:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_riscos}</p>
                </div>
              )}
              {project.r_responsavel && (
                <div>
                  <span className="text-slate-400 font-medium block">8. Responsável:</span>
                  <p className="text-slate-200 mt-0.5">{project.r_responsavel}</p>
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
            <h3 className="text-lg font-bold text-white tracking-tight">
              Ações do Projeto ({actions.length})
            </h3>
            <p className="text-xs text-slate-400">
              Avanços executáveis deste projeto. Escolha o próximo avanço ou selecione para Hoje.
            </p>
          </div>

          <Button
            size="sm"
            onClick={() => {
              setEditingAction(null)
              setIsActionModalOpen(true)
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs gap-1.5"
          >
            <Plus className="w-4 h-4" />
            Adicionar Ação
          </Button>
        </div>

        {actions.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-850 text-center bg-slate-900/20">
            <p className="text-xs text-slate-400">Nenhuma ação criada para este projeto ainda.</p>
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
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">
                  Ações Concluídas / Canceladas ({completedActions.length})
                </span>
                <div className="grid gap-2 opacity-80">
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
      <section className="space-y-4 pt-4 border-t border-slate-900">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-white tracking-tight">
              Registros de Progresso ({logs.length})
            </h3>
            <p className="text-xs text-slate-400">
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
            className="border-slate-700 bg-slate-800 text-slate-200 hover:text-white text-xs gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Novo Registro de Progresso
          </Button>
        </div>

        {logs.length === 0 ? (
          <div className="p-6 rounded-xl border border-dashed border-slate-850 text-center bg-slate-900/20">
            <p className="text-xs text-slate-400">
              Nenhum registro de progresso feito neste projeto.
            </p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {logs.map((log) => (
              <div
                key={log.id}
                className="p-3.5 rounded-xl border border-slate-800/80 bg-slate-900/40 flex items-start gap-3"
              >
                <div className="mt-0.5 shrink-0">
                  {log.log_type === 'executei' ? (
                    <div
                      className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                      title="Executei (Controlável)"
                    >
                      <Flame className="w-3.5 h-3.5" />
                    </div>
                  ) : (
                    <div
                      className="p-1.5 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20"
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
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-sky-950 text-sky-300 border border-sky-800'
                      }`}
                    >
                      {log.log_type === 'executei' ? 'Executei' : 'Resultado Aconteceu'}
                    </span>
                    <span className="text-xs font-mono text-slate-500">{log.date}</span>

                    {log.expand?.action_id && (
                      <span className="text-xs text-slate-400 truncate max-w-xs">
                        • {log.expand.action_id.title}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap">{log.text}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

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

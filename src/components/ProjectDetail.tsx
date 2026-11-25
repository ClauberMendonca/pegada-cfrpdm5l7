import { Referencias } from '@/components/Referencias'
import { Ficha, Recolhido, FichaNaoEncontrada } from '@/components/Ficha'
import { AdicionarNoLugar } from '@/components/mapa/AdicionarNoLugar'
import { fichaDaResponsabilidade, fichaDaVontade } from '@/lib/pegada/enderecos'
import { wishService } from '@/services/wishService'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Triade } from '@/components/Triade'
import { useResponsibilityReference } from '@/hooks/use-responsibility-reference'
import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Project, ActionItem, ProgressLog, ActionStatus, ProjectStatus } from '@/types/execution'
import { projectService } from '@/services/projectService'
import { actionService } from '@/services/actionService'
import { progressService } from '@/services/progressService'
import { LinhaDeAvanco } from '@/components/LinhaDeAvanco'
import { StrategySection } from '@/components/StrategySection'
import { ProgressLogModal } from '@/components/ProgressLogModal'
import { ProjectModal } from '@/components/ProjectModal'
import { CompleteProjectDialog } from '@/components/CompleteProjectDialog'
import { Button } from '@/components/ui/button'
import {
  CheckCircle2,
  Plus,
  Flame,
  Trophy,
  PauseCircle,
  PlayCircle,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCalendarDay } from '@/lib/datetime'
import { ProjectTimeHistory } from '@/components/TimeControl'
import { TimeControl } from '@/components/TimeControlCompact'
import { useProjectTimeTotals } from '@/components/TimeControlCompact'
import { useTimer } from '@/contexts/TimeContext'
import { formatDuration } from '@/lib/timeHelpers'
import { entityNumberCode, formatEntityTitle } from '@/lib/entityNumber'
import { usePegadaMudou } from '@/lib/pegada/useMudou'

interface ProjectDetailProps {
  projectId: string
  /** Mantido para quem chama; a volta agora é a trilha do fio. */
  onBack?: () => void
  onProjectUpdated?: () => void
}

export const ProjectDetail: React.FC<ProjectDetailProps> = ({
  projectId,
  onProjectUpdated,
}) => {
  const { toast } = useToast()
  const navigate = useNavigate()
  // FATIA P1C — fuso de referência para instantes (created/updated) e rótulo "hoje".
  const timeTotals = useProjectTimeTotals(projectId)
  const { running } = useTimer()
  const [project, setProject] = useState<Project | null>(null)
  const responsabilidadeRef = useResponsibilityReference(project?.responsibility_id || null)
  const [vontade, setVontade] = useState<{ id: string; title: string } | null>(null)
  const vontadeId = project?.wish_id || ''
  useEffect(() => {
    setVontade(null)
    if (!vontadeId) return
    let vivo = true
    wishService.getById(vontadeId).then((v) => vivo && setVontade(v)).catch(() => {})
    return () => {
      vivo = false
    }
  }, [vontadeId])
  const [actions, setActions] = useState<ActionItem[]>([])
  const [logs, setLogs] = useState<ProgressLog[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [naoAchou, setNaoAchou] = useState(false)
  // FATIA 3 — gravação em andamento (impede submissão duplicada)
  const [savingActionId, setSavingActionId] = useState<string | null>(null)

  // BLOCO 5 — conclusão exige decisão explícita diante da condição de término.
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false)
  // Modals
  // FATIA 4B2 — criação INLINE de Estratégia confirmada no ActionModal:
  // incrementa tick para a StrategySection recarregar SOMENTE sua lista de
  // grupos (sem tocar logs/tempo/handlers). Mínimo necessário na ficha.
  const [inlineStrategyTick, setInlineStrategyTick] = useState(0)
  const [isLogModalOpen, setIsLogModalOpen] = useState(false)
  const [logAction, setLogAction] = useState<ActionItem | null>(null)
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
    } catch {
      // Sem o resultado em mãos, a ficha diz que não achou e mostra a saída.
      setNaoAchou(true)
    } finally {
      setIsLoading(false)
    }
  }, [projectId])
  usePegadaMudou(loadData)

  useEffect(() => {
    loadData()
  }, [loadData])

  // Um link para uma estratégia desta ficha (#estrategia-…) rola até ela.
  const { hash } = useLocation()
  useEffect(() => {
    if (isLoading || !hash) return
    const t = window.setTimeout(
      () => document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
      300,
    )
    return () => window.clearTimeout(t)
  }, [hash, isLoading])

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

  if (naoAchou && !project) return <FichaNaoEncontrada oQue="este resultado" />
  if (isLoading || !project) {
    return (
      <div className="p-8 text-center text-muted-foreground">Carregando ficha do resultado...</div>
    )
  }

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
  // Os avanços de um grupo: os abertos primeiro, os encerrados depois, em silêncio.
  // Cada linha leva à ficha do avanço, onde ficam os detalhes e os comandos.
  const renderActionBlocks = (list: ActionItem[]) => {
    const abertos = list.filter((a) => a.status !== 'feita' && a.status !== 'cancelada')
    const encerrados = list.filter((a) => a.status === 'feita' || a.status === 'cancelada')
    return (
      <div className="flex flex-col">
        {[...abertos, ...encerrados].map((action) => (
          <LinhaDeAvanco
            key={action.id}
            action={action}
            ocupado={savingActionId !== null}
            onAlternar={(a) => void handleStatusChange(a.id, a.status === 'feita' ? 'pronta' : 'feita')}
          />
        ))}
      </div>
    )
  }

  const STATUS_NOME: Record<string, string> = {
    ativo: 'ativo',
    pausado: 'pausado',
    futuro: 'depois',
    rascunho: 'depois',
    concluido: 'concluído',
    arquivado: 'arquivado',
  }
  const BOTAO =
    'flex h-11 items-center gap-1.5 rounded-full border border-input bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <>
      <Ficha
        degraus={[
          { rotulo: 'Mapa', to: '/mapa' },
          ...(project.wish_id
            ? [{ rotulo: vontade?.title ?? 'Vontade', to: fichaDaVontade(project.wish_id) }]
            : []),
          ...(project.responsibility_id
            ? [
                {
                  rotulo:
                    responsabilidadeRef.status === 'ready'
                      ? responsabilidadeRef.data.title
                      : 'Responsabilidade',
                  to: fichaDaResponsabilidade(project.responsibility_id),
                },
              ]
            : []),
        ]}
        atual={project.title}
        paraQue={
          project.wish_id ? (
            <Link
              to={fichaDaVontade(project.wish_id)}
              className="font-medium underline-offset-4 hover:underline"
            >
              Para realizar {vontade ? `“${vontade.title}”` : 'uma vontade sua'}
            </Link>
          ) : project.responsibility_id ? (
            <Link
              to={fichaDaResponsabilidade(project.responsibility_id)}
              className="font-medium underline-offset-4 hover:underline"
            >
              Para sustentar{' '}
              {responsabilidadeRef.status === 'ready'
                ? `“${responsabilidadeRef.data.title}”`
                : 'uma responsabilidade sua'}
            </Link>
          ) : (
            <p>Resultado livre: não nasce de uma vontade nem de uma responsabilidade. Também vale.</p>
          )
        }
        como={
          <>
            <div id="como-chegar" className="scroll-mt-24" />
            {isProjectClosed && (
              <p role="note" className="px-1 text-sm text-muted-foreground">
                Resultado encerrado. Para planejar de novo, reative o resultado.
              </p>
            )}
            <StrategySection
              projectId={project.id}
              projectLabel={formatEntityTitle('project', project.sequence_number, project.title)}
              actions={actions}
              renderActions={renderActionBlocks}
              refreshTick={inlineStrategyTick}
              onAvancosCriados={() => void loadData()}
              contexto={project.context === 'vida' ? 'vida' : 'trabalho'}
              podeAdicionar={!isProjectClosed}
              rodape={
                !isProjectClosed && (
                  <AdicionarNoLugar
                    tipos={['avanco', 'estrategia']}
                    onde={{ resultadoId: project.id }}
                    contexto={project.context === 'vida' ? 'vida' : 'trabalho'}
                    em={project.title}
                    onCriado={() => {
                      void loadData()
                      setInlineStrategyTick((t) => t + 1)
                    }}
                  />
                )
              }
            />
            <Referencias elemento="resultado" id={project.id} recarregar={actions} />
            <Recolhido titulo={`Notas${logs.length ? ` · ${logs.length}` : ''}`}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLogAction(null)
                  setIsLogModalOpen(true)
                }}
                className="min-h-11 gap-1.5 text-sm"
              >
                <Plus className="h-4 w-4" />
                Nova nota
              </Button>
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
            </Recolhido>
            <Recolhido titulo="Tempo">
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
            </Recolhido>
          </>
        }
      >
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Resultado · {STATUS_NOME[project.status] ?? project.status}
          {project.deadline && ` · até ${formatCalendarDay(project.deadline)}`}
        </p>
        <h1 className="mt-1.5 break-words text-2xl font-semibold leading-tight tracking-tight text-foreground">
          {project.title}
        </h1>
        {!project.deadline && !isProjectClosed && (
          <p className="mt-1 text-sm text-muted-foreground">
            Ainda sem prazo. Um resultado é um estado alcançado e uma data.
          </p>
        )}
        {project.completion_condition && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
              Como vou saber que cheguei
            </p>
            <p className="mt-1 text-base text-foreground">{project.completion_condition}</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Triade
            elemento="resultado"
            id={project.id}
            titulo={project.title}
            onEditar={() => setIsProjectModalOpen(true)}
            arquivado={project.status === 'arquivado'}
            onArquivar={() => handleUpdateProjectStatus(project.status === 'arquivado' ? 'ativo' : 'arquivado')}
            onExcluido={() => navigate('/mapa')}
          />
          {project.status === 'ativo' && (
            <button type="button" onClick={() => handleUpdateProjectStatus('pausado')} className={BOTAO}>
              <PauseCircle className="h-4 w-4" aria-hidden="true" />
              Pausar
            </button>
          )}
          {project.status !== 'ativo' && (
            <button type="button" onClick={() => handleUpdateProjectStatus('ativo')} className={BOTAO}>
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              {isProjectClosed ? 'Reativar' : 'Ativar'}
            </button>
          )}
          {project.status !== 'concluido' && (
            <button type="button" onClick={() => handleUpdateProjectStatus('concluido')} className={BOTAO}>
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
              Concluir resultado
            </button>
          )}
        </div>
      </Ficha>

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
    </>
  )
}

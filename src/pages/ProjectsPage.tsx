import React, { useState, useEffect, useCallback } from 'react'
import { Project, ProjectStatus } from '@/types/execution'
import { projectService } from '@/services/projectService'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { ProjectModal } from '@/components/ProjectModal'
import { ProjectDetail } from '@/components/ProjectDetail'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  FolderKanban,
  Plus,
  Clock,
  Target,
  Sparkles,
  ArrowRight,
  Archive,
  Compass,
} from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { formatCalendarDay, formatInstantInZone, ownerTimezone } from '@/lib/datetime'
import { useAuth } from '@/contexts/AuthContext'
import { ListRow, useViewPreference, ViewToggle } from '@/components/ViewToggle'

export const ProjectsPage: React.FC = () => {
  const { toast } = useToast()
  const { contextFilter } = useGlobalFilter()
  // FATIA P1C — fuso do dono para instantes; prazos são dia-calendário puro.
  const { user } = useAuth()
  const ownerTz = ownerTimezone(user?.timezone)

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'todos'>('todos')
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false)

  const [isLoading, setIsLoading] = useState(true)

  // Projetos — apresentação Cards/Lista (preferência por dono nesta área).
  const [view, setView] = useViewPreference('projetos', user?.id)

  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    try {
      const filterContext = contextFilter === 'todos' ? undefined : contextFilter
      const filterSt = statusFilter === 'todos' ? undefined : statusFilter
      const list = await projectService.list(filterContext, filterSt)
      setProjects(list)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao listar projetos'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [contextFilter, statusFilter, toast])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // If a project is selected, render full ProjectDetail view
  if (selectedProjectId) {
    return (
      <ProjectDetail
        projectId={selectedProjectId}
        onBack={() => setSelectedProjectId(null)}
        onProjectUpdated={loadProjects}
      />
    )
  }

  const getStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case 'rascunho':
        return (
          <Badge variant="outline" className="border-border text-muted-foreground">
            Rascunho
          </Badge>
        )
      case 'ativo':
        return (
          <Badge className="bg-ginga-success-bg text-ginga-success border-ginga-success/30">
            Ativo
          </Badge>
        )
      case 'pausado':
        return (
          <Badge className="bg-ginga-warning-bg text-ginga-warning border-ginga-warning/30">
            Pausado
          </Badge>
        )
      case 'concluido':
        return (
          <Badge className="bg-ginga-info-bg text-ginga-info border-ginga-info/30">Concluído</Badge>
        )
      case 'arquivado':
        return (
          <Badge variant="outline" className="text-muted-foreground border-border line-through">
            Arquivado
          </Badge>
        )
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-primary" />
            Projetos
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fichas completas de projetos separando aspiração e entrega controlável.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
          <Button onClick={() => setIsProjectModalOpen(true)} className="gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" />
            Novo Projeto
          </Button>
        </div>
      </div>

      {/* Filter Tabs by Status */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
        {(['todos', 'ativo', 'rascunho', 'pausado', 'concluido', 'arquivado'] as const).map(
          (st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${
                statusFilter === st
                  ? 'bg-card text-foreground shadow-sm border border-border'
                  : 'text-muted-foreground hover:text-foreground border border-transparent'
              }`}
            >
              {st === 'todos' ? 'Todos os Status' : st.charAt(0).toUpperCase() + st.slice(1)}
            </button>
          ),
        )}
      </div>

      {/* Projects Grid / List */}
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Carregando projetos...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
          <FolderKanban className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">Nenhum projeto encontrado.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Crie um novo projeto para gerenciar aspiração e entregas controláveis.
          </p>
        </div>
      ) : view === 'list' ? (
        /* Lista: título abre o detalhe existente do projeto, sem ficha/modal paralelo. */
        <div className="grid gap-2">
          {projects.map((project) => (
            <ListRow
              key={project.id}
              title={project.title}
              open={false}
              onToggle={() => setSelectedProjectId(project.id)}
              hint={getStatusBadge(project.status)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => setSelectedProjectId(project.id)}
              className="group p-5 rounded-2xl border border-border bg-card hover:bg-accent/50 hover:border-ring/40 transition-all cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(project.status)}
                    <span
                      className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded ${
                        project.context === 'trabalho'
                          ? 'bg-ginga-info-bg text-ginga-info border border-ginga-info/30'
                          : 'bg-ginga-warning-bg text-ginga-warning border border-ginga-warning/30'
                      }`}
                    >
                      {project.context}
                    </span>
                  </div>

                  {project.deadline && (
                    <span className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                      <Clock className="w-3 h-3 text-muted-foreground" />
                      {formatCalendarDay(project.deadline)}
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-base font-bold text-foreground transition-colors">
                    {project.title}
                  </h3>
                </div>

                {/* Aspiração preview */}
                {project.aspiration && (
                  <div className="text-xs text-muted-foreground flex items-start gap-1.5 line-clamp-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ginga-warning" />
                    <span>{project.aspiration}</span>
                  </div>
                )}

                {/* Entrega controlável preview */}
                {project.controllable_delivery && (
                  <div className="text-xs text-muted-foreground flex items-start gap-1.5 line-clamp-2">
                    <Target className="w-3.5 h-3.5 shrink-0 mt-0.5 text-ginga-success" />
                    <span>{project.controllable_delivery}</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1 text-primary font-medium">
                  Ver Ficha e Ações
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatInstantInZone(project.created, ownerTz).split(' ')[0]}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Project Modal */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        defaultContext={contextFilter === 'vida' ? 'vida' : 'trabalho'}
        onSaved={loadProjects}
      />
    </div>
  )
}

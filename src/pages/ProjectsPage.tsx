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

export const ProjectsPage: React.FC = () => {
  const { toast } = useToast()
  const { contextFilter } = useGlobalFilter()

  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'todos'>('todos')
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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
        onEditProject={(p) => {
          setEditingProject(p)
          setIsProjectModalOpen(true)
        }}
        onProjectUpdated={loadProjects}
      />
    )
  }

  const getStatusBadge = (status: ProjectStatus) => {
    switch (status) {
      case 'rascunho':
        return (
          <Badge variant="outline" className="border-slate-700 text-slate-400">
            Rascunho
          </Badge>
        )
      case 'ativo':
        return (
          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">Ativo</Badge>
        )
      case 'pausado':
        return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">Pausado</Badge>
      case 'concluido':
        return <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30">Concluído</Badge>
      case 'arquivado':
        return (
          <Badge variant="outline" className="text-slate-500 border-slate-700 line-through">
            Arquivado
          </Badge>
        )
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-900">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <FolderKanban className="w-6 h-6 text-emerald-400" />
            Projetos
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Fichas completas de projetos separando aspiração e entrega controlável.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              setEditingProject(null)
              setIsProjectModalOpen(true)
            }}
            className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 shadow-sm"
          >
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
                  ? 'bg-slate-800 text-white shadow-sm border border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              {st === 'todos' ? 'Todos os Status' : st.charAt(0).toUpperCase() + st.slice(1)}
            </button>
          ),
        )}
      </div>

      {/* Projects Grid / List */}
      {isLoading ? (
        <div className="p-8 text-center text-slate-500">Carregando projetos...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/20 p-8 text-center">
          <FolderKanban className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400 font-medium">Nenhum projeto encontrado.</p>
          <p className="text-xs text-slate-500 mt-1">
            Crie um novo projeto para gerenciar aspiração e entregas controláveis.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => setSelectedProjectId(project.id)}
              className="group p-5 rounded-2xl border border-slate-800/80 bg-slate-900/50 hover:bg-slate-900 hover:border-slate-700 transition-all cursor-pointer flex flex-col justify-between space-y-4"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {getStatusBadge(project.status)}
                    <span
                      className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded ${
                        project.context === 'trabalho'
                          ? 'bg-sky-950 text-sky-400 border border-sky-800/40'
                          : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                      }`}
                    >
                      {project.context}
                    </span>
                  </div>

                  {project.deadline && (
                    <span className="flex items-center gap-1 text-xs font-mono text-slate-400">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {project.deadline}
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors">
                    {project.title}
                  </h3>
                </div>

                {/* Aspiração preview */}
                {project.aspiration && (
                  <div className="text-xs text-amber-300/90 flex items-start gap-1.5 line-clamp-2">
                    <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
                    <span>{project.aspiration}</span>
                  </div>
                )}

                {/* Entrega controlável preview */}
                {project.controllable_delivery && (
                  <div className="text-xs text-emerald-400/90 flex items-start gap-1.5 line-clamp-2">
                    <Target className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-400" />
                    <span>{project.controllable_delivery}</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                <span className="flex items-center gap-1 text-emerald-400 font-medium">
                  Ver Ficha e Ações
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                </span>
                <span className="font-mono text-[11px] text-slate-500">
                  {new Date(project.created).toLocaleDateString('pt-BR')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Project Modal */}
      <ProjectModal
        isOpen={isProjectModalOpen}
        onClose={() => {
          setIsProjectModalOpen(false)
          setEditingProject(null)
        }}
        projectToEdit={editingProject}
        defaultContext={contextFilter === 'vida' ? 'vida' : 'trabalho'}
        onSaved={loadProjects}
      />
    </div>
  )
}

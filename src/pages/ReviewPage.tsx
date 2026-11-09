import React, { useState, useEffect } from 'react'
import { Project, ActionItem } from '@/types/execution'
import { projectService } from '@/services/projectService'
import { actionService } from '@/services/actionService'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Compass,
  CheckCircle,
  HelpCircle,
  Calendar,
  AlertTriangle,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react'
import { Link } from 'react-router-dom'

export const ReviewPage: React.FC = () => {
  const { contextFilter } = useGlobalFilter()
  const [projects, setProjects] = useState<Project[]>([])
  const [actions, setActions] = useState<ActionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const filterContext = contextFilter === 'todos' ? undefined : contextFilter
    Promise.all([projectService.list(filterContext), actionService.list(filterContext)])
      .then(([projs, acts]) => {
        setProjects(projs)
        setActions(acts)
        setIsLoading(false)
      })
      .catch(() => {
        setIsLoading(false)
      })
  }, [contextFilter])

  // Diagnostic metrics for review
  const activeProjects = projects.filter((p) => p.status === 'ativo')
  const projectsWithoutReadyAction = activeProjects.filter((p) => {
    const projActions = actions.filter((a) => a.project_id === p.id)
    return !projActions.some((a) => a.status === 'pronta' || a.status === 'em_andamento')
  })
  const pausedProjects = projects.filter((p) => p.status === 'pausado')

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-900">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Compass className="w-6 h-6 text-emerald-400" />
            Revisão
          </h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Área de revisão periódica de projetos e calibração de foco.
          </p>
        </div>

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

      {/* ESTADO VAZIO / GUIA PRAGMÁTICO CONFORME ESPECIFICAÇÃO */}
      <Card className="bg-slate-900/60 border-slate-800 text-slate-100">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 mb-2">
            <Compass className="w-6 h-6" />
          </div>
          <CardTitle className="text-xl font-bold text-white">Rito de Revisão Periódica</CardTitle>
          <CardDescription className="text-slate-400 max-w-xl mx-auto text-sm">
            Conforme planejado para esta primeira versão, a área de Revisão começa com estado vazio
            estruturado para orientar o alinhamento da mente do dono entre Vida e Trabalho.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-4">
          {/* Diagnóstico Rápido Atual */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-xs text-slate-400 block font-medium">Projetos Ativos</span>
              <span className="text-2xl font-bold text-white mt-1 block">
                {activeProjects.length}
              </span>
              <span className="text-[11px] text-slate-500">Frentes em andamento simultâneo</span>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-xs text-amber-300 block font-medium">
                Ativos sem Ação Pronta
              </span>
              <span className="text-2xl font-bold text-amber-300 mt-1 block">
                {projectsWithoutReadyAction.length}
              </span>
              <span className="text-[11px] text-slate-500">
                Projetos que necessitam de desdobramento
              </span>
            </div>

            <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
              <span className="text-xs text-slate-400 block font-medium">Projetos Pausados</span>
              <span className="text-2xl font-bold text-slate-300 mt-1 block">
                {pausedProjects.length}
              </span>
              <span className="text-[11px] text-slate-500">Preservados sem pressão de entrega</span>
            </div>
          </div>

          {/* Checklist de Reflexão da Inteligência Pragmática */}
          <div className="p-5 rounded-2xl bg-slate-950/40 border border-slate-800 space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Perguntas-Chave para o Fechamento Semanal
            </h4>

            <div className="space-y-3 text-xs sm:text-sm text-slate-300">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-xs shrink-0 font-bold">
                  1
                </span>
                <div>
                  <strong className="text-white">A entrega controlável ainda faz sentido?</strong>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Avalie se o que você se comprometeu a entregar diretamente ainda é a alavanca
                    certa para a aspiração desejada.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-xs shrink-0 font-bold">
                  2
                </span>
                <div>
                  <strong className="text-white">
                    Existe algum projeto estagnado sem próximo passo?
                  </strong>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Se um projeto ativo não possui nenhuma ação "pronta", defina a próxima ação
                    imediatamente ou pause-o formalmente.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center text-xs shrink-0 font-bold">
                  3
                </span>
                <div>
                  <strong className="text-white">
                    Os aprendizados e ativos duráveis foram registrados?
                  </strong>
                  <p className="text-slate-400 text-xs mt-0.5">
                    Mesmo que o resultado de mercado não tenha vindo, documente o que você construiu
                    como ativo intelectual ou operacional.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <Button asChild className="bg-emerald-600 hover:bg-emerald-500 text-white gap-2">
              <Link to="/projetos">
                <span>Ir para Projetos e Calibrar Fichas</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

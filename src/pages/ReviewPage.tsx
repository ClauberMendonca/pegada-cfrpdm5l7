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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Compass className="w-6 h-6 text-primary" />
            Revisão
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Área de revisão periódica de projetos e calibração de foco.
          </p>
        </div>

        {contextFilter !== 'todos' && (
          <Badge
            variant="outline"
            className={`text-xs uppercase font-medium ${
              contextFilter === 'trabalho'
                ? 'border-ginga-info/30 text-ginga-info bg-ginga-info-bg'
                : 'border-ginga-warning/30 text-ginga-warning bg-ginga-warning-bg'
            }`}
          >
            Filtro: {contextFilter}
          </Badge>
        )}
      </div>

      {/* ESTADO VAZIO / GUIA PRAGMÁTICO CONFORME ESPECIFICAÇÃO */}
      <Card className="bg-card border-border text-card-foreground">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-ginga-success-bg border border-ginga-success/30 flex items-center justify-center text-ginga-success mb-2">
            <Compass className="w-6 h-6" />
          </div>
          <CardTitle className="text-xl font-bold text-foreground">
            Rito de Revisão Periódica
          </CardTitle>
          <CardDescription className="text-muted-foreground max-w-xl mx-auto text-sm">
            Conforme planejado para esta primeira versão, a área de Revisão começa com estado vazio
            estruturado para orientar o alinhamento da mente do dono entre Vida e Trabalho.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6 pt-4">
          {/* Diagnóstico Rápido Atual */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 rounded-xl bg-muted border border-border">
              <span className="text-xs text-muted-foreground block font-medium">
                Projetos Ativos
              </span>
              <span className="text-2xl font-bold text-foreground mt-1 block">
                {activeProjects.length}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Frentes em andamento simultâneo
              </span>
            </div>

            <div className="p-4 rounded-xl bg-ginga-warning-bg border border-ginga-warning/30">
              <span className="text-xs text-ginga-warning block font-medium">
                Ativos sem Ação Pronta
              </span>
              <span className="text-2xl font-bold text-ginga-warning mt-1 block">
                {projectsWithoutReadyAction.length}
              </span>
              <span className="text-[11px] text-ginga-warning/80">
                Projetos que necessitam de desdobramento
              </span>
            </div>

            <div className="p-4 rounded-xl bg-muted border border-border">
              <span className="text-xs text-muted-foreground block font-medium">
                Projetos Pausados
              </span>
              <span className="text-2xl font-bold text-foreground mt-1 block">
                {pausedProjects.length}
              </span>
              <span className="text-[11px] text-muted-foreground">
                Preservados sem pressão de entrega
              </span>
            </div>
          </div>

          {/* Checklist de Reflexão da Inteligência Pragmática */}
          <div className="p-5 rounded-2xl bg-muted border border-border space-y-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-foreground flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-ginga-success" />
              Perguntas-Chave para o Fechamento Semanal
            </h4>

            <div className="space-y-3 text-xs sm:text-sm text-foreground">
              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0 font-bold">
                  1
                </span>
                <div>
                  <strong>A entrega controlável ainda faz sentido?</strong>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    Avalie se o que você se comprometeu a entregar diretamente ainda é a alavanca
                    certa para a aspiração desejada.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0 font-bold">
                  2
                </span>
                <div>
                  <strong>Existe algum projeto estagnado sem próximo passo?</strong>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    Se um projeto ativo não possui nenhuma ação "pronta", defina a próxima ação
                    imediatamente ou pause-o formalmente.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <span className="w-6 h-6 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xs shrink-0 font-bold">
                  3
                </span>
                <div>
                  <strong>Os aprendizados e ativos duráveis foram registrados?</strong>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    Mesmo que o resultado de mercado não tenha vindo, documente o que você construiu
                    como ativo intelectual ou operacional.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-center pt-2">
            <Button asChild className="gap-2">
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

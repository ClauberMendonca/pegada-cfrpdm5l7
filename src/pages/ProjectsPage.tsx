import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useLocation, useNavigate, Link } from 'react-router-dom'
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
  AlertCircle,
  SearchX,
  Search,
  Loader2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { entityNumberCode } from '@/lib/entityNumber'
import { useToast } from '@/hooks/use-toast'
import { formatCalendarDay, formatInstantInZone, ownerTimezone } from '@/lib/datetime'
import { useAuth } from '@/contexts/AuthContext'
import {
  ListRow,
  projectSummaryLine,
  SummaryToggle,
  useSummaryPreference,
  useViewPreference,
  ViewToggle,
} from '@/components/ViewToggle'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'

const STATUS_TABS = ['todos', 'ativo', 'rascunho', 'pausado', 'concluido', 'arquivado'] as const

// BLOCO 2A — recorte de status preservado entre abrir/fechar a ficha (ida e
// volta pela URL, inclusive recarregar). Só UI: nunca persiste dados de
// projeto — apenas a string do filtro, com fallback em memória.
const STATUS_KEY = 'ginga.projects.statusFilter'

function readStatusFilter(): ProjectStatus | 'todos' {
  try {
    const raw = window.sessionStorage.getItem(STATUS_KEY)
    return (STATUS_TABS as readonly string[]).includes(raw ?? '')
      ? (raw as ProjectStatus | 'todos')
      : 'todos'
  } catch {
    return 'todos'
  }
}

function writeStatusFilter(value: ProjectStatus | 'todos'): void {
  try {
    window.sessionStorage.setItem(STATUS_KEY, value)
  } catch {
    // Armazenamento indisponível: recorte vive só em memória.
  }
}

// BLOCO 2A — Ficha retomável por URL: /projetos?id=<ID> abre a ficha do
// projeto; /projetos sem id mantém o catálogo. O detalhe é derivado da URL
// (não de estado em memória), a resolução usa o serviço existente dentro da
// sessão do dono e o retorno ao catálogo preserva filtros/modo e histórico.
export const ProjectsPage: React.FC = () => {
  const { toast } = useToast()
  const { contextFilter } = useGlobalFilter()
  // FATIA P1C — fuso do dono para instantes; prazos são dia-calendário puro.
  const { user } = useAuth()
  const ownerTz = ownerTimezone(user?.timezone)

  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const urlProjectId = searchParams.get('id') || null

  const [projects, setProjects] = useState<Project[]>([])
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | 'todos'>(readStatusFilter)
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // NUMERAÇÃO PERMANENTE 2C — busca local por número/código além do texto.
  // Usa somente os projetos JÁ CARREGADOS (sem consulta nova, sem ranking, sem
  // ordenação própria); consulta integral de número/código é EXATA ("3" acha o
  // projeto 3, não o 13). Comportamento textual (trim/caixa) preservado.
  const [search, setSearch] = useState('')

  const changeStatusFilter = useCallback((value: ProjectStatus | 'todos') => {
    setStatusFilter(value)
    writeStatusFilter(value)
  }, [])

  // Projetos — apresentação Cards/Lista (preferência por dono nesta área).
  const [view, setView] = useViewPreference('projetos', user?.id)
  const [showSummary, setShowSummary] = useSummaryPreference('projetos', user?.id)

  const loadProjects = useCallback(async () => {
    setIsLoading(true)
    try {
      const filterContext = contextFilter === 'todos' ? undefined : contextFilter
      const filterSt = statusFilter === 'todos' ? undefined : statusFilter
      const list = await projectService.list(filterContext, filterSt)
      setProjects(list)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao listar resultados'
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [contextFilter, statusFilter, toast])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // BLOCO 2A — ficha derivada da URL. O ID vem de /projetos?id=<ID> e o
  // projeto é buscado pelo serviço existente na sessão autenticada do dono —
  // recarregar a página reabre a mesma ficha. Filtros/modo do catálogo ficam
  // intactos: nada é alterado para tornar o projeto visível.
  const [urlProject, setUrlProject] = useState<Project | null>(null)
  const [urlProjectState, setUrlProjectState] = useState<'loading' | 'ready' | 'notfound'>(
    'loading',
  )

  // BLOCO 2A(5) — resolve o projeto da URL com guarda de leituras tardias:
  // se a navegação muda para outro ID/catálogo, a resposta antiga é descartada
  // e nenhuma ficha anterior é aberta por engano.
  useEffect(() => {
    if (!urlProjectId) {
      setUrlProject(null)
      setUrlProjectState('loading')
      return
    }
    let cancelled = false
    setUrlProject(null)
    setUrlProjectState('loading')
    projectService
      .getById(urlProjectId)
      .then((p) => {
        if (cancelled) return
        setUrlProject(p)
        setUrlProjectState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setUrlProject(null)
        // 404/erro: destino inexistente ou inacessível — mensagem clara com
        // caminho de volta; nunca expõe dados de outro dono (a leitura já é
        // escopada à sessão autenticada pelo PocketBase).
        setUrlProjectState('notfound')
      })
    return () => {
      cancelled = true
    }
  }, [urlProjectId])

  // BLOCO 2A(3) — abertura empilha histórico (pushState): voltar do navegador
  // retorna ao catálogo sem laço de voltar/reabrir. A origem é declarada por
  // quem navega (Revisão usa state: { from: 'review' }); usado só para decidir
  // o retorno. Sem sistema novo de navegação, sem persistência de dados.
  const openSheet = useCallback(
    (id: string) => {
      navigate(`/projetos?id=${encodeURIComponent(id)}`, {
        state: { from: 'catalog' },
      })
    },
    [navigate],
  )

  const fromReview = location.state?.from === 'review'

  // Catálogo filtrado: busca textual (título, aspiração, entrega controlável)
  // + número/código do banco. O filtro global de contexto e o recorte de status
  // já vieram da consulta; aqui só recorta a exibição local, sem nova consulta
  // e sem gravar nada. "R-3" (novo) ou "P-3" (legado) localizam o resultado 3;
  // número puro é comparação exata. Campos ausentes não geram erro nem texto
  // inventado. (Hook antes de qualquer retorno antecipado da ficha por URL.)
  const filteredProjects = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return projects
    return projects.filter((p) => {
      const inTitle = p.title.toLowerCase().includes(query)
      const inAspiration = (p.aspiration ?? '').toLowerCase().includes(query)
      const inDelivery = (p.controllable_delivery ?? '').toLowerCase().includes(query)
      // Número/código é comparação EXATA: "3" acha o resultado 3, nunca o 13.
      const inNumber = /^\d+$/.test(query) && p.sequence_number === Number(query)
      const inCode =
        typeof p.sequence_number === 'number' &&
        (query === `r-${p.sequence_number}` ||
          query === `p-${p.sequence_number}` ||
          query === entityNumberCode('project', p.sequence_number).toLowerCase())
      return inTitle || inAspiration || inDelivery || inCode || inNumber
    })
  }, [projects, search])

  const closeSheet = useCallback(() => {
    if (fromReview && window.history.length > 1) {
      // Origem Revisão: volta pelo histórico, retornando a /revisao.
      navigate(-1)
    } else {
      // Catálogo/acesso direto: remove o id da URL sem empilhar histórico.
      setSearchParams({}, { replace: true })
    }
  }, [fromReview, navigate, setSearchParams])

  if (urlProjectId && urlProjectState === 'ready' && urlProject) {
    // BLOCO 2A(2) — sinaliza ficha fora do recorte atual (filtro global Vida/
    // Trabalho), sem trocar o filtro silenciosamente para torná-la visível.
    const outOfScope = contextFilter !== 'todos' && urlProject.context !== contextFilter
    return (
      <div className="space-y-4">
        {outOfScope && (
          <div className="rounded-xl border border-ginga-warning/30 bg-ginga-warning-bg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-ginga-warning mt-0.5 shrink-0" />
            <p className="text-xs text-ginga-warning">
              Esta ficha é de {urlProject.context === 'trabalho' ? 'Trabalho' : 'Vida'} e está fora
              do recorte atual ({contextFilter === 'trabalho' ? 'Trabalho' : 'Vida'}).
            </p>
          </div>
        )}
        <ProjectDetail
          projectId={urlProject.id}
          onBack={closeSheet}
          onProjectUpdated={loadProjects}
        />
      </div>
    )
  }

  if (urlProjectId && urlProjectState === 'notfound') {
    // BLOCO 2A(5) — destino inexistente/inacessível: estado distinto de
    // carregamento, com caminho de volta seguro ao catálogo.
    return (
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <SearchX className="w-6 h-6 text-destructive" />
              Ficha não encontrada
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              O resultado desta ficha não existe, foi removido ou não está acessível nesta sessão.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-destructive/30 bg-ginga-danger-bg p-6 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-destructive font-medium">
              Não foi possível abrir a ficha solicitada.
            </p>
            <p className="text-xs text-destructive mt-0.5">
              Verifique o endereço ou volte ao catálogo para escolher outra ficha.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3 gap-1.5">
              <Link to="/projetos">
                <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
                Voltar ao catálogo de resultados
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (urlProjectId) {
    // Carregamento da ficha (resolução do ID da URL) — estado dedicado, sem
    // flash do catálogo e sem abrir ficha anterior por engano.
    return (
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <FolderKanban className="w-6 h-6 text-primary" />
              Resultados
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Abrindo a ficha do resultado…
            </p>
          </div>
        </div>
        <div className="p-8 text-center text-muted-foreground">Carregando ficha…</div>
      </div>
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
            Resultados
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Fichas completas de resultados separando aspiração e entrega controlável.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
          {view === 'list' && <SummaryToggle checked={showSummary} onChange={setShowSummary} />}
          <Button onClick={() => setIsProjectModalOpen(true)} className="gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" />
            Novo resultado
          </Button>
        </div>
      </div>

      {/* Filter Tabs by Status */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-xs">
        {STATUS_TABS.map((st) => (
          <button
            key={st}
            onClick={() => changeStatusFilter(st)}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors whitespace-nowrap ${
              statusFilter === st
                ? 'bg-card text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            {st === 'todos' ? 'Todos os Status' : st.charAt(0).toUpperCase() + st.slice(1)}
          </button>
        ))}
      </div>

      {/* Busca local — número (R-3 / P-3 / 3) ou título; nada é gravado nem
          filtrado no servidor, e a ficha por /projetos?id continua válida fora dela. */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por número (R-3 ou P-3) ou título…"
          aria-label="Buscar resultados por número ou título"
          className="min-h-11 border-input bg-card pl-9 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-ring sm:text-sm"
        />
      </div>

      {/* Projects Grid / List */}
      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Carregando resultados...</div>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
          <FolderKanban className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">Nenhum resultado encontrado.</p>
          <p className="text-xs text-muted-foreground mt-1">
            Crie um novo resultado para gerenciar aspiração e entregas controláveis.
          </p>
        </div>
      ) : filteredProjects.length === 0 ? (
        /* Vazio por busca: distingue de "nenhuma cadastrada" sem trocar filtros. */
        <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
          <SearchX className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-foreground font-medium">
            Nenhum resultado corresponde à busca.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Tente o número (R-3, P-3 ou 3) ou parte do título. Os filtros foram preservados.
          </p>
        </div>
      ) : view === 'list' ? (
        /* Lista: título abre a ficha do projeto pelo mesmo contrato de URL. */
        <div className="grid gap-2">
          {filteredProjects.map((project) => (
            <ListRow
              key={project.id}
              title={project.title}
              numberKind="project"
              numberValue={project.sequence_number}
              numberEntityId={project.id}
              open={false}
              onToggle={() => openSheet(project.id)}
              hint={getStatusBadge(project.status)}
              summary={showSummary ? projectSummaryLine(project) || undefined : undefined}
            />
          ))}
        </div>
      ) : (
        /* Cards: o card inteiro é um link semântico para /projetos?id=<ID> —
           sem onClick em div e sem botões interativos aninhados. */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProjects.map((project) => (
            <Link
              key={project.id}
              to={`/projetos?id=${encodeURIComponent(project.id)}`}
              state={{ from: 'catalog' }}
              className="group p-5 rounded-2xl border border-border bg-card hover:bg-accent/50 hover:border-ring/40 transition-all cursor-pointer flex flex-col justify-between space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

                <div className="min-w-0">
                  <h3 className="text-base font-bold text-foreground transition-colors">
                    <span className="mb-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
                      <EntityNumberBadge
                        kind="project"
                        n={project.sequence_number}
                        entityId={project.id}
                      />
                      <span className="min-w-0 break-words">{project.title}</span>
                    </span>
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
                  Ver ficha e avanços
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                </span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {formatInstantInZone(project.created, ownerTz).split(' ')[0]}
                </span>
              </div>
            </Link>
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

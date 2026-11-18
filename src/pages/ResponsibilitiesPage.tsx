import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  AlertCircle,
  ArrowRight,
  Link2,
  Loader2,
  Plus,
  ScrollText,
  Search,
  SearchX,
} from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { useToast } from '@/hooks/use-toast'
import { Responsibility } from '@/types/execution'
import { responsibilityService } from '@/services/responsibilityService'
import { ResponsibilityModal } from '@/components/ResponsibilityModal'
import { ResponsibilityDetail } from '@/components/ResponsibilityDetail'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  ListRow,
  SummaryToggle,
  useSummaryPreference,
  useViewPreference,
  ViewToggle,
} from '@/components/ViewToggle'

const STATUS_TABS = ['ativas', 'todas', 'arquivadas'] as const
type CatalogStatusFilter = (typeof STATUS_TABS)[number]

// BLOCO 3B — recorte de status do catálogo preservado entre ida e volta à
// ficha (só UI; nunca persiste dados de registros — apenas a string local).
const STATUS_KEY = 'ginga.responsibilities.statusFilter'

function readStatusFilter(): CatalogStatusFilter {
  try {
    const raw = window.sessionStorage.getItem(STATUS_KEY)
    return (STATUS_TABS as readonly string[]).includes(raw ?? '')
      ? (raw as CatalogStatusFilter)
      : 'ativas'
  } catch {
    return 'ativas'
  }
}

function writeStatusFilter(value: CatalogStatusFilter): void {
  try {
    window.sessionStorage.setItem(STATUS_KEY, value)
  } catch {
    // Armazenamento indisponível: recorte vive só em memória.
  }
}

function statusBadge(status: Responsibility['status']): React.ReactNode {
  if (status === 'arquivada') {
    return (
      <Badge variant="outline" className="text-muted-foreground border-border line-through">
        Arquivada
      </Badge>
    )
  }
  return (
    <Badge className="bg-ginga-success-bg text-ginga-success border-ginga-success/30">Ativa</Badge>
  )
}

function contextBadge(context: Responsibility['context']): React.ReactNode {
  return (
    <span
      className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded ${
        context === 'trabalho'
          ? 'bg-ginga-info-bg text-ginga-info border border-ginga-info/30'
          : 'bg-ginga-warning-bg text-ginga-warning border border-ginga-warning/30'
      }`}
    >
      {context === 'trabalho' ? 'Trabalho' : 'Vida'}
    </span>
  )
}

// FATIA 3B — Catálogo de Responsabilidades com ficha retomável por URL
// (/responsabilidades?id=<ID>): catálogo deriva do filtro global Todos/Vida/
// Trabalho + busca local por título/descrição + recorte local de status
// (Ativas inicial). A ficha é leitura autenticada independente do recorte.
export const ResponsibilitiesPage: React.FC = () => {
  const { user } = useAuth()
  const { contextFilter } = useGlobalFilter()
  const { toast } = useToast()

  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()

  const urlResponsibilityId = searchParams.get('id') || null

  const [responsibilities, setResponsibilities] = useState<Responsibility[]>([])
  const [statusFilter, setStatusFilter] = useState<CatalogStatusFilter>(readStatusFilter)
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingResponsibility, setEditingResponsibility] = useState<Responsibility | null>(null)

  // Preferência Cards/Lista/resumo nesta área (por dono), padrão ViewToggle.
  const [view, setView] = useViewPreference('responsabilidades', user?.id)
  const [showSummary, setShowSummary] = useSummaryPreference('responsabilidades', user?.id)

  const changeStatusFilter = useCallback((value: CatalogStatusFilter) => {
    setStatusFilter(value)
    writeStatusFilter(value)
  }, [])

  const loadResponsibilities = useCallback(async () => {
    if (!user?.id) return
    setIsLoading(true)
    setLoadError(null)
    try {
      const list = await responsibilityService.list()
      setResponsibilities(list)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Erro ao listar responsabilidades'
      setLoadError(msg)
      toast({ variant: 'destructive', title: 'Erro', description: msg })
    } finally {
      setIsLoading(false)
    }
  }, [user?.id, toast])

  useEffect(() => {
    // Sem dono autenticado, o catálogo fica vazio até a sessão existir
    // (a rota é protegida, então isto só ocorre brevemente).
    if (!user?.id) {
      setResponsibilities([])
      setIsLoading(false)
      setLoadError(null)
      return
    }
    loadResponsibilities()
  }, [loadResponsibilities, user?.id])

  // Ficha por URL: leitura autenticada independente do recorte do catálogo,
  // com guarda de retornos tardios ao trocar ID.
  const [urlResponsibility, setUrlResponsibility] = useState<Responsibility | null>(null)
  const [urlState, setUrlState] = useState<'loading' | 'ready' | 'notfound'>('loading')

  // Geração de leitura da ficha: mudar de ID (ou recarregar) invalida
  // qualquer resposta tardia de leitura anterior — nunca sobrescreve a ficha
  // de outro ID nem aplica dados fora de ordem.
  const sheetGenRef = useRef(0)

  useEffect(() => {
    // Troca de ID encerra o modal (a edição era da ficha anterior).
    setIsModalOpen(false)
    setEditingResponsibility(null)
    if (!urlResponsibilityId) {
      sheetGenRef.current += 1
      setUrlResponsibility(null)
      setUrlState('loading')
      return
    }
    sheetGenRef.current += 1
    const gen = sheetGenRef.current
    let cancelled = false
    setUrlResponsibility(null)
    setUrlState('loading')
    responsibilityService
      .getById(urlResponsibilityId)
      .then((r) => {
        if (cancelled || gen !== sheetGenRef.current) return
        setUrlResponsibility(r)
        setUrlState('ready')
      })
      .catch(() => {
        if (cancelled || gen !== sheetGenRef.current) return
        setUrlResponsibility(null)
        setUrlState('notfound')
      })
    return () => {
      cancelled = true
    }
  }, [urlResponsibilityId])

  // Retorno seguro ao catálogo: sem laço de voltar/reabrir. Origem real
  // respeita o histórico (navegação declarada); acesso direto remove o id
  // da URL por replace.
  const closeSheet = useCallback(() => {
    if (window.history.length > 1 && location.key !== 'default') {
      navigate(-1)
    } else {
      setSearchParams({}, { replace: true })
    }
  }, [location.key, navigate, setSearchParams])

  // Catálogo: busca local por título/descrição (trim/caixa preservados).
  const filteredResponsibilities = useMemo(() => {
    const query = search.trim().toLowerCase()
    const base = responsibilities.filter((r) => {
      if (contextFilter !== 'todos' && r.context !== contextFilter) return false
      if (statusFilter === 'ativas' && r.status !== 'ativa') return false
      if (statusFilter === 'arquivadas' && r.status !== 'arquivada') return false
      return true
    })
    if (!query) return base
    return base.filter(
      (r) =>
        r.title.toLowerCase().includes(query) ||
        (r.description ?? '').toLowerCase().includes(query),
    )
  }, [responsibilities, contextFilter, statusFilter, search])

  const openCreate = useCallback(() => {
    setEditingResponsibility(null)
    setIsModalOpen(true)
  }, [])

  const openEdit = useCallback((r: Responsibility) => {
    setEditingResponsibility(r)
    setIsModalOpen(true)
  }, [])

  // Falha ao reatualizar a ficha: mantém o que já está visível (sem apagar
  // dados nem fingir sucesso); o catálogo continua com o erro dele.
  const refreshUrlResponsibility = useCallback(() => {
    if (!urlResponsibilityId) return
    sheetGenRef.current += 1
    const gen = sheetGenRef.current
    responsibilityService
      .getById(urlResponsibilityId)
      .then((r) => {
        if (gen !== sheetGenRef.current) return
        setUrlResponsibility(r)
        setUrlState('ready')
      })
      .catch(() => {
        // Silencioso de propósito: a ficha aberta permanece como está.
      })
  }, [urlResponsibilityId])

  const handleModalOpenChange = useCallback((next: boolean) => {
    if (!next) setEditingResponsibility(null)
    setIsModalOpen(next)
  }, [])

  // Salvo confirmado: catálogo atualiza; se a ficha deste ID estiver aberta,
  // ela também reflete o registro salvo (mesmo ID ao cancelar/salvar).
  const handleSaved = useCallback(
    (saved: Responsibility) => {
      loadResponsibilities()
      setUrlResponsibility((current) => (current && current.id === saved.id ? saved : current))
      toast({ title: 'Salvo', description: 'Responsabilidade salva com sucesso.' })
    },
    [loadResponsibilities, toast],
  )

  // Catálogo/formulário — mesma instância em TODAS as telas (o early return
  // da ficha ainda precisa renderizá-la para o Editar funcionar por cima).
  const modalElement = (
    <ResponsibilityModal
      open={isModalOpen}
      responsibility={editingResponsibility}
      globalContext={contextFilter}
      onOpenChange={handleModalOpenChange}
      onSaved={handleSaved}
    />
  )

  // Ficha fora do recorte do catálogo: aviso sem trocar filtros.
  const outOfScope =
    urlResponsibility != null &&
    ((contextFilter !== 'todos' && urlResponsibility.context !== contextFilter) ||
      (statusFilter === 'ativas' && urlResponsibility.status !== 'ativa') ||
      (statusFilter === 'arquivadas' && urlResponsibility.status !== 'arquivada'))

  if (urlResponsibilityId && urlState === 'ready' && urlResponsibility) {
    return (
      <div className="space-y-4">
        {outOfScope && (
          <div className="rounded-xl border border-ginga-warning/30 bg-ginga-warning-bg p-3 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-ginga-warning mt-0.5 shrink-0" />
            <p className="text-xs text-ginga-warning">
              Esta responsabilidade está fora do recorte atual do catálogo (contexto ou status), mas
              continua acessível aqui.
            </p>
          </div>
        )}
        <ResponsibilityDetail
          responsibility={urlResponsibility}
          globalContext={contextFilter}
          onBack={closeSheet}
          onEdit={() => openEdit(urlResponsibility)}
          onChanged={() => {
            loadResponsibilities()
            refreshUrlResponsibility()
          }}
        />
        {modalElement}
      </div>
    )
  }

  if (urlResponsibilityId && urlState === 'notfound') {
    return (
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <SearchX className="w-6 h-6 text-destructive" />
              Ficha não encontrada
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              A responsabilidade desta ficha não existe, foi removida ou não está acessível nesta
              sessão.
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
              <Link to="/responsabilidades">
                <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" />
                Voltar ao catálogo de responsabilidades
              </Link>
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (urlResponsibilityId) {
    return (
      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
              <ScrollText className="w-6 h-6 text-primary" />
              Responsabilidades
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Abrindo a ficha da responsabilidade…
            </p>
          </div>
        </div>
        <div className="p-8 text-center text-muted-foreground">Carregando ficha…</div>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-border">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <ScrollText className="w-6 h-6 text-primary" />
            Responsabilidades
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Compromissos contínuos de Vida e Trabalho, com a hierarquia de Resultados e Avanços
            vinculados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ViewToggle view={view} onChange={setView} />
          {view === 'list' && <SummaryToggle checked={showSummary} onChange={setShowSummary} />}
          <Button onClick={openCreate} className="gap-1.5 shadow-sm">
            <Plus className="w-4 h-4" />
            Nova responsabilidade
          </Button>
        </div>
      </div>

      {/* Recorte local de status (Ativas inicial) */}
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
            {st === 'ativas' ? 'Ativas' : st === 'arquivadas' ? 'Arquivadas' : 'Todas'}
          </button>
        ))}
      </div>

      {/* Busca local por título/descrição */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título ou descrição…"
          aria-label="Buscar responsabilidades por título ou descrição"
          className="min-h-11 border-input bg-card pl-9 text-base text-foreground placeholder:text-muted-foreground focus-visible:ring-ring sm:text-sm"
        />
      </div>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Carregando responsabilidades...</div>
      ) : loadError ? (
        <div className="rounded-xl border border-destructive/30 bg-ginga-danger-bg p-6 text-center">
          <AlertCircle className="w-8 h-8 text-destructive mx-auto mb-2" />
          <p className="text-sm text-destructive font-medium">
            Não foi possível carregar as responsabilidades.
          </p>
          <Button variant="outline" size="sm" className="mt-3" onClick={loadResponsibilities}>
            Tentar novamente
          </Button>
        </div>
      ) : filteredResponsibilities.length === 0 ? (
        responsibilities.length === 0 ? (
          /* Vazio real: nenhuma cadastrada (o catálogo pode começar vazio). */
          <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
            <ScrollText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">
              Nenhuma responsabilidade cadastrada.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Crie um compromisso de Vida ou Trabalho para organizar Resultados e Avanços em torno
              dele.
            </p>
            <Button onClick={openCreate} className="mt-4 gap-1.5">
              <Plus className="w-4 h-4" />
              Nova responsabilidade
            </Button>
          </div>
        ) : (
          /* Vazio pelos filtros locais: distingue do vazio real. */
          <div className="rounded-xl border border-dashed border-border bg-muted p-8 text-center">
            <SearchX className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-foreground font-medium">
              Nenhuma responsabilidade corresponde aos filtros.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Ajuste a busca, o recorte de status ou o filtro global de contexto. Nada foi alterado
              nos registros.
            </p>
          </div>
        )
      ) : view === 'list' ? (
        <div className="grid gap-2">
          {filteredResponsibilities.map((r) => (
            <ListRow
              key={r.id}
              title={r.title}
              open={false}
              onToggle={() => navigate(`/responsabilidades?id=${encodeURIComponent(r.id)}`)}
              hint={statusBadge(r.status)}
              summary={
                showSummary
                  ? `${r.context === 'trabalho' ? 'Trabalho' : 'Vida'} · ${
                      r.status === 'ativa' ? 'Ativa' : 'Arquivada'
                    }`
                  : undefined
              }
            />
          ))}
        </div>
      ) : (
        /* Cards: o card inteiro é link semântico para a ficha, sem botões aninhados. */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredResponsibilities.map((r) => (
            <Link
              key={r.id}
              to={`/responsabilidades?id=${encodeURIComponent(r.id)}`}
              className="group p-5 rounded-2xl border border-border bg-card hover:bg-accent/50 hover:border-ring/40 transition-all cursor-pointer flex flex-col justify-between space-y-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  {contextBadge(r.context)}
                  {statusBadge(r.status)}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-foreground break-words">{r.title}</h3>
                </div>
                {r.description && (
                  <div className="text-xs text-muted-foreground line-clamp-2">
                    <span>{r.description}</span>
                  </div>
                )}
              </div>
              <div className="pt-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1 text-primary font-medium">
                  <Link2 className="w-3.5 h-3.5" />
                  Ver ficha e hierarquia
                  <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-1" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Formulário — aberto do catálogo OU da ficha (mesma instância). */}
      {modalElement}
    </div>
  )
}

export default ResponsibilitiesPage

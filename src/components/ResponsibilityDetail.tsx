/**
 * ENTREGA 3B — Ficha da Responsabilidade (retomável por /responsabilidades?id).
 * Mostra título, contexto, estado, descrição completa em texto puro com
 * quebras, Editar e Arquivar/Reativar — e a hierarquia REAL abaixo, somente
 * leitura: cada Resultado com seus Avanços abaixo DELE, e Avanços diretos
 * (solteiros) em seção separada. Links para /resultados?id e /avancos?id
 * (destinos atuais); sem callbacks de execução, foco, logs, Hoje ou
 * cronômetro nesta visão. Sem botão Excluir.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Anchor,
  ArrowRight,
  ArrowLeft,
  AlertCircle,
  Archive,
  ArchiveRestore,
  Pencil,
  ListChecks,
  Loader2,
  Heart,
  Briefcase,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EntityNumberBadge } from '@/components/EntityNumberBadge'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { Responsibility, Project, ActionItem } from '@/types/execution'
import { responsibilityService } from '@/services/responsibilityService'
import { loadResponsibilityHierarchy, ResponsibilityHierarchy } from '@/lib/responsibilityHierarchy'
import { currentOwnerSnapshot, isSameOwner } from '@/lib/ownerScope'

export interface ResponsibilityDetailProps {
  /** Responsabilidade já resolvida pela página (leitura autenticada). */
  responsibility: Responsibility
  /** Contexto global atual (para o aviso fora do recorte). */
  globalContext: 'todos' | 'vida' | 'trabalho'
  onBack: () => void
  /** Registro alterado (editar/arquivar/reativar) — página recarrega catálogo. */
  onChanged: () => void
  /** Abre o modal de edição por cima da ficha (mesmo ID ao cancelar/salvar). */
  onEdit: () => void
}

export const ResponsibilityDetail: React.FC<ResponsibilityDetailProps> = ({
  responsibility,
  globalContext,
  onBack,
  onChanged,
  onEdit,
}) => {
  const { toast } = useToast()
  const { user } = useAuth()

  const [hierarchy, setHierarchy] = useState<ResponsibilityHierarchy | null>(null)
  const [hierarchyLoading, setHierarchyLoading] = useState(true)
  const [hierarchyError, setHierarchyError] = useState<string | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)

  const outOfScope = globalContext !== 'todos' && responsibility.context !== globalContext
  const archived = responsibility.status === 'arquivada'

  /** Hierarquia: invalida a geração anterior INTEIRA ao mudar alvo/usuário. */
  const loadHierarchy = useCallback(async (respId: string) => {
    const ownerId = currentOwnerSnapshot().ownerId
    if (!ownerId) return
    setHierarchyLoading(true)
    setHierarchyError(null)
    try {
      const result = await loadResponsibilityHierarchy(ownerId, respId)
      if (!isSameOwner({ ownerId })) return // retorno tardio: ignorado
      setHierarchy(result)
      setHierarchyError(result.errors.length > 0 ? result.errors.join(' ') : null)
    } catch {
      if (!isSameOwner({ ownerId })) return
      setHierarchy(null)
      setHierarchyError('Não foi possível carregar os itens vinculados.')
    } finally {
      if (isSameOwner({ ownerId })) setHierarchyLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHierarchy(responsibility.id)
  }, [loadHierarchy, responsibility.id, user?.id])

  /** Arquivar/Reativar: grava status SOMENTE no confirmar (proteção busy). */
  const changeStatus = useCallback(
    async (next: 'ativa' | 'arquivada') => {
      if (statusBusy) return
      setStatusBusy(true)
      try {
        await responsibilityService.setStatus(responsibility.id, next)
        onChanged()
        toast({
          title: next === 'arquivada' ? 'Responsabilidade arquivada' : 'Responsabilidade reativada',
          description:
            next === 'arquivada'
              ? 'Ela deixa de receber novos vínculos; nada mais mudou.'
              : 'Ela volta a poder receber novos vínculos.',
        })
      } catch {
        toast({
          variant: 'destructive',
          title: 'Erro',
          description: 'Não foi possível mudar o estado da responsabilidade.',
        })
      } finally {
        setStatusBusy(false)
      }
    },
    [responsibility.id, onChanged, statusBusy, toast],
  )

  const contextLabel = responsibility.context === 'trabalho' ? 'Trabalho' : 'Vida'
  const ContextIcon = responsibility.context === 'trabalho' ? Briefcase : Heart

  const totalProjects = hierarchy?.projects.length ?? 0
  const directCount = hierarchy?.directActions.length ?? 0
  // Contagem só de dados efetivamente confirmados e únicos (hierarquia pronta).
  const subordinatedCount = hierarchy
    ? Object.values(hierarchy.actionsByProject).reduce((sum, list) => sum + list.length, 0)
    : 0

  return (
    <div className="space-y-8">
      {/* Header da ficha */}
      <div className="flex flex-col gap-4 pb-2 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              aria-label="Voltar ao catálogo de responsabilidades"
              className="min-h-11 min-w-11 shrink-0"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <h2 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
                <Anchor className="w-6 h-6 text-primary shrink-0" aria-hidden="true" />
                <span className="break-words">{responsibility.title}</span>
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <Badge
                  variant="outline"
                  className={cn(
                    'gap-1',
                    responsibility.context === 'trabalho'
                      ? 'border-ginga-info/30 bg-ginga-info-bg text-ginga-info'
                      : 'border-ginga-warning/30 bg-ginga-warning-bg text-ginga-warning',
                  )}
                >
                  <ContextIcon className="h-3 w-3" aria-hidden="true" />
                  {contextLabel}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    archived
                      ? 'text-muted-foreground border-border line-through'
                      : 'border-ginga-success/30 bg-ginga-success-bg text-ginga-success',
                  )}
                >
                  {archived ? 'Arquivada' : 'Ativa'}
                </Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onEdit} className="min-h-11 gap-1.5">
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar
            </Button>
            {archived ? (
              <Button
                variant="outline"
                onClick={() => changeStatus('ativa')}
                disabled={statusBusy}
                className="min-h-11 gap-1.5"
              >
                <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                Reativar
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={() => setArchiveConfirmOpen(true)}
                disabled={statusBusy}
                className="min-h-11 gap-1.5"
              >
                <Archive className="h-4 w-4" aria-hidden="true" />
                Arquivar
              </Button>
            )}
          </div>
        </div>
        {outOfScope && (
          <div className="rounded-xl border border-ginga-warning/30 bg-ginga-warning-bg p-3 flex items-start gap-2">
            <AlertCircle
              className="w-4 h-4 text-ginga-warning mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <p className="text-xs text-ginga-warning">
              Esta responsabilidade é de {contextLabel} e está fora do recorte atual (
              {globalContext === 'trabalho' ? 'Trabalho' : 'Vida'}). Seus filtros não foram
              alterados.
            </p>
          </div>
        )}
      </div>

      {/* Descrição completa em texto puro com quebras */}
      {responsibility.description?.trim() ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-1">Descrição</h3>
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
            {responsibility.description}
          </p>
        </div>
      ) : null}

      {/* Hierarquia real (somente leitura) */}
      <section aria-label="Itens vinculados a esta responsabilidade" className="space-y-4">
        <h3 className="text-lg font-semibold text-foreground">Itens vinculados</h3>

        {hierarchyLoading ? (
          <div className="p-6 text-center text-muted-foreground flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Carregando itens vinculados…
          </div>
        ) : hierarchyError ? (
          <div className="rounded-xl border border-destructive/30 bg-ginga-danger-bg p-4 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-destructive mt-0.5 shrink-0" aria-hidden="true" />
            <div className="flex-1">
              <p className="text-sm text-destructive">{hierarchyError}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-2 min-h-11"
                onClick={() => loadHierarchy(responsibility.id)}
              >
                Tentar novamente
              </Button>
            </div>
          </div>
        ) : hierarchy && totalProjects === 0 && directCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted p-6 text-center">
            <p className="text-sm text-foreground font-medium">Ainda não há itens vinculados.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Escolha a Responsabilidade nos formulários de Resultados e Avanços soltos.
            </p>
          </div>
        ) : hierarchy ? (
          <>
            {/* Resultados vinculados: cada Resultado e, abaixo DELE, seus Avanços */}
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground">
                Resultados vinculados ({totalProjects})
              </h4>
              {hierarchy.projects.map((project) => (
                <LinkedProjectBlock
                  key={project.id}
                  project={project}
                  actions={hierarchy.actionsByProject[project.id] ?? []}
                />
              ))}
            </div>

            {/* Avanços diretos: seção separada (sem subordinação a Resultado) */}
            {directCount > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-muted-foreground">
                  Avanços diretos ({directCount})
                </h4>
                <div className="grid gap-2">
                  {hierarchy.directActions.map((action) => (
                    <LinkedActionRow key={action.id} action={action} />
                  ))}
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {subordinatedCount + directCount} avanço(s) no total — contagem somente leitura, sem
              progresso ou metas.
            </p>
          </>
        ) : null}
      </section>

      {/* Confirmação curta de arquivamento — grava só no confirmar */}
      <Dialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Arquivar responsabilidade?</DialogTitle>
            <DialogDescription>
              Impede novos vínculos. Não pausa Resultados, não cancela Avanços nem altera Hoje ou
              tempo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => setArchiveConfirmOpen(false)}
              disabled={statusBusy}
              className="min-h-11"
            >
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                setArchiveConfirmOpen(false)
                await changeStatus('arquivada')
              }}
              disabled={statusBusy}
              className="min-h-11"
            >
              {statusBusy ? 'Arquivando…' : 'Arquivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Bloco de Resultado + seus Avanços subordinados (read-only, com link). */
const LinkedProjectBlock: React.FC<{ project: Project; actions: ActionItem[] }> = ({
  project,
  actions,
}) => (
  <div className="rounded-xl border border-border bg-card p-4 space-y-3">
    <Link
      to={`/resultados?id=${encodeURIComponent(project.id)}`}
      className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 -mx-2 hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex min-w-0 items-baseline gap-1.5">
        <EntityNumberBadge kind="project" n={project.sequence_number} entityId={project.id} />
        <span className="min-w-0 break-words text-sm font-semibold text-foreground">
          {project.title}
        </span>
        <StatusHint status={project.status} />
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </Link>
    {actions.length > 0 ? (
      <div className="ml-4 space-y-1 border-l border-border pl-3">
        {actions.map((action) => (
          <LinkedActionRow key={action.id} action={action} />
        ))}
      </div>
    ) : (
      <p className="ml-4 border-l border-border pl-3 text-xs text-muted-foreground">
        Nenhum Avanço deste Resultado.
      </p>
    )}
  </div>
)

/** Linha de Avanço read-only com link para /avancos?id (sem executor novo). */
const LinkedActionRow: React.FC<{ action: ActionItem }> = ({ action }) => (
  <Link
    to={`/avancos?id=${encodeURIComponent(action.id)}`}
    className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 -mx-2 hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <span className="flex min-w-0 items-baseline gap-1.5">
      <EntityNumberBadge kind="action" n={action.sequence_number} entityId={action.id} />
      <span className="min-w-0 break-words text-sm text-foreground">{action.title}</span>
      <StatusHint status={action.status} />
    </span>
    <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
  </Link>
)

/** Estado legível sempre (feito/cancelado/arquivados sem apagar texto). */
function StatusHint({ status }: { status: string }) {
  const map: Record<string, string> = {
    rascunho: 'Rascunho',
    ativo: 'Ativo',
    pausado: 'Pausado',
    concluido: 'Concluído',
    arquivado: 'Arquivado',
    pronta: 'Pronta',
    em_andamento: 'Em andamento',
    aguardando: 'Aguardando',
    bloqueada: 'Bloqueada',
    feita: 'Feita',
    cancelada: 'Cancelada',
  }
  return (
    <span className="shrink-0 text-[11px] text-muted-foreground">· {map[status] ?? status}</span>
  )
}

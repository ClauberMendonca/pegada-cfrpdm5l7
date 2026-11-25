/**
 * 4B1 — Seção "Estratégias" da ficha do Resultado (gestão local + agrupamento).
 * - Gestão: lista compacta com título, estado, descrição expansível e comandos
 *   Editar / Arquivar / Reativar que identificam o grupo.
 * - Agrupamento: os Avanços JÁ carregados pela ficha (renderActions, o mesmo
 *   renderizador de linhas da ficha) são organizados por strategy_id.
 * - Lookup de Estratégias carregando/falhando: aviso + retry e os Avanços
 *   seguem na apresentação atual, não agrupada. A falha não afeta a ficha.
 * Nenhuma ação de grupo seleciona/conclui/cria Avanço ou muda o Resultado.
 */
import { Referencias } from '@/components/Referencias'
import { Desdobrar } from '@/components/Desdobrar'
import { op as pegadaOp } from '@/lib/pegada/api'
import React, { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Archive, ChevronDown, Edit3, Plus, RotateCcw } from 'lucide-react'
import { StrategyModal } from '@/components/StrategyModal'
import { useProjectStrategies } from '@/hooks/use-project-strategies'
import { useToast } from '@/hooks/use-toast'
import { strategyService } from '@/services/strategyService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { groupActionsByStrategy, strategyGroupLabel } from '@/lib/strategyGroups'
import { ActionItem, Strategy } from '@/types/execution'

export interface StrategySectionProps {
  projectId: string
  /** Identificação do Resultado (código + título persistidos), só leitura. */
  projectLabel: string
  actions: ActionItem[]
  /** Renderizador existente dos Avanços (abertos/Feitos, Cards/Lista, handlers da ficha). */
  renderActions: (list: ActionItem[]) => React.ReactNode
  /** 4B2 — tick incrementado quando o ActionModal confirma criação INLINE de
     Estratégia: recarrega SOMENTE esta lista de grupos (hook82), sem tocar
     logs/tempo/handlers. Opcional — chamadores antigos continuam compatíveis. */
  refreshTick?: number
  /** Avisa a ficha quando o desdobrar criou avanços, para ela recarregar a lista. */
  onAvancosCriados?: () => void
}

const ARCHIVE_HINT =
  'Impede novos vínculos. Os avanços já vinculados permanecem e nada muda em Hoje ou no tempo.'

export const StrategySection: React.FC<StrategySectionProps> = ({
  projectId,
  projectLabel,
  actions,
  renderActions,
  refreshTick,
  onAvancosCriados,
}) => {
  const { toast } = useToast()
  const strategies = useProjectStrategies(projectId)
  const helpId = useId()

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Strategy | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Strategy | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const archiveBusyRef = useRef(false)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)
  const statusBusyRef = useRef(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Troca de Resultado fecha diálogos abertos: nada vai para o pai errado.
  useEffect(() => {
    setIsModalOpen(false)
    setEditing(null)
    setArchiveTarget(null)
    setArchiveError(null)
  }, [projectId])

  // 4B2 — criação inline confirmada no ActionModal: recarrega SOMENTE a lista
  // de grupos deste Resultado (mesmo que o Avanço seja cancelado depois).
  useEffect(() => {
    if (refreshTick === undefined || refreshTick === 0) return
    strategies.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick])

  const grouped = !strategies.loading && !strategies.error
  const groups = useMemo(
    () => (grouped ? groupActionsByStrategy(actions, strategies.items) : []),
    [grouped, actions, strategies.items],
  )

  const handleSetStatus = async (strategy: Strategy, next: 'ativa' | 'arquivada') => {
    if (statusBusyRef.current) return
    statusBusyRef.current = true
    setStatusBusyId(strategy.id)
    try {
      const saved = await strategyService.setStatus(strategy.id, next)
      strategies.upsert(saved)
      toast({
        title: next === 'ativa' ? 'Estratégia reativada' : 'Estratégia arquivada',
        description: strategy.title,
      })
    } catch (err: unknown) {
      toast({
        variant: 'destructive',
        title: 'Falha ao atualizar estratégia',
        description: getErrorMessage(err) || 'Não foi possível gravar. Tente novamente.',
      })
    } finally {
      statusBusyRef.current = false
      setStatusBusyId(null)
    }
  }

  const confirmArchive = async () => {
    if (!archiveTarget || archiveBusyRef.current) return
    archiveBusyRef.current = true
    setArchiveBusy(true)
    setArchiveError(null)
    try {
      const saved = await strategyService.setStatus(archiveTarget.id, 'arquivada')
      strategies.upsert(saved)
      archiveBusyRef.current = false
      setArchiveBusy(false)
      setArchiveTarget(null)
      toast({ title: 'Estratégia arquivada', description: saved.title })
    } catch (err: unknown) {
      archiveBusyRef.current = false
      setArchiveBusy(false)
      setArchiveError(getErrorMessage(err) || 'Não foi possível arquivar. Tente novamente.')
    }
  }

  const handleSaved = (saved: Strategy, created: boolean) => {
    strategies.upsert(saved)
    toast({
      title: created ? 'Estratégia criada' : 'Estratégia atualizada',
      description: saved.title,
    })
  }

  const openNew = () => {
    setEditing(null)
    setIsModalOpen(true)
  }
  const openEdit = (strategy: Strategy) => {
    setEditing(strategy)
    setIsModalOpen(true)
  }

  const toggleExpanded = (id: string) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  return (
    <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-base font-bold tracking-tight text-foreground">
            Estratégias
            {!strategies.loading && !strategies.error && (
              <span className="ml-1.5 text-muted-foreground">({strategies.items.length})</span>
            )}
          </h4>
          <p id={helpId} className="text-xs text-muted-foreground">
            Caminhos escolhidos para buscar este resultado. Avanços podem ficar sem estratégia.
          </p>
        </div>
      </div>

      <Desdobrar
        nivel="resultado"
        texto={projectLabel}
        rotulo="Desdobrar em estratégias"
        onCriar={async (s) => {
          await pegadaOp('criar_estrategia', { resultado_id: projectId, titulo: s.titulo })
        }}
        onCriados={() => strategies.reload()}
      />

      {strategies.loading && (
        <p role="status" className="text-xs text-muted-foreground">
          Carregando estratégias…
        </p>
      )}

      {strategies.error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <span>
            Não foi possível carregar as estratégias: {strategies.error}. Os avanços seguem abaixo
            sem agrupamento.
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={strategies.reload}
            className="min-h-11 bg-background text-foreground sm:min-h-9"
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {!strategies.loading && !strategies.error && strategies.items.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Nenhuma estratégia criada. Os avanços continuam em "Sem estratégia".
        </p>
      )}

      {strategies.items.length > 0 && (
        <ul className="grid gap-2" aria-describedby={helpId}>
          {strategies.items.map((strategy) => {
            const isArchived = strategy.status === 'arquivada'
            const isOpen = Boolean(expanded[strategy.id])
            const busy = statusBusyId === strategy.id
            return (
              <li
                key={strategy.id}
                id={`estrategia-${strategy.id}`}
                className="scroll-mt-24 rounded-xl border border-border bg-muted/40 p-3 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 break-words text-sm font-medium text-foreground">
                    {strategy.title}
                  </span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {isArchived ? 'Arquivada' : 'Ativa'}
                  </Badge>
                </div>
                {!isArchived && (
                  <Desdobrar
                    nivel="estrategia"
                    texto={`Estratégia: ${strategy.title}. Resultado: ${projectLabel}`}
                    rotulo="Desdobrar em avanços"
                    onCriar={async (s) => {
                      const tipo = ['acao', 'compromisso', 'estudo', 'reflexao', 'ideia', 'espera'].includes(
                        s.tipo || '',
                      )
                        ? s.tipo
                        : 'acao'
                      await pegadaOp('criar_avanco', {
                        titulo: s.titulo,
                        tipo,
                        resultado_id: projectId,
                        estrategia_id: strategy.id,
                        ...(tipo === 'espera' ? { aguardando: 'A definir' } : {}),
                      })
                    }}
                    onCriados={() => onAvancosCriados?.()}
                  />
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-expanded={isOpen}
                    aria-controls={`strategy-desc-${strategy.id}`}
                    onClick={() => toggleExpanded(strategy.id)}
                    className="min-h-11 gap-1 text-xs sm:min-h-9"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      aria-hidden="true"
                    />
                    {isOpen ? 'Ocultar descrição' : 'Ver descrição'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => openEdit(strategy)}
                    aria-label={`Editar estratégia ${strategy.title}`}
                    className="min-h-11 gap-1 text-xs sm:min-h-9"
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                    Editar
                  </Button>
                  {isArchived ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => handleSetStatus(strategy, 'ativa')}
                      aria-label={`Reativar estratégia ${strategy.title}`}
                      className="min-h-11 gap-1 text-xs sm:min-h-9"
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      Reativar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setArchiveError(null)
                        setArchiveTarget(strategy)
                      }}
                      aria-label={`Arquivar estratégia ${strategy.title}`}
                      className="min-h-11 gap-1 text-xs sm:min-h-9"
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                      Arquivar
                    </Button>
                  )}
                </div>
                {isOpen && (
                  <p
                    id={`strategy-desc-${strategy.id}`}
                    className="whitespace-pre-wrap break-words text-sm text-foreground"
                  >
                    {strategy.description || (
                      <span className="italic text-muted-foreground">Sem descrição.</span>
                    )}
                  </p>
                )}
                {isOpen && <Referencias elemento="estrategia" id={strategy.id} />}
              </li>
            )
          })}
        </ul>
      )}

      {/* Agrupamento: só com a lista de Estratégias confirmada. */}
      {actions.length > 0 &&
        (grouped ? (
          <div className="space-y-4">
            {groups.map((group) => {
              const archived = group.kind === 'strategy' && group.strategy?.status === 'arquivada'
              return (
                <div key={group.key} className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 border-b border-border pb-1">
                    <span className="min-w-0 break-words text-sm font-semibold text-foreground">
                      {strategyGroupLabel(group)}
                    </span>
                    {archived && (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        Arquivada
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {group.actions.length} {group.actions.length === 1 ? 'avanço' : 'avanços'}
                    </span>
                  </div>
                  {renderActions(group.actions)}
                </div>
              )
            })}
          </div>
        ) : (
          renderActions(actions)
        ))}

      <StrategyModal
        open={isModalOpen}
        strategy={editing}
        projectId={projectId}
        projectLabel={projectLabel}
        onOpenChange={(open) => {
          setIsModalOpen(open)
          if (!open) setEditing(null)
        }}
        onSaved={handleSaved}
      />

      <Dialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open && archiveBusy) return
          if (!open) setArchiveTarget(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Arquivar estratégia?</DialogTitle>
            <DialogDescription>{ARCHIVE_HINT}</DialogDescription>
          </DialogHeader>
          {archiveTarget && (
            <p className="text-sm font-medium text-foreground break-words">{archiveTarget.title}</p>
          )}
          {archiveError && (
            <p
              role="alert"
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {archiveError}
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={archiveBusy}
              onClick={() => setArchiveTarget(null)}
              className="min-h-11"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={archiveBusy}
              onClick={confirmArchive}
              className="min-h-11"
            >
              {archiveBusy ? 'Arquivando…' : 'Arquivar'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

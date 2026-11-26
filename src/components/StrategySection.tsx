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
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ChevronDown, Paperclip } from 'lucide-react'
import { Triade } from '@/components/Triade'
import { AdicionarNoLugar } from '@/components/mapa/AdicionarNoLugar'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { StrategyModal } from '@/components/StrategyModal'
import { useProjectStrategies } from '@/hooks/use-project-strategies'
import { useToast } from '@/hooks/use-toast'
import { strategyService } from '@/services/strategyService'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { groupActionsByStrategy } from '@/lib/strategyGroups'
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
  /** Vida ou Trabalho do resultado, para o que for adicionado aqui. */
  contexto: 'vida' | 'trabalho'
  /** Resultado encerrado não recebe nada novo. */
  podeAdicionar: boolean
  /** O "Adicionar" do próprio resultado, no fim da lista, como no Mapa. */
  rodape?: React.ReactNode
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
  contexto,
  podeAdicionar,
  rodape,
}) => {
  const { toast } = useToast()
  const strategies = useProjectStrategies(projectId)
  // Restaurar da Lixeira avisa por aqui: a lista de estratégias volta a ser lida.
  usePegadaMudou(strategies.reload)

  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editing, setEditing] = useState<Strategy | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Strategy | null>(null)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const archiveBusyRef = useRef(false)
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null)
  const statusBusyRef = useRef(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  // O material de referência de cada estratégia só abre quando a pessoa pede.
  const [comMaterial, setComMaterial] = useState<Record<string, boolean>>({})

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

  const openEdit = (strategy: Strategy) => {
    setEditing(strategy)
    setIsModalOpen(true)
  }


  // A mesma lista do Mapa: cada estratégia abre e recolhe, com os avanços
  // dela embaixo. Os avanços sem estratégia ficam soltos, no fim.
  const porEstrategia = new Map<string, ActionItem[]>()
  const soltos: ActionItem[] = []
  for (const g of groups) {
    if (g.kind === 'strategy' && g.strategy) porEstrategia.set(g.strategy.id, g.actions)
    else soltos.push(...g.actions)
  }
  const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="flex flex-col gap-1" data-escada-do-resultado>
      {strategies.loading && (
        <p role="status" className="px-2 text-[13px] text-muted-foreground">
          Carregando estratégias…
        </p>
      )}

      {strategies.error && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
        >
          <span>Não foi possível carregar as estratégias: {strategies.error}. Os avanços seguem abaixo.</span>
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

      {strategies.items.map((strategy) => {
        const isArchived = strategy.status === 'arquivada'
        // Aberta por padrão, como no Mapa; a arquivada vem recolhida.
        const isOpen = expanded[strategy.id] ?? !isArchived
        const busy = statusBusyId === strategy.id
        const dela = porEstrategia.get(strategy.id) ?? []
        return (
          <div key={strategy.id} id={`estrategia-${strategy.id}`} data-estrategia={strategy.id} className="scroll-mt-24">
            <div className="flex items-start gap-1">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Recolher' : 'Abrir'} ${strategy.title}`}
                onClick={() => setExpanded((prev) => ({ ...prev, [strategy.id]: !isOpen }))}
                className={`flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary ${FOCO}`}
              >
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  aria-hidden="true"
                />
              </button>
              <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center px-2 py-1.5">
                <span className="break-words text-base font-medium leading-snug text-foreground">
                  {strategy.title}
                </span>
                <span className="text-[13px] text-muted-foreground">
                  Estratégia{isArchived ? ' · arquivada' : ''}
                </span>
              </div>
            </div>
            {isOpen && (
              <div className="ml-[17px] flex flex-col gap-1 border-l-2 border-border pl-4">
                {strategy.description?.trim() ? (
                  <p className="whitespace-pre-wrap break-words px-2 py-1 text-sm text-muted-foreground">
                    {strategy.description}
                  </p>
                ) : null}
                {dela.length > 0 && renderActions(dela)}
                {!isArchived && podeAdicionar && (
                  <AdicionarNoLugar
                    tipos={['avanco']}
                    onde={{ resultadoId: projectId, estrategiaId: strategy.id }}
                    contexto={contexto}
                    em={strategy.title}
                    onCriado={() => onAvancosCriados?.()}
                  />
                )}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1">
                  <Triade
                    elemento="estrategia"
                    id={strategy.id}
                    titulo={strategy.title}
                    de={`estratégia ${strategy.title}`}
                    onEditar={() => openEdit(strategy)}
                    arquivado={isArchived}
                    onArquivar={() => {
                      if (isArchived) void handleSetStatus(strategy, 'ativa')
                      else {
                        setArchiveError(null)
                        setArchiveTarget(strategy)
                      }
                    }}
                    ocupado={busy}
                    onExcluido={() => {
                      strategies.reload()
                      onAvancosCriados?.()
                    }}
                  />
                </div>
                {!isArchived && podeAdicionar && (
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
                {comMaterial[strategy.id] ? (
                  <Referencias elemento="estrategia" id={strategy.id} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setComMaterial((m) => ({ ...m, [strategy.id]: true }))}
                    className={`flex min-h-11 items-center gap-2 self-start rounded-xl px-2 text-[15px] text-muted-foreground hover:bg-secondary ${FOCO}`}
                  >
                    <Paperclip className="h-4 w-4" aria-hidden="true" />
                    Material de referência
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Sem a lista de estratégias confirmada, os avanços aparecem todos juntos. */}
      {grouped ? soltos.length > 0 && renderActions(soltos) : actions.length > 0 && renderActions(actions)}

      {rodape}

      {podeAdicionar && (
        <Desdobrar
          nivel="resultado"
          texto={projectLabel}
          rotulo="Desdobrar em estratégias"
          onCriar={async (s) => {
            await pegadaOp('criar_estrategia', { resultado_id: projectId, titulo: s.titulo })
          }}
          onCriados={() => strategies.reload()}
        />
      )}

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

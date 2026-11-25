/**
 * PEGADA — a ficha de uma responsabilidade (/mapa/responsabilidade/:id).
 * Em cima, o propósito que ela sustenta. No meio, a responsabilidade, com
 * Editar e Arquivar. Embaixo, o que nasce dela: resultados, com os avanços
 * de cada um, e os avanços que a mantêm de pé. Cada linha leva à ficha do item.
 */
import { Referencias } from '@/components/Referencias'
import { Ficha } from '@/components/Ficha'
import { AdicionarNoLugar } from '@/components/mapa/AdicionarNoLugar'
import { fichaDoAvanco, fichaDoResultado } from '@/lib/pegada/enderecos'
import { Desdobrar } from '@/components/Desdobrar'
import { op as pegadaOp } from '@/lib/pegada/api'
import React, { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Pencil,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  /** Mantido para quem chama; a volta agora é a trilha do fio. */
  onBack?: () => void
  /** Registro alterado (editar/arquivar/reativar) — página recarrega catálogo. */
  onChanged: () => void
  /** Abre o modal de edição por cima da ficha (mesmo ID ao cancelar/salvar). */
  onEdit: () => void
}

export const ResponsibilityDetail: React.FC<ResponsibilityDetailProps> = ({
  responsibility,
  globalContext,
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

  const totalProjects = hierarchy?.projects.length ?? 0
  const directCount = hierarchy?.directActions.length ?? 0
  const BOTAO =
    'flex h-11 items-center gap-1.5 rounded-full border border-input bg-card px-4 text-sm font-medium text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

  return (
    <>
      <Ficha
        degraus={[{ rotulo: 'Mapa', to: '/mapa' }]}
        atual={responsibility.title}
        paraQue={
          <Link to="/mapa/proposito" className="font-medium underline-offset-4 hover:underline">
            Sustenta o seu propósito
          </Link>
        }
        como={
          <>
            <div id="como-sustentar" className="scroll-mt-24" />
            {!archived && (
              <>
                <AdicionarNoLugar
                  tipos={['resultado', 'avanco']}
                  onde={{ responsabilidadeId: responsibility.id }}
                  contexto={responsibility.context === 'vida' ? 'vida' : 'trabalho'}
                  em={responsibility.title}
                  onCriado={() => void loadHierarchy(responsibility.id)}
                />
                <Desdobrar
                  nivel="responsabilidade"
                  texto={responsibility.title}
                  rotulo="Desdobrar em resultados"
                  onCriar={async (s) => {
                    await pegadaOp('criar_resultado', {
                      titulo: s.titulo,
                      prazo: /^\d{4}-\d{2}-\d{2}$/.test(s.prazo || '') ? s.prazo : '',
                      responsabilidade_id: responsibility.id,
                      situacao: 'futuro',
                    })
                  }}
                  onCriados={() => {
                    void loadHierarchy(responsibility.id)
                    onChanged?.()
                  }}
                />
                <p className="px-1 text-[13px] text-muted-foreground">
                  Os resultados sugeridos entram em “Depois”. Você ativa quando for a hora.
                </p>
              </>
            )}
            {hierarchyLoading ? (
              <p className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Carregando…
              </p>
            ) : hierarchyError ? (
              <div className="flex items-start gap-2 rounded-2xl border border-border bg-card p-4">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <div className="flex-1">
                  <p className="text-sm text-foreground">{hierarchyError}</p>
                  <button
                    type="button"
                    className="mt-2 text-sm font-medium underline underline-offset-4"
                    onClick={() => loadHierarchy(responsibility.id)}
                  >
                    Tentar novamente
                  </button>
                </div>
              </div>
            ) : hierarchy && totalProjects === 0 && directCount === 0 ? (
              <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                Nada nasce desta responsabilidade ainda. Adicione um resultado para construir algo, ou um
                avanço para a rotina que a mantém de pé.
              </p>
            ) : hierarchy ? (
              <div className="rounded-2xl border border-border bg-card p-2">
                {hierarchy.projects.map((project) => (
                  <LinkedProjectBlock
                    key={project.id}
                    project={project}
                    actions={hierarchy.actionsByProject[project.id] ?? []}
                  />
                ))}
                {hierarchy.directActions.map((action) => (
                  <LinkedActionRow key={action.id} action={action} />
                ))}
              </div>
            ) : null}
            <Referencias elemento="responsabilidade" id={responsibility.id} />
          </>
        }
      >
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Responsabilidade · {contextLabel}
          {archived && ' · arquivada'}
        </p>
        <h1 className="mt-1.5 break-words text-2xl font-semibold leading-tight tracking-tight text-foreground">
          {responsibility.title}
        </h1>
        {responsibility.description?.trim() ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-base text-foreground">
            {responsibility.description}
          </p>
        ) : null}
        {outOfScope && (
          <p className="mt-2 text-[13px] text-muted-foreground">
            Esta responsabilidade é de {contextLabel}, e o filtro agora mostra só{' '}
            {globalContext === 'trabalho' ? 'Trabalho' : 'Vida'}.
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={onEdit} className={BOTAO}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar
          </button>
          {archived ? (
            <button type="button" onClick={() => changeStatus('ativa')} disabled={statusBusy} className={BOTAO}>
              <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
              Reativar
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setArchiveConfirmOpen(true)}
              disabled={statusBusy}
              className={BOTAO}
            >
              <Archive className="h-4 w-4" aria-hidden="true" />
              Arquivar
            </button>
          )}
        </div>
      </Ficha>

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
    </>
  )
}

/** Um resultado desta responsabilidade e, abaixo dele, os avanços que o constroem. */
const LinkedProjectBlock: React.FC<{ project: Project; actions: ActionItem[] }> = ({
  project,
  actions,
}) => (
  <div>
    <Link
      to={fichaDoResultado(project.id)}
      className="flex min-h-11 flex-col justify-center rounded-xl px-2 py-1.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="break-words text-base font-medium text-foreground">{project.title}</span>
      <span className="text-[13px] text-muted-foreground">
        Resultado
        <StatusHint status={project.status} />
      </span>
    </Link>
    {actions.length > 0 && (
      <div className="ml-3 border-l-2 border-border pl-3">
        {actions.map((action) => (
          <LinkedActionRow key={action.id} action={action} />
        ))}
      </div>
    )}
  </div>
)

/** Um avanço, com link para a ficha dele. */
const LinkedActionRow: React.FC<{ action: ActionItem }> = ({ action }) => (
  <Link
    to={fichaDoAvanco(action.id)}
    className="flex min-h-11 items-center gap-1.5 rounded-xl px-2 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <span
      className={cn(
        'min-w-0 break-words text-[15px] text-foreground',
        (action.status === 'feita' || action.status === 'cancelada') && 'text-muted-foreground line-through',
      )}
    >
      {action.title}
    </span>
    <StatusHint status={action.status} />
  </Link>
)

/** Estado legível sempre (feito/cancelado/arquivados sem apagar texto). */
function StatusHint({ status }: { status: string }) {
  // Só o que foge do normal merece palavra: aberto e ativo ficam em silêncio.
  const map: Record<string, string> = {
    rascunho: 'depois',
    futuro: 'depois',
    pausado: 'pausado',
    concluido: 'concluído',
    arquivado: 'arquivado',
    aguardando: 'esperando',
    bloqueada: 'esperando',
    feita: 'feito',
    cancelada: 'cancelado',
  }
  if (!map[status]) return null
  return <span className="shrink-0 text-[13px] text-muted-foreground"> · {map[status]}</span>
}

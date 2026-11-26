// PEGADA — a folha de escolha do dia: os avanços abertos, agrupados pelo
// resultado de onde nascem. Um toque põe em Hoje, outro tira.
import { useMemo } from 'react'
import { Check } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ActionItem, Project } from '@/types/execution'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Avanços que podem entrar em Hoje (abertos, de resultado em andamento ou livres). */
  candidatos: ActionItem[]
  projetos: Project[]
  /** Está em Hoje agora? */
  emHoje: (a: ActionItem) => boolean
  ocupadoId: string | null
  onAlternar: (a: ActionItem) => void
}

export function FolhaDeEscolha({ open, onOpenChange, candidatos, projetos, emHoje, ocupadoId, onAlternar }: Props) {
  const grupos = useMemo(() => {
    const nome = new Map(projetos.map((p) => [p.id, p.title]))
    const mapa = new Map<string, { titulo: string; itens: ActionItem[] }>()
    for (const a of candidatos) {
      const chave = a.project_id && nome.has(a.project_id) ? a.project_id : ''
      if (!mapa.has(chave)) mapa.set(chave, { titulo: chave ? (nome.get(chave) as string) : 'Avanços livres', itens: [] })
      mapa.get(chave)!.itens.push(a)
    }
    return [...mapa.entries()]
      .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : 0))
      .map(([chave, g]) => ({ chave, ...g }))
  }, [candidatos, projetos])
  const escolhidos = candidatos.filter(emHoje).length

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col sm:max-w-md" data-folha-de-escolha>
        <DialogHeader>
          <DialogTitle>Escolher para hoje</DialogTitle>
          <DialogDescription>
            Um toque põe em Hoje, outro tira. O método sugere de 3 a 5 por dia.
          </DialogDescription>
        </DialogHeader>
        <div className="-mx-2 min-h-0 flex-1 space-y-4 overflow-y-auto px-2">
          {grupos.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhum avanço aberto. Crie o primeiro no Mapa, embaixo de um resultado.
            </p>
          )}
          {grupos.map((g) => (
            <section key={g.chave} aria-label={g.titulo}>
              <p className="px-2 pb-1 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.titulo}
              </p>
              <ul>
                {g.itens.map((a) => {
                  const marcado = emHoje(a)
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        aria-pressed={marcado}
                        aria-label={`${marcado ? 'Tirar de Hoje' : 'Fazer hoje'}: ${a.title}`}
                        disabled={ocupadoId !== null}
                        onClick={() => onAlternar(a)}
                        className={cn(
                          'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          ocupadoId === a.id && 'opacity-60',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                            marcado ? 'bg-primary text-primary-foreground' : 'border-2 border-muted-foreground text-transparent',
                          )}
                        >
                          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 break-words text-[15px] leading-snug text-foreground">{a.title}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between">
          <p className="text-sm text-muted-foreground" data-escolhidos>
            {escolhidos === 0 ? 'Nenhum escolhido' : escolhidos === 1 ? '1 escolhido' : `${escolhidos} escolhidos`}
          </p>
          <Button type="button" className="min-h-11" onClick={() => onOpenChange(false)}>
            Pronto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default FolhaDeEscolha

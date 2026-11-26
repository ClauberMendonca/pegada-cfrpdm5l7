// PEGADA — a tríade de toda ficha: editar, arquivar e excluir, sempre os
// mesmos três ícones, na mesma ordem. Excluir manda o item para a Lixeira com
// tudo o que está embaixo dele; antes, mostra o que vai junto e pede o sim.
import { useEffect, useState } from 'react'
import { Archive, ArchiveRestore, Loader2, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { op } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'
import { cn } from '@/lib/utils'

export type Excluivel = 'vontade' | 'responsabilidade' | 'resultado' | 'estrategia' | 'avanco'

export interface Abaixo {
  resultados: number
  estrategias: number
  avancos: number
  notas: number
  tempos: number
  anexos: number
}

const ARTIGO: Record<Excluivel, string> = {
  vontade: 'a vontade',
  responsabilidade: 'a responsabilidade',
  resultado: 'o resultado',
  estrategia: 'a estratégia',
  avanco: 'o avanço',
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

/** "2 resultados, 1 estratégia e 5 avanços": só o que existe, em uma linha. */
export function descreverAbaixo(a: Abaixo | null | undefined): string {
  if (!a) return ''
  const partes = [
    a.resultados ? plural(a.resultados, 'resultado', 'resultados') : '',
    a.estrategias ? plural(a.estrategias, 'estratégia', 'estratégias') : '',
    a.avancos ? plural(a.avancos, 'avanço', 'avanços') : '',
    a.notas ? plural(a.notas, 'nota', 'notas') : '',
    a.tempos ? plural(a.tempos, 'registro de tempo', 'registros de tempo') : '',
    a.anexos ? plural(a.anexos, 'anexo', 'anexos') : '',
  ].filter(Boolean)
  if (partes.length <= 1) return partes.join('')
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`
}

const ICONE =
  'flex h-11 w-11 items-center justify-center rounded-full border border-input bg-card text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

interface Props {
  elemento: Excluivel
  id: string
  titulo: string
  onEditar: () => void
  /** Arquivar e reativar. Para o avanço, arquivar é cancelar. */
  arquivado: boolean
  onArquivar: () => void
  ocupado?: boolean
  /** Depois que o item foi para a Lixeira (ex.: voltar ao Mapa). */
  onExcluido?: () => void
  /** Completa os nomes dos botões quando há várias tríades na tela. */
  de?: string
  className?: string
}

export function Triade({ elemento, id, titulo, onEditar, arquivado, onArquivar, ocupado, onExcluido, de, className }: Props) {
  const [aberto, setAberto] = useState(false)
  const [abaixo, setAbaixo] = useState<Abaixo | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [erro, setErro] = useState('')
  const nome = (acao: string) => (de ? `${acao} ${de}` : acao)

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    setAbaixo(null)
    setErro('')
    op<{ abaixo: Abaixo }>('ver_o_que_sai', { elemento, id })
      .then((r) => vivo && setAbaixo(r.resultado?.abaixo ?? null))
      .catch((e: Error) => vivo && setErro(e.message))
    return () => {
      vivo = false
    }
  }, [aberto, elemento, id])

  const excluir = async () => {
    if (excluindo) return
    setExcluindo(true)
    setErro('')
    try {
      const r = await op<{ lixeira_id: string }>('excluir', { elemento, id })
      const lixeiraId = r.resultado?.lixeira_id
      setAberto(false)
      notificarMudanca()
      onExcluido?.()
      toast('Foi para a Lixeira', {
        description: titulo,
        action: lixeiraId
          ? {
              label: 'Desfazer',
              onClick: () => {
                op('restaurar', { lixeira_id: lixeiraId })
                  .then(() => {
                    toast.success('Restaurado')
                    notificarMudanca()
                  })
                  .catch((e: Error) => toast.error(e.message))
              },
            }
          : undefined,
      })
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível excluir.')
    } finally {
      setExcluindo(false)
    }
  }

  const junto = descreverAbaixo(abaixo)

  return (
    <>
      <div className={cn('flex gap-2', className)} data-triade>
        <button type="button" className={ICONE} onClick={onEditar} aria-label={nome('Editar')} title="Editar">
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={ICONE}
          onClick={onArquivar}
          disabled={ocupado}
          aria-label={nome(arquivado ? 'Reativar' : 'Arquivar')}
          title={arquivado ? 'Reativar' : 'Arquivar'}
        >
          {arquivado ? (
            <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Archive className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className={cn(ICONE, 'text-muted-foreground')}
          onClick={() => setAberto(true)}
          aria-label={nome('Excluir')}
          title="Excluir"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <Dialog open={aberto} onOpenChange={(v) => !excluindo && setAberto(v)}>
        <DialogContent className="sm:max-w-md" data-confirmar-exclusao>
          <DialogHeader>
            <DialogTitle>Excluir {ARTIGO[elemento]}?</DialogTitle>
            <DialogDescription className="break-words">“{titulo}” vai para a Lixeira.</DialogDescription>
          </DialogHeader>
          <div className="text-sm text-foreground" aria-live="polite">
            {erro ? (
              <p role="alert" className="text-destructive">
                {erro}
              </p>
            ) : !abaixo ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Contando o que vai junto…
              </p>
            ) : junto ? (
              <p data-vai-junto>
                Vai junto tudo o que está embaixo: <strong>{junto}</strong>.
              </p>
            ) : (
              <p data-vai-junto>Não há nada embaixo.</p>
            )}
            <p className="mt-2 text-muted-foreground">
              Dá para restaurar pela Lixeira, até você esvaziá-la.
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setAberto(false)} disabled={excluindo}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="min-h-11"
              onClick={() => void excluir()}
              disabled={excluindo || (!abaixo && !erro)}
            >
              {excluindo ? 'Excluindo…' : 'Mandar para a Lixeira'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

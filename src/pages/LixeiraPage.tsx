// PEGADA — a Lixeira (/lixeira). O que foi excluído espera aqui: dá para
// restaurar, excluir de vez só o que for marcado, ou esvaziar tudo.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArchiveRestore, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useTituloDaAba } from '@/components/Ficha'
import { descreverAbaixo, type Abaixo, type Excluivel } from '@/components/Triade'
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

interface Item {
  id: string
  elemento: Excluivel
  titulo: string
  abaixo: Abaixo
  excluido_em: string
}

const NOME: Record<Excluivel, string> = {
  vontade: 'Vontade',
  responsabilidade: 'Responsabilidade',
  resultado: 'Resultado',
  estrategia: 'Estratégia',
  avanco: 'Avanço',
}

const dia = (iso: string) => {
  const d = new Date(iso.replace(' ', 'T'))
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
}

export function LixeiraPage() {
  useTituloDaAba('Lixeira')
  const [itens, setItens] = useState<Item[] | null>(null)
  const [erro, setErro] = useState('')
  const [marcados, setMarcados] = useState<Record<string, boolean>>({})
  const [ocupado, setOcupado] = useState(false)
  // null = fechado; 'tudo' ou 'marcados' = o que a confirmação vai apagar.
  const [confirmar, setConfirmar] = useState<null | 'tudo' | 'marcados'>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await op<{ itens: Item[] }>('ver_lixeira', {})
      setItens(r.resultado?.itens ?? [])
      setErro('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível abrir a Lixeira.')
    }
  }, [])
  useEffect(() => {
    void carregar()
  }, [carregar])

  const escolhidos = (itens ?? []).filter((i) => marcados[i.id]).map((i) => i.id)

  const restaurar = async (item: Item) => {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await op<{ voltaram_soltos: string[] }>('restaurar', { lixeira_id: item.id })
      const soltos = r.resultado?.voltaram_soltos?.length ?? 0
      toast.success('Restaurado', {
        description: soltos
          ? 'O lugar de onde veio não existe mais. Voltou solto, em Livres.'
          : item.titulo,
      })
      notificarMudanca()
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível restaurar.')
    } finally {
      setOcupado(false)
    }
  }

  const apagar = async () => {
    if (ocupado || !confirmar) return
    setOcupado(true)
    try {
      await op('esvaziar_lixeira', confirmar === 'marcados' ? { ids: escolhidos } : {})
      setMarcados({})
      setConfirmar(null)
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5" data-lixeira>
      <header>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">Lixeira</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          O que você excluiu espera aqui. Restaure, ou exclua de vez.
        </p>
      </header>

      {erro ? (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      ) : itens === null ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-label="Carregando a Lixeira" />
        </div>
      ) : itens.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
          A Lixeira está vazia. <Link to="/mapa" className="font-medium underline underline-offset-4">Voltar ao Mapa</Link>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={ocupado || escolhidos.length === 0}
              onClick={() => setConfirmar('marcados')}
            >
              Excluir de vez os marcados{escolhidos.length ? ` (${escolhidos.length})` : ''}
            </Button>
            <Button variant="outline" className="min-h-11" disabled={ocupado} onClick={() => setConfirmar('tudo')}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Esvaziar a Lixeira
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {itens.map((item) => {
              const junto = descreverAbaixo(item.abaixo)
              return (
                <li
                  key={item.id}
                  data-item-da-lixeira
                  className="flex items-start gap-3 rounded-2xl border border-border bg-card p-3"
                >
                  <label className="flex h-11 w-8 shrink-0 cursor-pointer items-center justify-center">
                    <input
                      type="checkbox"
                      className="h-5 w-5 accent-[#D2551E]"
                      checked={Boolean(marcados[item.id])}
                      onChange={(e) => setMarcados((m) => ({ ...m, [item.id]: e.target.checked }))}
                      aria-label={`Marcar ${item.titulo}`}
                    />
                  </label>
                  <div className="min-w-0 flex-1 py-1">
                    <p className="break-words text-base font-medium text-foreground">{item.titulo}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {NOME[item.elemento]}
                      {junto ? ` · com ${junto}` : ''}
                      {dia(item.excluido_em) ? ` · excluído em ${dia(item.excluido_em)}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void restaurar(item)}
                    disabled={ocupado}
                    aria-label={`Restaurar ${item.titulo}`}
                    title="Restaurar"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-input bg-card text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <ArchiveRestore className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <Dialog open={confirmar !== null} onOpenChange={(v) => !v && !ocupado && setConfirmar(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmar === 'tudo'
                ? 'Esvaziar a Lixeira?'
                : escolhidos.length === 1
                  ? 'Excluir de vez 1 item?'
                  : 'Excluir de vez os itens marcados?'}
            </DialogTitle>
            <DialogDescription>
              Não tem volta. O que for apagado aqui sai do Pegada para sempre, com tudo o que estava embaixo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" className="min-h-11" onClick={() => setConfirmar(null)} disabled={ocupado}>
              Cancelar
            </Button>
            <Button variant="destructive" className="min-h-11" onClick={() => void apagar()} disabled={ocupado}>
              {ocupado ? 'Excluindo…' : 'Excluir de vez'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default LixeiraPage

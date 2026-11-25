// PEGADA — Material de referência: anexos leves de um elemento (nota, link,
// contato, documento). Aparecem só onde são usados; não há arquivo geral.
import { useCallback, useEffect, useState } from 'react'
import { FileText, Link2, Loader2, Paperclip, Plus, StickyNote, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { op } from '@/lib/pegada/api'
import { cn } from '@/lib/utils'

type TipoRef = 'nota' | 'link' | 'contato' | 'documento'
interface Ref {
  id: string
  tipo: TipoRef
  titulo: string
  texto: string
  endereco: string
  do_avanco_id: string | null
}
const TIPOS: { valor: TipoRef; nome: string; icone: typeof Link2 }[] = [
  { valor: 'nota', nome: 'Nota', icone: StickyNote },
  { valor: 'link', nome: 'Link', icone: Link2 },
  { valor: 'contato', nome: 'Contato', icone: User },
  { valor: 'documento', nome: 'Documento', icone: FileText },
]
const CAMPO =
  'w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground'

interface Props {
  elemento: 'responsabilidade' | 'resultado' | 'estrategia' | 'avanco'
  id: string
  /** Muda quando algo de fora pode ter criado uma nota (ex.: concluir um Estudo). */
  recarregar?: unknown
  className?: string
}

export function Referencias({ elemento, id, recarregar, className }: Props) {
  const [lista, setLista] = useState<Ref[] | null>(null)
  const [novo, setNovo] = useState(false)
  const [tipo, setTipo] = useState<TipoRef>('nota')
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [endereco, setEndereco] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await op<{ referencias: Ref[] }>('listar_referencias', { elemento_tipo: elemento, elemento_id: id })
      setLista((r.resultado as { referencias: Ref[] })?.referencias ?? [])
    } catch {
      setLista([])
    }
  }, [elemento, id])

  useEffect(() => {
    void carregar()
  }, [carregar, recarregar])

  const salvar = async () => {
    setOcupado(true)
    setErro(null)
    try {
      await op('anexar_referencia', {
        elemento_tipo: elemento,
        elemento_id: id,
        tipo,
        titulo: titulo.trim(),
        texto: texto.trim(),
        endereco: tipo === 'nota' ? '' : endereco.trim(),
      })
      setTitulo('')
      setTexto('')
      setEndereco('')
      setNovo(false)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível anexar.')
    } finally {
      setOcupado(false)
    }
  }

  const remover = async (refId: string) => {
    setOcupado(true)
    try {
      await op('remover_referencia', { referencia_id: refId }, { desfazer: true, onDesfeito: () => void carregar() })
      await carregar()
    } finally {
      setOcupado(false)
    }
  }

  return (
    <section
      aria-label="Material de referência"
      className={cn('space-y-3 rounded-[20px] border border-border bg-card p-4', className)}
      data-referencias={elemento}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <Paperclip className="h-4 w-4" aria-hidden="true" />
          Material de referência
          {lista && lista.length > 0 && <span className="font-normal text-muted-foreground">{lista.length}</span>}
        </h4>
        {!novo && (
          <Button type="button" size="sm" variant="outline" onClick={() => setNovo(true)} className="h-11 gap-1.5 rounded-full">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Anexar
          </Button>
        )}
      </div>

      {lista === null && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Carregando…
        </p>
      )}
      {lista && lista.length === 0 && !novo && (
        <p className="text-sm text-muted-foreground">
          Notas, links, contatos e documentos de apoio ficam aqui, só onde são usados.
        </p>
      )}
      {lista && lista.length > 0 && (
        <ul className="divide-y divide-border">
          {lista.map((r) => {
            const Icone = TIPOS.find((t) => t.valor === r.tipo)?.icone ?? StickyNote
            return (
              <li key={r.id} className="flex items-start gap-3 py-2.5">
                <Icone className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {r.titulo && <p className="break-words text-base font-medium leading-tight text-foreground">{r.titulo}</p>}
                  {r.texto && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{r.texto}</p>}
                  {r.endereco && (
                    <a
                      href={r.endereco}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-sm text-foreground underline underline-offset-4"
                    >
                      {r.endereco}
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  disabled={ocupado}
                  aria-label={`Remover anexo: ${r.titulo || r.texto.slice(0, 40) || r.endereco}`}
                  onClick={() => void remover(r.id)}
                  className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {novo && (
        <div className="space-y-2.5">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Tipo de anexo">
            {TIPOS.map((t) => (
              <button
                key={t.valor}
                type="button"
                aria-pressed={tipo === t.valor}
                onClick={() => setTipo(t.valor)}
                className={cn(
                  'h-11 rounded-full px-3.5 text-sm font-medium',
                  tipo === t.valor ? 'bg-foreground text-background' : 'border border-input bg-card text-foreground',
                )}
              >
                {t.nome}
              </button>
            ))}
          </div>
          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder={tipo === 'contato' ? 'Nome do contato' : 'Título (opcional)'}
            aria-label="Título do anexo"
            className={CAMPO}
          />
          {tipo !== 'nota' && (
            <input
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              placeholder={tipo === 'contato' ? 'tel:+55… ou mailto:…' : 'Endereço (https://…)'}
              aria-label="Endereço do anexo"
              inputMode="url"
              className={CAMPO}
            />
          )}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={tipo === 'nota' ? 3 : 2}
            placeholder={tipo === 'nota' ? 'Escreva a nota' : 'Observação (opcional)'}
            aria-label="Texto do anexo"
            className={CAMPO}
          />
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={ocupado || (!titulo.trim() && !texto.trim() && !endereco.trim())}
              onClick={() => void salvar()}
              className="rounded-full"
            >
              Guardar anexo
            </Button>
            <Button type="button" variant="ghost" disabled={ocupado} onClick={() => setNovo(false)} className="rounded-full">
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

export default Referencias

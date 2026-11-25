// PEGADA — Desdobrar com IA: o mesmo gesto em todos os níveis da escada.
// A IA devolve sugestões com o motivo em uma linha; a pessoa escolhe quais
// criar. Nada é gravado sem o toque em "Criar".
import { useState } from 'react'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { desdobrar, type NivelDesdobrar, type SugestaoDesdobrada } from '@/lib/pegada/api'
import { cn } from '@/lib/utils'

interface Props {
  nivel: NivelDesdobrar
  /** O texto de partida. Sem ele, a pessoa escreve (ex.: o papel que vive). */
  texto?: string
  /** Rótulo do botão, ex.: "Desdobrar em resultados". */
  rotulo: string
  /** Pergunta do campo quando a pessoa escreve o ponto de partida. */
  pergunta?: string
  exemplo?: string
  /** Cria um item escolhido. Lança erro com mensagem legível se não puder. */
  onCriar: (s: SugestaoDesdobrada) => Promise<void>
  onCriados?: (quantos: number) => void
}

export function Desdobrar({ nivel, texto, rotulo, pergunta, exemplo, onCriar, onCriados }: Props) {
  const [aberto, setAberto] = useState(false)
  const [escrito, setEscrito] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [lista, setLista] = useState<SugestaoDesdobrada[] | null>(null)
  const [marcadas, setMarcadas] = useState<Record<number, boolean>>({})

  const partida = (texto ?? escrito).trim()

  const pedir = async () => {
    if (!partida) return
    setOcupado(true)
    setErro(null)
    try {
      const s = await desdobrar(nivel, partida)
      if (!s.length) setErro('A IA não trouxe sugestões desta vez. Tente de novo ou escreva com mais detalhes.')
      setLista(s)
      setMarcadas({})
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A IA não respondeu. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  const criar = async () => {
    if (!lista) return
    setOcupado(true)
    setErro(null)
    let feitos = 0
    try {
      for (let i = 0; i < lista.length; i++) {
        if (!marcadas[i]) continue
        await onCriar(lista[i])
        feitos++
      }
      setLista(null)
      setAberto(false)
      setEscrito('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível criar. Tente de novo.')
    } finally {
      setOcupado(false)
      if (feitos) onCriados?.(feitos)
    }
  }

  const quantas = Object.values(marcadas).filter(Boolean).length

  if (!aberto) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setAberto(true)
          if (texto) void pedir()
        }}
        className="h-11 gap-1.5 px-2 text-sm text-primary hover:text-primary"
        data-desdobrar={nivel}
      >
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        {rotulo}
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-[20px] border border-border bg-card p-4" data-desdobrar={nivel}>
      {texto === undefined && !lista && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor={`desdobrar-${nivel}`}>
            {pergunta}
          </label>
          <textarea
            id={`desdobrar-${nivel}`}
            value={escrito}
            onChange={(e) => setEscrito(e.target.value)}
            placeholder={exemplo}
            rows={2}
            className="w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={ocupado || !partida} onClick={() => void pedir()} className="gap-1.5 rounded-full">
              {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              Ver sugestões
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAberto(false)} className="rounded-full">
              Fechar
            </Button>
          </div>
        </div>
      )}
      {ocupado && !lista && texto !== undefined && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Pensando…
        </p>
      )}
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {lista && lista.length > 0 && (
        <>
          <p className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sugestões do Pegada · escolha as que valem
          </p>
          <ul className="space-y-2">
            {lista.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  aria-pressed={Boolean(marcadas[i])}
                  onClick={() => setMarcadas((m) => ({ ...m, [i]: !m[i] }))}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-2xl bg-background px-3.5 py-3 text-left',
                    marcadas[i] ? 'border-2 border-foreground' : 'border border-input',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      marcadas[i] ? 'bg-foreground text-background' : 'border-2 border-muted-foreground',
                    )}
                  >
                    {marcadas[i] && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block break-words text-base font-medium leading-tight text-foreground">
                      {s.titulo}
                    </span>
                    {s.por_que && (
                      <span className="mt-0.5 block break-words text-[13px] text-muted-foreground">{s.por_que}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {(lista || texto !== undefined) && (
        <div className="flex flex-wrap gap-2">
          {lista && lista.length > 0 && (
            <Button type="button" disabled={ocupado || quantas === 0} onClick={() => void criar()} className="gap-1.5 rounded-full">
              {ocupado && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {quantas > 1 ? `Criar ${quantas} escolhidas` : 'Criar a escolhida'}
            </Button>
          )}
          {(lista || erro) && (
            <Button type="button" variant="outline" disabled={ocupado} onClick={() => void pedir()} className="rounded-full">
              Outras sugestões
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            disabled={ocupado}
            onClick={() => {
              setAberto(false)
              setLista(null)
              setErro(null)
            }}
            className="rounded-full"
          >
            Dispensar
          </Button>
        </div>
      )}
    </div>
  )
}

export default Desdobrar

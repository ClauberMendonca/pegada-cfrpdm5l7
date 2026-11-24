// PEGADA — Nível 1: a IA embutida sugere, a pessoa decide. Nada é gravado aqui:
// o botão pede a sugestão e "Usar sugestão" devolve os campos para a tela.
import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sugerir } from '@/lib/pegada/api'

type Sugestao = Record<string, string>

interface Props {
  tipo: 'resultado' | 'avanco' | 'proposito' | 'captura'
  texto: string
  /** Linha que resume a sugestão para a pessoa (ex.: "Estudo: Pesquisar tênis"). */
  descrever: (s: Sugestao) => string
  onUsar: (s: Sugestao) => void | Promise<void>
  /** Devolve o motivo quando a sugestão não pode ser aplicada direto. */
  impedimento?: (s: Sugestao) => string | null
}

export function AiSuggest({ tipo, texto, descrever, onUsar, impedimento }: Props) {
  const [ocupado, setOcupado] = useState(false)
  const [sugestao, setSugestao] = useState<Sugestao | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const pedir = async () => {
    setOcupado(true)
    setErro(null)
    setSugestao(null)
    try {
      const res = await sugerir(tipo, texto.trim())
      setSugestao(res.sugestao)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A IA não respondeu. Tente de novo.')
    } finally {
      setOcupado(false)
    }
  }

  const usar = async () => {
    if (!sugestao) return
    setOcupado(true)
    try {
      await onUsar(sugestao)
      setSugestao(null)
    } finally {
      setOcupado(false)
    }
  }

  const motivo = sugestao && impedimento ? impedimento(sugestao) : null

  return (
    <div className="space-y-2" data-ia={tipo}>
      {!sugestao && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={ocupado || !texto.trim()}
          onClick={() => void pedir()}
          className="h-8 gap-1.5 px-2 text-xs text-primary hover:text-primary"
        >
          {ocupado ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {ocupado ? 'Pensando…' : 'Sugerir com IA'}
        </Button>
      )}
      {erro && <p className="text-xs text-destructive">{erro}</p>}
      {sugestao && (
        <div className="space-y-2 rounded-xl border border-primary/30 bg-accent/40 p-3" role="status">
          <p className="break-words text-sm font-medium text-foreground">{descrever(sugestao)}</p>
          {sugestao.por_que && (
            <p className="break-words text-xs text-muted-foreground">{sugestao.por_que}</p>
          )}
          {motivo && <p className="text-xs text-ginga-warning">{motivo}</p>}
          <div className="flex flex-wrap gap-2">
            {!motivo && (
              <Button type="button" size="sm" disabled={ocupado} onClick={() => void usar()} className="text-xs">
                Usar sugestão
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={ocupado}
              onClick={() => setSugestao(null)}
              className="text-xs"
            >
              Dispensar
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default AiSuggest

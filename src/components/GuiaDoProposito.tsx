// PEGADA — Guia do propósito: quatro perguntas curtas levam a uma frase.
// A IA pode ajudar a formular a partir das respostas, mas nunca inventa:
// sem respostas não há sugestão, e a pessoa decide a frase final.
import { useState } from 'react'
import { ChevronDown, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { sugerir } from '@/lib/pegada/api'
import { cn } from '@/lib/utils'

const PERGUNTAS = [
  { chave: 'move', titulo: 'O que te move?', ajuda: 'O que você faz que te dá energia, mesmo quando é difícil?' },
  { chave: 'serve', titulo: 'A quem isso serve?', ajuda: 'Para quem ou para quê o que você faz faz diferença?' },
  {
    chave: 'mudanca',
    titulo: 'Que mudança você quer causar?',
    ajuda: 'O que fica diferente no mundo, na sua família ou no seu trabalho por causa disso?',
  },
  {
    chave: 'lembrado',
    titulo: 'Pelo que você quer ser lembrado?',
    ajuda: 'Daqui a muitos anos, o que você quer que digam sobre o que você fez?',
  },
] as const

const CAMPO =
  'w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground'

export function GuiaDoProposito({ onUsar }: { onUsar: (frase: string) => void }) {
  const [aberto, setAberto] = useState(false)
  const [respostas, setRespostas] = useState<Record<string, string>>({})
  const [frase, setFrase] = useState('')
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [testes, setTestes] = useState({ unico: false, escolha: false })

  const respondidas = PERGUNTAS.filter((p) => (respostas[p.chave] || '').trim()).length

  const formular = async () => {
    setOcupado(true)
    setErro(null)
    try {
      const texto = PERGUNTAS.map((p) => `${p.titulo} ${(respostas[p.chave] || '').trim() || '(sem resposta)'}`).join('\n')
      const r = await sugerir('proposito', `Respostas da pessoa ao guia do propósito. Use só o que ela disse.\n${texto}`)
      setFrase(r.sugestao.texto || '')
      setMotivo(r.sugestao.por_que || '')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'A IA não respondeu. Você pode escrever a frase direto.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="rounded-[20px] border border-border bg-card" data-guia-proposito>
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => setAberto(!aberto)}
        className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-base font-semibold text-foreground">Guia do propósito</span>
          <span className="block text-sm text-muted-foreground">Quatro perguntas curtas que levam a uma frase.</span>
        </span>
        <ChevronDown className={cn('h-5 w-5 shrink-0 transition-transform', aberto && 'rotate-180')} aria-hidden="true" />
      </button>
      {aberto && (
        <div className="space-y-4 border-t border-border p-4">
          {PERGUNTAS.map((p, i) => (
            <div key={p.chave} className="space-y-1.5">
              <label htmlFor={`guia-${p.chave}`} className="block text-sm font-semibold text-foreground">
                {i + 1}. {p.titulo}
              </label>
              <p className="text-[13px] text-muted-foreground">{p.ajuda}</p>
              <textarea
                id={`guia-${p.chave}`}
                rows={2}
                value={respostas[p.chave] || ''}
                onChange={(e) => setRespostas((r) => ({ ...r, [p.chave]: e.target.value }))}
                className={CAMPO}
              />
            </div>
          ))}

          <div className="space-y-2">
            <label htmlFor="guia-frase" className="block text-sm font-semibold text-foreground">
              Sua frase
            </label>
            <p className="text-[13px] text-muted-foreground">
              Monte assim: “Eu existo para [verbo] [quem ou o quê], para que [mudança].”
            </p>
            <textarea
              id="guia-frase"
              rows={2}
              value={frase}
              onChange={(e) => {
                setFrase(e.target.value)
                setMotivo('')
              }}
              placeholder="Eu existo para simplificar a vida de quem empreende, para que mais pessoas realizem o que escolheram."
              className={CAMPO}
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={ocupado || respondidas < 2}
              onClick={() => void formular()}
              className="h-11 gap-1.5 px-2 text-sm text-primary hover:text-primary"
            >
              {ocupado ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Sparkles className="h-4 w-4" aria-hidden="true" />
              )}
              Ajudar a formular com as minhas respostas
            </Button>
            {respondidas < 2 && (
              <p className="text-xs text-muted-foreground">
                Responda ao menos duas perguntas: a IA ajuda a formular, mas não inventa por você.
              </p>
            )}
            {motivo && <p className="text-[13px] text-muted-foreground">{motivo}</p>}
            {erro && <p className="text-sm text-destructive">{erro}</p>}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-foreground">Dois testes antes de valer</legend>
            {(
              [
                ['unico', 'Teste do único: ela vale tanto para a vida pessoal quanto para a profissional?'],
                ['escolha', 'Teste da escolha: ela ajuda a dizer “não” a alguma coisa?'],
              ] as const
            ).map(([k, t]) => (
              <label key={k} className="flex min-h-11 items-start gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={testes[k]}
                  onChange={(e) => setTestes((v) => ({ ...v, [k]: e.target.checked }))}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--pegada-ink)]"
                />
                {t}
              </label>
            ))}
          </fieldset>

          <div className="space-y-1.5">
            <Button
              type="button"
              disabled={!frase.trim()}
              onClick={() => {
                onUsar(frase.trim())
                setAberto(false)
              }}
              className="rounded-full"
            >
              Usar esta frase
            </Button>
            <p className="text-xs text-muted-foreground">
              {testes.unico && testes.escolha
                ? 'A frase passou nos dois testes. Ela vai para o campo abaixo; salve para valer.'
                : 'O propósito nasce como rascunho: você pode usar a frase agora e mudar quando quiser.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default GuiaDoProposito

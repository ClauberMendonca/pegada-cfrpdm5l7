import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { captureService } from '@/services/captureService'
import { notificarMudanca } from '@/services/actionService'
import { op, sugerir } from '@/lib/pegada/api'
import { ACTION_KIND_LABEL, type ActionKind } from '@/types/execution'
import { Check, Mic } from 'lucide-react'
import { cn } from '@/lib/utils'

// PEGADA — captura de um toque, disponível em qualquer tela.
// Quando a pessoa já sabe que é um avanço, "Já é um avanço" cria direto, sem
// passar pela Caixa: ela escolhe (ou não) a estratégia em andamento e cria.
// Abre pelo botão central (abrirCaptura) ou pela tecla C fora de campos de texto.
// Enter salva pela operação "capturar"; Shift+Enter quebra linha.
const EVENTO = 'pegada:capturar'

export function abrirCaptura() {
  window.dispatchEvent(new Event(EVENTO))
}

function digitandoEmCampo(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

type Sugestao = Record<string, string>

// Onde o avanço direto pode morar: resultados ativos e suas estratégias.
interface Lugar {
  id: string
  titulo: string
  contexto: string
  estrategias: { id: string; titulo: string }[]
}
interface Destino {
  resultadoId: string
  estrategiaId?: string
}
interface MapaCurto {
  resultados: { id: string; titulo: string; status: string; contexto: string; estrategias: { id: string; titulo: string }[] }[]
}
const DESTINOS: Record<string, string> = {
  resultado: 'um Resultado',
  vontade: 'uma Vontade',
  responsabilidade: 'uma Responsabilidade',
  estrategia: 'uma Estratégia',
}
const ARTIGO: Partial<Record<ActionKind, string>> = { acao: 'uma', reflexao: 'uma', ideia: 'uma', espera: 'uma' }

// Reconhecimento de voz do navegador (quando existe): dita direto no campo.
type Reconhecedor = {
  lang: string
  interimResults: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}
function criarReconhecedor(): Reconhecedor | null {
  const w = window as unknown as Record<string, unknown>
  const Classe = (w.SpeechRecognition || w.webkitSpeechRecognition) as (new () => Reconhecedor) | undefined
  return Classe ? new Classe() : null
}

export function GlobalCaptureHost() {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [sugestao, setSugestao] = useState<Sugestao | null>(null)
  const [dispensada, setDispensada] = useState('')
  const [ouvindo, setOuvindo] = useState(false)
  const [modo, setModo] = useState<'captura' | 'avanco'>('captura')
  const [lugares, setLugares] = useState<Lugar[] | null>(null)
  const [destino, setDestino] = useState<Destino | null>(null)
  const [hoje, setHoje] = useState(false)
  const travado = useRef(false)
  const voz = useRef<Reconhecedor | null>(null)
  const temVoz = typeof window !== 'undefined' && Boolean(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition,
  )

  useEffect(() => {
    const abrir = () => setAberto(true)
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (digitandoEmCampo(e.target) || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setAberto(true)
    }
    window.addEventListener(EVENTO, abrir)
    window.addEventListener('keydown', tecla)
    return () => {
      window.removeEventListener(EVENTO, abrir)
      window.removeEventListener('keydown', tecla)
    }
  }, [])

  // Sugestão do Pegada: depois de uma pausa na escrita, a IA embutida diz o
  // que a captura parece ser. Sem IA no servidor, nada aparece.
  useEffect(() => {
    const valor = texto.trim()
    setSugestao(null)
    if (!aberto || modo === 'avanco' || valor.length < 12 || valor === dispensada) return
    let vivo = true
    const t = setTimeout(() => {
      sugerir('captura', valor, true)
        .then((r) => {
          if (vivo && ['avanco', 'resultado', 'vontade', 'responsabilidade', 'estrategia'].includes(r.sugestao?.destino))
            setSugestao(r.sugestao)
        })
        .catch(() => {})
    }, 1500)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [texto, aberto, dispensada, modo])

  useEffect(() => {
    if (!aberto) {
      voz.current?.stop()
      setDispensada('')
      setModo('captura')
      setDestino(null)
      setHoje(false)
    }
  }, [aberto])

  // Ao entrar no modo avanço, busca os resultados ativos e suas estratégias.
  useEffect(() => {
    if (!aberto || modo !== 'avanco') return
    let vivo = true
    op<MapaCurto>('ver_mapa', {})
      .then((r) => {
        if (!vivo) return
        const rs = (r.resultado?.resultados ?? []).filter((x) => x.status === 'ativo')
        setLugares(rs.map((x) => ({ id: x.id, titulo: x.titulo, contexto: x.contexto, estrategias: x.estrategias ?? [] })))
      })
      .catch(() => vivo && setLugares([]))
    return () => {
      vivo = false
    }
  }, [aberto, modo])

  const criarAvanco = useCallback(async () => {
    const valor = texto.trim()
    if (!valor || travado.current) return
    travado.current = true
    setSalvando(true)
    try {
      await op(
        'criar_avanco',
        {
          titulo: valor,
          tipo: 'acao',
          ...(destino ? { resultado_id: destino.resultadoId } : {}),
          ...(destino?.estrategiaId ? { estrategia_id: destino.estrategiaId } : {}),
          ...(hoje ? { para_hoje: true } : {}),
        },
        { desfazer: true, onDesfeito: notificarMudanca },
      )
      setTexto('')
      setAberto(false)
      notificarMudanca()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível criar o avanço.')
    } finally {
      travado.current = false
      setSalvando(false)
    }
  }, [texto, destino, hoje])

  const salvar = useCallback(
    async (aceita?: Sugestao | null) => {
      const valor = texto.trim()
      if (!valor || travado.current) return
      travado.current = true
      setSalvando(true)
      try {
        const captura = await captureService.create(valor)
        setTexto('')
        setAberto(false)
        if (aceita && (aceita.destino === 'avanco' || aceita.destino === 'resultado')) {
          const tipo = aceita.tipo in ACTION_KIND_LABEL && aceita.tipo !== 'espera' ? aceita.tipo : 'acao'
          await op(
            'processar_captura',
            {
              captura_id: captura.id,
              destino: aceita.destino,
              dados: aceita.destino === 'resultado' ? { situacao: 'rascunho' } : { tipo },
            },
            { origem: 'sugestao_ia', desfazer: true, onDesfeito: notificarMudanca },
          )
        } else {
          toast.success('Capturado')
        }
        notificarMudanca()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Não foi possível capturar.')
      } finally {
        travado.current = false
        setSalvando(false)
      }
    },
    [texto],
  )

  const falar = () => {
    if (ouvindo) {
      voz.current?.stop()
      return
    }
    const r = criarReconhecedor()
    if (!r) return
    r.lang = 'pt-BR'
    r.interimResults = false
    r.onresult = (e) => {
      const dito = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join(' ')
        .trim()
      if (dito) setTexto((t) => (t.trim() ? `${t.trim()} ${dito}` : dito))
    }
    r.onend = () => setOuvindo(false)
    r.onerror = () => {
      setOuvindo(false)
      toast.error('Não consegui ouvir. Confira a permissão do microfone.')
    }
    voz.current = r
    setOuvindo(true)
    r.start()
  }

  const aplicavel = sugestao && (sugestao.destino === 'avanco' || sugestao.destino === 'resultado')
  const tipoSugerido = (sugestao?.tipo in ACTION_KIND_LABEL ? sugestao?.tipo : 'acao') as ActionKind

  return (
    <Sheet open={aberto} onOpenChange={setAberto}>
      <SheetContent
        side="bottom"
        className="mx-auto flex max-w-xl flex-col gap-4 rounded-t-[28px] border-border bg-background px-5 pb-7 pt-3 [&>button]:hidden"
      >
        <div aria-hidden="true" className="h-[5px] w-10 self-center rounded-full bg-input" />
        <SheetHeader className="flex-row items-center justify-between space-y-0 text-left">
          <SheetTitle className="text-[22px] font-semibold tracking-tight">
            {modo === 'avanco' ? 'Novo avanço' : 'O que surgiu?'}
          </SheetTitle>
          <button
            type="button"
            aria-label="Fechar captura"
            onClick={() => setAberto(false)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-secondary text-foreground"
          >
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </SheetHeader>
        <div className="flex flex-col gap-2">
          <SheetDescription asChild>
            <label htmlFor="captura-texto" className="text-sm text-muted-foreground">
              {modo === 'avanco'
                ? 'O que você vai fazer? Comece por um verbo.'
                : `${temVoz ? 'Escreva ou fale.' : 'Escreva.'} Você decide o destino depois.`}
            </label>
          </SheetDescription>
          <textarea
            id="captura-texto"
            autoFocus
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void (modo === 'avanco' ? criarAvanco() : salvar())
              }
            }}
            rows={modo === 'avanco' ? 2 : 3}
            className="min-h-20 w-full resize-none rounded-[18px] border-2 border-foreground bg-card px-4 py-3.5 text-lg leading-snug text-foreground outline-none"
          />
        </div>

        {modo === 'avanco' && (
          <div className="flex min-h-0 flex-col gap-2" data-avanco-direto>
            <p className="text-sm text-muted-foreground">Para alcançar o quê? Se não escolher, ele fica livre.</p>
            <div role="radiogroup" aria-label="Onde o avanço entra" className="-mx-1 max-h-[34dvh] overflow-y-auto px-1">
              {[{ chave: 'livre', rotulo: 'Sem vínculo', sub: 'Avanço livre', d: null as Destino | null, recuo: false }]
                .concat(
                  (lugares ?? []).flatMap((l) => [
                    { chave: l.id, rotulo: l.titulo, sub: 'Resultado', d: { resultadoId: l.id } as Destino | null, recuo: false },
                    ...l.estrategias.map((e) => ({
                      chave: `${l.id}:${e.id}`,
                      rotulo: e.titulo,
                      sub: 'Estratégia',
                      d: { resultadoId: l.id, estrategiaId: e.id } as Destino | null,
                      recuo: true,
                    })),
                  ]),
                )
                .map((o) => {
                  const marcado = (o.d?.resultadoId ?? '') === (destino?.resultadoId ?? '') && (o.d?.estrategiaId ?? '') === (destino?.estrategiaId ?? '')
                  return (
                    <button
                      key={o.chave}
                      type="button"
                      role="radio"
                      aria-checked={marcado}
                      onClick={() => setDestino(o.d)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        o.recuo && 'pl-8',
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
                      <span className="min-w-0">
                        <span className="block break-words text-[15px] leading-snug text-foreground">{o.rotulo}</span>
                        <span className="block text-[13px] text-muted-foreground">{o.sub}</span>
                      </span>
                    </button>
                  )
                })}
              {lugares === null && <p className="px-2 py-2 text-sm text-muted-foreground">Carregando os resultados…</p>}
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hoje}
              onClick={() => setHoje((v) => !v)}
              className="flex min-h-11 items-center gap-3 rounded-xl px-2 text-left text-[15px] text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full', hoje ? 'bg-primary' : 'border-2 border-input')} />
              Fazer hoje
            </button>
          </div>
        )}

        {sugestao && modo === 'captura' && (
          <div className="flex flex-col gap-2" data-sugestao>
            <p className="text-[13px] uppercase tracking-[0.06em] text-muted-foreground">Sugestão do Pegada</p>
            <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3">
              <p className="text-[15px] leading-snug text-foreground">
                Parece{' '}
                {sugestao.destino === 'avanco' ? (
                  <>
                    {ARTIGO[tipoSugerido] ?? 'um'}{' '}
                    <span className="font-semibold">{ACTION_KIND_LABEL[tipoSugerido]}</span>
                  </>
                ) : (
                  <span className="font-semibold">{DESTINOS[sugestao.destino]}</span>
                )}
                .{!aplicavel && ' Guarde agora e escolha o destino em Capturas.'}
              </p>
              <div className="flex flex-wrap gap-2">
                {aplicavel && (
                  <button
                    type="button"
                    disabled={salvando}
                    onClick={() => void salvar(sugestao)}
                    className="h-11 rounded-full bg-foreground px-4 text-[15px] font-medium text-background disabled:opacity-60"
                  >
                    Aceitar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setDispensada(texto.trim())
                    setSugestao(null)
                  }}
                  className="h-11 rounded-full border border-muted-foreground px-4 text-[15px] font-medium text-foreground"
                >
                  Decidir depois
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2.5">
          {temVoz && (
            <button
              type="button"
              aria-label={ouvindo ? 'Parar de ouvir' : 'Capturar por voz'}
              aria-pressed={ouvindo}
              onClick={falar}
              className={
                ouvindo
                  ? 'flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-foreground text-background'
                  : 'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-muted-foreground bg-card text-foreground'
              }
            >
              <Mic className="h-6 w-6" aria-hidden="true" />
            </button>
          )}
          <Button
            onClick={() => void (modo === 'avanco' ? criarAvanco() : salvar())}
            disabled={salvando || !texto.trim()}
            className="h-14 flex-1 rounded-full text-lg font-semibold"
          >
            {modo === 'avanco' ? 'Criar avanço' : 'Capturar'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-4 text-[13px] text-muted-foreground">
          <button
            type="button"
            onClick={() => setModo(modo === 'avanco' ? 'captura' : 'avanco')}
            className="min-h-11 font-medium text-foreground underline underline-offset-4"
            data-trocar-modo
          >
            {modo === 'avanco' ? 'Só capturar e decidir depois' : 'Já é um avanço'}
          </button>
          {modo === 'captura' && (
            <Link to="/caixa" onClick={() => setAberto(false)} className="flex min-h-11 items-center underline underline-offset-4">
              Ver capturas
            </Link>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

export default GlobalCaptureHost

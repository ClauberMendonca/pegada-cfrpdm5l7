// PEGADA — Revisão guiada: um passo de cada vez, sempre a partir da operação
// ver_resumo_semana (nada é recalculado no navegador). Cada decisão passa pela
// API do método e mostra Desfazer.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { op } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'
import { cn } from '@/lib/utils'

interface ResultadoView {
  id: string
  numero: number | null
  titulo: string
  prazo: string
  status: string
}
interface Resumo {
  periodo_dias: number
  concluidos: number
  espelho: {
    resultado: { id: string; titulo: string }
    concluidos: { id: string; titulo: string; tipo: string }[]
  }[]
  resultados_parados: ResultadoView[]
  balanco: { construir: number; sustentar: number; livres: number; percentual_livres: number }
  estrategias: {
    id: string
    titulo: string
    resultado_id: string
    sinal_de_teste: string
    avancos_concluidos: number
    pergunta: string
  }[]
  esperas_abertas: { id: string; titulo: string; aguardando: string; desde: string; pergunta: string }[]
  capturas_pendentes: number
}

const PERIODOS = [
  { dias: 1, nome: 'Diária', frase: 'hoje' },
  { dias: 7, nome: 'Semanal', frase: 'nos últimos 7 dias' },
  { dias: 90, nome: 'Trimestral', frase: 'nos últimos 90 dias' },
  { dias: 365, nome: 'Anual', frase: 'nos últimos 12 meses' },
]

const PASSOS = ['Espelho', 'Balanço', 'Resultados parados', 'Apostas', 'Esperas', 'Fechamento']

export function GuidedReview({ onChanged }: { onChanged?: () => void }) {
  const [dias, setDias] = useState(7)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [passo, setPasso] = useState(0)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    setErro(null)
    try {
      const res = await op<Resumo>('ver_resumo_semana', { dias })
      setResumo((res.resultado as Resumo) ?? null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível preparar a revisão.')
    } finally {
      setCarregando(false)
    }
  }, [dias])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const mudou = () => {
    void carregar()
    notificarMudanca()
    onChanged?.()
  }

  const decidir = async (chave: string, nome: string, entrada: Record<string, unknown>) => {
    if (ocupado) return
    setOcupado(chave)
    try {
      await op(nome, entrada, { desfazer: true, onDesfeito: mudou })
      mudou()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gravar a decisão.')
    } finally {
      setOcupado(null)
    }
  }

  const periodo = PERIODOS.find((p) => p.dias === dias) ?? PERIODOS[1]
  const ultimo = passo === PASSOS.length - 1

  return (
    <section
      aria-label="Revisão guiada"
      className="rounded-2xl border border-border bg-card p-4 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Revisão guiada</h3>
          <p className="text-sm text-muted-foreground">
            Um passo de cada vez: olhar o que foi feito, decidir o que segue.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              aria-pressed={p.dias === dias}
              onClick={() => {
                setDias(p.dias)
                setPasso(0)
              }}
              className={cn(
                'min-h-9 rounded-lg px-3 text-sm font-medium transition-colors',
                p.dias === dias
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.nome}
            </button>
          ))}
        </div>
      </div>

      <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {PASSOS.map((nome, i) => (
          <li key={nome}>
            <button
              type="button"
              onClick={() => setPasso(i)}
              aria-current={i === passo ? 'step' : undefined}
              className={cn(
                'rounded-md px-1.5 py-1',
                i === passo
                  ? 'font-semibold text-primary'
                  : i < passo
                    ? 'text-foreground'
                    : 'text-muted-foreground',
              )}
            >
              {i + 1}. {nome}
            </button>
          </li>
        ))}
      </ol>

      {carregando && !resumo && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Preparando a revisão…
        </p>
      )}

      {erro && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-ginga-danger-bg p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            <p className="text-sm text-destructive">{erro}</p>
            <Button size="sm" variant="outline" onClick={() => void carregar()} className="mt-2 gap-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Tentar novamente
            </Button>
          </div>
        </div>
      )}

      {resumo && !erro && (
        <div className="space-y-3" data-passo={PASSOS[passo]}>
          {passo === 0 && (
            <>
              <Pergunta>O que eu concluí {periodo.frase}?</Pergunta>
              <p className="text-sm text-foreground">
                {resumo.concluidos === 0
                  ? 'Nenhum avanço concluído neste período.'
                  : resumo.concluidos === 1
                    ? '1 avanço concluído.'
                    : `${resumo.concluidos} avanços concluídos.`}
              </p>
              {resumo.espelho.map((g) => (
                <div key={g.resultado.id} className="rounded-xl border border-border p-3">
                  <Link
                    to={`/resultados?id=${encodeURIComponent(g.resultado.id)}`}
                    className="text-sm font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {g.resultado.titulo}
                  </Link>
                  <ul className="mt-1.5 space-y-1">
                    {g.concluidos.map((a) => (
                      <li key={a.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ginga-success" aria-hidden="true" />
                        <span className="min-w-0 break-words">{a.titulo}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          )}

          {passo === 1 && (
            <>
              <Pergunta>Meu esforço foi para onde eu queria?</Pergunta>
              {resumo.concluidos === 0 ? (
                <Vazio>Sem avanços concluídos neste período, não há balanço para mostrar.</Vazio>
              ) : (
                <div className="space-y-2">
                  <Barra nome="Construir" ajuda="avanços ligados a um resultado" n={resumo.balanco.construir} total={resumo.concluidos} />
                  <Barra nome="Sustentar" ajuda="avanços que mantêm uma responsabilidade" n={resumo.balanco.sustentar} total={resumo.concluidos} />
                  <Barra nome="Livres" ajuda="avanços sem porquê" n={resumo.balanco.livres} total={resumo.concluidos} />
                  <p className="text-sm text-muted-foreground">
                    {resumo.balanco.percentual_livres}% do que você concluiu não estava ligado a nenhum porquê.
                  </p>
                </div>
              )}
            </>
          )}

          {passo === 2 && (
            <>
              <Pergunta>Estes resultados ativos não tiveram avanço concluído {periodo.frase}. O que faço com cada um?</Pergunta>
              {resumo.resultados_parados.length === 0 && (
                <Vazio>Todos os resultados ativos tiveram avanço neste período.</Vazio>
              )}
              {resumo.resultados_parados.map((r) => (
                <div key={r.id} className="space-y-2 rounded-xl border border-border p-3">
                  <Link
                    to={`/resultados?id=${encodeURIComponent(r.id)}`}
                    className="block break-words text-sm font-medium text-foreground underline-offset-2 hover:underline"
                  >
                    {r.titulo}
                  </Link>
                  {r.prazo && <p className="text-xs tabular-nums text-muted-foreground">Prazo: {r.prazo.slice(0, 10)}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/resultados?id=${encodeURIComponent(r.id)}`}>Sigo: definir avanço</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!ocupado}
                      onClick={() => decidir(r.id, 'decidir_resultado', { resultado_id: r.id, decisao: 'pausar' })}
                    >
                      Pausar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!ocupado}
                      onClick={() => decidir(r.id, 'decidir_resultado', { resultado_id: r.id, decisao: 'abandonar' })}
                    >
                      Abandonar
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}

          {passo === 3 && (
            <>
              <Pergunta>Minhas apostas estão me aproximando dos resultados?</Pergunta>
              {resumo.estrategias.length === 0 && <Vazio>Nenhuma estratégia ativa para testar.</Vazio>}
              {resumo.estrategias.map((s) => (
                <div key={s.id} className="space-y-2 rounded-xl border border-border p-3">
                  <p className="break-words text-sm font-medium text-foreground">{s.titulo}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.avancos_concluidos === 1
                      ? '1 avanço concluído no período'
                      : `${s.avancos_concluidos} avanços concluídos no período`}
                    {s.sinal_de_teste ? ` · Sinal de teste: ${s.sinal_de_teste}` : ' · Sem sinal de teste definido'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link to={`/resultados?id=${encodeURIComponent(s.resultado_id)}`}>Abrir resultado</Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!ocupado}
                      onClick={() => decidir(s.id, 'arquivar_estrategia', { estrategia_id: s.id })}
                    >
                      Trocar de aposta (arquivar)
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}

          {passo === 4 && (
            <>
              <Pergunta>Preciso cobrar alguém?</Pergunta>
              {resumo.esperas_abertas.length === 0 && <Vazio>Nenhuma espera aberta.</Vazio>}
              {resumo.esperas_abertas.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-foreground">{e.titulo}</p>
                    <p className="text-xs text-muted-foreground">
                      {e.aguardando ? `Aguardando: ${e.aguardando} · ` : ''}desde {e.desde}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/avancos?id=${encodeURIComponent(e.id)}`}>Abrir avanço</Link>
                  </Button>
                </div>
              ))}
            </>
          )}

          {passo === 5 && (
            <>
              <Pergunta>Para fechar: a caixa de entrada está limpa?</Pergunta>
              {resumo.capturas_pendentes === 0 ? (
                <Vazio>Nenhuma captura pendente. Revisão concluída.</Vazio>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
                  <p className="text-sm text-foreground">
                    {resumo.capturas_pendentes === 1
                      ? '1 captura esperando ser processada.'
                      : `${resumo.capturas_pendentes} capturas esperando ser processadas.`}
                  </p>
                  <Button size="sm" asChild>
                    <Link to="/capturas">Processar capturas</Link>
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button variant="ghost" size="sm" disabled={passo === 0} onClick={() => setPasso((p) => p - 1)} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Voltar
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          Passo {passo + 1} de {PASSOS.length}
        </span>
        <Button size="sm" disabled={ultimo} onClick={() => setPasso((p) => p + 1)} className="gap-1.5">
          Próximo passo
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  )
}

function Pergunta({ children }: { children: React.ReactNode }) {
  return <p className="text-base font-medium text-foreground">{children}</p>
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{children}</p>
}

function Barra({ nome, ajuda, n, total }: { nome: string; ajuda: string; n: number; total: number }) {
  const pct = total ? Math.round((n * 100) / total) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-foreground">
          <span className="font-medium">{nome}</span>{' '}
          <span className="text-xs text-muted-foreground">{ajuda}</span>
        </span>
        <span className="tabular-nums text-muted-foreground">
          {n} · {pct}%
        </span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-muted">
        <div className="h-2 rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default GuidedReview

// PEGADA — Revisão guiada, como no desenho: tela focada (sem navegação),
// barra de progresso e um resultado por vez com três respostas.
// A fonte é a operação ver_resumo_semana; cada decisão passa pela API do
// método e mostra Desfazer.
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { AlertCircle, Check, CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { op } from '@/lib/pegada/api'
import { notificarMudanca } from '@/services/actionService'
import { cn } from '@/lib/utils'

interface ResultadoAtivo {
  id: string
  titulo: string
  prazo: string
  avancos_total: number
  avancos_feitos: number
  feitos_no_periodo: number
  dias_parado: number | null
  estrategias: { id: string; titulo: string }[]
}
interface Resumo {
  periodo_dias: number
  proposito?: string
  concluidos: number
  espelho: {
    resultado: { id: string; titulo: string }
    concluidos: { id: string; titulo: string; tipo: string }[]
  }[]
  resultados_ativos: ResultadoAtivo[]
  balanco: { construir: number; sustentar: number; livres: number; percentual_livres: number }
  esperas_abertas: { id: string; titulo: string; aguardando: string; desde: string }[]
  capturas_pendentes: number
}

const PERIODOS = [
  { dias: 1, nome: 'Diária', titulo: 'Revisão do dia', frase: 'hoje', duracao: 'cerca de 2 min' },
  { dias: 7, nome: 'Semanal', titulo: 'Revisão da semana', frase: 'na semana', duracao: 'cerca de 10 min' },
  { dias: 90, nome: 'Trimestral', titulo: 'Revisão do trimestre', frase: 'no trimestre', duracao: 'cerca de 20 min' },
  { dias: 365, nome: 'Anual', titulo: 'Revisão do ano', frase: 'no ano', duracao: 'cerca de 30 min' },
]

const PASSOS = [
  { nome: 'O que andou', titulo: 'O que você fez andar?' },
  { nome: 'Resultados', titulo: 'Os resultados ainda valem?' },
  { nome: 'Esperas', titulo: 'Precisa cobrar alguém?' },
  { nome: 'Fechamento', titulo: 'A caixa de entrada está limpa?' },
]

type Resposta = 'sigo' | 'ajustar' | 'nao_vale'
const RESPOSTAS: { valor: Resposta; texto: string }[] = [
  { valor: 'sigo', texto: 'Sim, sigo com ela' },
  { valor: 'ajustar', texto: 'Quero ajustar a estratégia' },
  { valor: 'nao_vale', texto: 'Este resultado não vale mais' },
]

function ateOPrazo(prazo: string): { valor: string; legenda: string } | null {
  if (!prazo) return null
  const dias = Math.round((new Date(`${prazo.slice(0, 10)}T12:00:00`).getTime() - Date.now()) / 86400000)
  if (dias < 0) return { valor: `${-dias} d`, legenda: 'de atraso' }
  if (dias < 14) return { valor: `${dias} d`, legenda: 'até o prazo' }
  return { valor: `${Math.round(dias / 7)} sem`, legenda: 'até o prazo' }
}

export function GuidedReview({ onChanged }: { onChanged?: () => void }) {
  const [dias, setDias] = useState(7)
  const [aberta, setAberta] = useState(false)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [passo, setPasso] = useState(0)
  const [indice, setIndice] = useState(0)
  const [respostas, setRespostas] = useState<Record<string, Resposta>>({})
  const [ocupado, setOcupado] = useState(false)

  const periodo = PERIODOS.find((p) => p.dias === dias) ?? PERIODOS[1]

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

  const comecar = () => {
    setPasso(0)
    setIndice(0)
    setRespostas({})
    setResumo(null)
    setAberta(true)
    void carregar()
  }

  const sair = () => {
    setAberta(false)
    notificarMudanca()
    onChanged?.()
  }

  // A tela focada cobre o app inteiro: a página de trás não rola.
  useEffect(() => {
    if (!aberta) return
    const antes = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = antes
    }
  }, [aberta])

  const resultados = resumo?.resultados_ativos ?? []
  const atual = passo === 1 ? resultados[indice] : undefined
  const ajustar = resultados.filter((r) => respostas[r.id] === 'ajustar')

  const avancar = async () => {
    if (ocupado) return
    if (passo === 1 && atual) {
      if (respostas[atual.id] === 'nao_vale') {
        setOcupado(true)
        try {
          await op(
            'decidir_resultado',
            { resultado_id: atual.id, decisao: 'abandonar' },
            { desfazer: true, onDesfeito: () => void carregar() },
          )
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Não foi possível gravar a decisão.')
          setOcupado(false)
          return
        }
        setOcupado(false)
      }
      if (indice < resultados.length - 1) {
        setIndice(indice + 1)
        return
      }
    }
    if (passo === PASSOS.length - 1) sair()
    else setPasso(passo + 1)
  }

  const voltar = () => {
    if (passo === 1 && indice > 0) setIndice(indice - 1)
    else if (passo > 0) {
      setPasso(passo - 1)
      if (passo === 2) setIndice(Math.max(0, resultados.length - 1))
    }
  }

  const rotuloAvancar =
    passo === PASSOS.length - 1
      ? 'Concluir revisão'
      : passo === 1 && indice < resultados.length - 1
        ? 'Próximo resultado'
        : 'Continuar'

  return (
    <>
      {/* Entrada: escolher o período e começar. */}
      <section
        aria-label="Revisão guiada"
        className="space-y-4 rounded-3xl border border-border bg-card p-5"
      >
        <div>
          <h3 className="text-xl font-semibold text-foreground">Revisão guiada</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Um passo de cada vez: o que andou, se os resultados ainda valem, o que está esperando
            e o que falta decidir.
          </p>
        </div>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button
              key={p.dias}
              type="button"
              aria-pressed={p.dias === dias}
              onClick={() => setDias(p.dias)}
              className={cn(
                'h-11 rounded-full px-3.5 text-sm font-medium transition-colors',
                p.dias === dias
                  ? 'bg-foreground text-background'
                  : 'border border-input bg-card text-foreground hover:bg-secondary',
              )}
            >
              {p.nome}
            </button>
          ))}
        </div>
        <Button onClick={comecar} className="h-[52px] w-full rounded-full text-[17px] font-semibold">
          Começar a revisão
        </Button>
      </section>

      {aberta &&
        createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={periodo.titulo}
          data-revisao
          className="fixed inset-0 z-[60] flex flex-col bg-background"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-[640px] flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">
                  {periodo.titulo} · {periodo.duracao}
                </p>
                <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-foreground">
                  {PASSOS[passo].titulo}
                </h1>
              </div>
              <button
                type="button"
                aria-label="Sair da revisão e continuar depois"
                onClick={sair}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-2">
              <div role="img" aria-label={`Passo ${passo + 1} de ${PASSOS.length}`} className="flex gap-1.5">
                {PASSOS.map((p, i) => (
                  <div
                    key={p.nome}
                    className={cn('h-1.5 flex-1 rounded-full', i <= passo ? 'bg-foreground' : 'bg-muted-foreground/25')}
                  />
                ))}
              </div>
              <div className="flex justify-between gap-3 text-[13px] text-muted-foreground">
                <span>
                  Passo {passo + 1} de {PASSOS.length} ·{' '}
                  <span className="font-semibold text-foreground">{PASSOS[passo].nome}</span>
                </span>
                {passo < PASSOS.length - 1 && <span>a seguir: {PASSOS[passo + 1].nome.toLowerCase()}</span>}
              </div>
            </div>

            {carregando && !resumo && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Preparando a revisão…
              </p>
            )}

            {erro && (
              <div className="flex items-start gap-3 rounded-2xl border border-destructive/30 p-3">
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
              <div className="space-y-3 pb-4" data-passo={PASSOS[passo].nome}>
                {passo === 0 && (
                  <>
                    <div className="flex gap-2">
                      <Numero valor={resumo.concluidos} legenda={`feitos ${periodo.frase}`} />
                      <Numero valor={resumo.balanco.construir + resumo.balanco.sustentar} legenda="com porquê" />
                      <Numero valor={resumo.balanco.livres} legenda="sem porquê" />
                    </div>
                    {resumo.concluidos === 0 && (
                      <Vazio>Nenhum avanço concluído {periodo.frase}. Acontece: o próximo passo mostra o que retomar.</Vazio>
                    )}
                    {resumo.espelho.map((g) => (
                      <div key={g.resultado.id} className="rounded-3xl border border-border bg-card p-4">
                        <p className="break-words text-base font-semibold text-foreground">{g.resultado.titulo}</p>
                        <ul className="mt-2 space-y-1.5">
                          {g.concluidos.map((a) => (
                            <li key={a.id} className="flex items-start gap-2 text-sm text-muted-foreground">
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                              <span className="min-w-0 break-words">{a.titulo}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </>
                )}

                {passo === 1 && !atual && <Vazio>Nenhum resultado ativo para revisar.</Vazio>}

                {passo === 1 && atual && (
                  <>
                    <div className="space-y-3 rounded-3xl border border-border bg-card p-4">
                      <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                        Resultado {indice + 1} de {resultados.length}
                        {atual.prazo ? ` · até ${atual.prazo.slice(0, 10).split('-').reverse().join('/')}` : ''}
                      </p>
                      <p className="break-words text-[22px] font-semibold leading-tight text-foreground">
                        {atual.titulo}
                      </p>
                      {resumo.proposito && (
                        <p className="break-words text-sm leading-snug text-muted-foreground">
                          porque {resumo.proposito.charAt(0).toLowerCase() + resumo.proposito.slice(1)}
                        </p>
                      )}
                      <div className="flex items-center gap-2.5">
                        <div
                          role="img"
                          aria-label={`${atual.avancos_feitos} de ${atual.avancos_total} avanços concluídos`}
                          className="h-2 flex-1 overflow-hidden rounded-full bg-muted-foreground/25"
                        >
                          <div
                            className="h-2 rounded-full bg-foreground"
                            style={{
                              width: `${atual.avancos_total ? Math.round((atual.avancos_feitos * 100) / atual.avancos_total) : 0}%`,
                            }}
                          />
                        </div>
                        <p className="text-[13px] text-muted-foreground">
                          {atual.avancos_feitos} de {atual.avancos_total} avanços
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Numero valor={atual.feitos_no_periodo} legenda={`feitos ${periodo.frase}`} fundo />
                        <Numero
                          valor={atual.dias_parado === null ? '–' : atual.dias_parado}
                          legenda={atual.dias_parado === null ? 'nada concluído ainda' : atual.dias_parado === 1 ? 'dia parado' : 'dias parado'}
                          fundo
                        />
                        {ateOPrazo(atual.prazo) && (
                          <Numero valor={ateOPrazo(atual.prazo)!.valor} legenda={ateOPrazo(atual.prazo)!.legenda} fundo />
                        )}
                      </div>
                    </div>
                    <div className="space-y-2.5">
                      <p className="text-base font-semibold text-foreground">
                        {atual.estrategias.length ? 'A estratégia está funcionando?' : 'Este resultado ainda vale?'}
                      </p>
                      <p className="break-words text-sm leading-snug text-muted-foreground">
                        {atual.estrategias.length
                          ? `Aposta atual: ${atual.estrategias.map((e) => e.titulo).join('; ')}.`
                          : 'Este resultado ainda não tem uma estratégia escrita.'}
                      </p>
                      <div className="flex flex-col gap-2">
                        {RESPOSTAS.filter((r) => r.valor !== 'ajustar' || atual.estrategias.length > 0).map((r) => {
                          const marcada = (respostas[atual.id] ?? 'sigo') === r.valor
                          return (
                            <button
                              key={r.valor}
                              type="button"
                              aria-pressed={marcada}
                              onClick={() => setRespostas((v) => ({ ...v, [atual.id]: r.valor }))}
                              className={cn(
                                'flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-card px-4 text-left text-base font-medium text-foreground',
                                marcada ? 'border-2 border-foreground' : 'border border-input',
                              )}
                            >
                              {r.valor === 'sigo' && !atual.estrategias.length ? 'Sim, sigo com ele' : r.texto}
                              {marcada && <Check className="h-5 w-5 shrink-0" aria-hidden="true" />}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </>
                )}

                {passo === 2 && (
                  <>
                    {resumo.esperas_abertas.length === 0 && <Vazio>Nenhuma espera aberta.</Vazio>}
                    {resumo.esperas_abertas.map((e) => (
                      <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-border bg-card p-4">
                        <div className="min-w-0">
                          <p className="break-words text-base font-medium text-foreground">{e.titulo}</p>
                          <p className="text-[13px] text-muted-foreground">
                            {e.aguardando ? `Aguardando: ${e.aguardando} · ` : ''}desde {e.desde.split('-').reverse().join('/')}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" asChild className="rounded-full">
                          <Link to={`/avancos?id=${encodeURIComponent(e.id)}`} onClick={sair}>
                            Abrir avanço
                          </Link>
                        </Button>
                      </div>
                    ))}
                  </>
                )}

                {passo === 3 && (
                  <>
                    {resumo.capturas_pendentes === 0 ? (
                      <Vazio>Nenhuma captura pendente.</Vazio>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-3xl border border-border bg-card p-4">
                        <p className="text-base text-foreground">
                          {resumo.capturas_pendentes === 1
                            ? '1 captura esperando decisão.'
                            : `${resumo.capturas_pendentes} capturas esperando decisão.`}
                        </p>
                        <Button size="sm" asChild className="rounded-full">
                          <Link to="/capturas" onClick={sair}>
                            Decidir capturas
                          </Link>
                        </Button>
                      </div>
                    )}
                    {ajustar.length > 0 && (
                      <div className="space-y-2 rounded-3xl border border-border bg-card p-4">
                        <p className="text-base font-semibold text-foreground">Estratégias que você quer ajustar</p>
                        {ajustar.map((r) => (
                          <Link
                            key={r.id}
                            to={`/resultados?id=${encodeURIComponent(r.id)}`}
                            onClick={sair}
                            className="block break-words text-sm text-foreground underline underline-offset-4"
                          >
                            {r.titulo}
                          </Link>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="mx-auto flex w-full max-w-[640px] gap-2.5 px-5 pb-6 pt-3">
            <button
              type="button"
              disabled={(passo === 0 && indice === 0) || ocupado}
              onClick={voltar}
              className="h-[52px] rounded-full border border-muted-foreground px-5 text-base font-medium text-foreground disabled:opacity-40"
            >
              Voltar
            </button>
            <Button
              disabled={ocupado || (!resumo && !erro)}
              onClick={() => void avancar()}
              className="h-[52px] flex-1 rounded-full text-lg font-semibold"
            >
              {rotuloAvancar}
            </Button>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

function Numero({ valor, legenda, fundo }: { valor: number | string; legenda: string; fundo?: boolean }) {
  return (
    <div className={cn('min-w-0 flex-1 rounded-[14px] px-3 py-2.5', fundo ? 'bg-background' : 'border border-border bg-card')}>
      <p className="text-xl font-semibold text-foreground">{valor}</p>
      <p className="text-[13px] leading-tight text-muted-foreground">{legenda}</p>
    </div>
  )
}

function Vazio({ children }: { children: React.ReactNode }) {
  return <p className="rounded-3xl bg-secondary p-4 text-sm text-muted-foreground">{children}</p>
}

export default GuidedReview

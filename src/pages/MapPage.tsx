import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ChevronRight, Loader2 } from 'lucide-react'
import { op } from '@/lib/pegada/api'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { cn } from '@/lib/utils'

// PEGADA — Mapa do sentido: uma trilha do Propósito às Responsabilidades,
// e de cada Responsabilidade aos seus Resultados e Estratégias.
// Fonte única: a operação ver_mapa (o MCP lê o mesmo).

interface MapaAvanco {
  id: string
  titulo: string
  tipo: string
}
interface MapaEstrategia {
  id: string
  titulo: string
  sinal_de_teste: string
  avancos?: MapaAvanco[]
}
interface MapaResultado {
  id: string
  numero: number | null
  titulo: string
  prazo: string
  como_sei: string
  status: string
  contexto: string
  responsabilidade_id: string | null
  estrategias: MapaEstrategia[]
  avancos_abertos: number
  avancos_total?: number
  avancos_feitos?: number
  avancos_sem_estrategia?: MapaAvanco[]
}
interface MapaResponsabilidade {
  id: string
  titulo: string
  contexto: string
  escolhida_por: string | null
}
interface Mapa {
  proposito: string
  responsabilidades: MapaResponsabilidade[]
  resultados: MapaResultado[]
  avancos_sem_fio: number
  resultados_sem_forma_minima: { id: string; titulo: string }[]
  limite_resultados_ativos: number
}

const STATUS_LABEL: Record<string, string> = {
  ativo: 'Ativo',
  futuro: 'Futuro',
  pausado: 'Pausado',
  rascunho: 'Rascunho',
}
const STATUS_ORDER: Record<string, number> = { ativo: 0, pausado: 1, rascunho: 2, futuro: 3 }

function formatarPrazo(prazo: string): string {
  if (!prazo) return ''
  const d = new Date(prazo.slice(0, 10) + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function ResultadoItem({ r, semForma }: { r: MapaResultado; semForma: boolean }) {
  const prazo = formatarPrazo(r.prazo)
  return (
    <li>
      <Link
        to={`/resultados?id=${r.id}`}
        className="flex min-h-11 items-start gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full',
            r.status === 'ativo' ? 'bg-primary' : 'border border-input bg-transparent',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-base font-medium text-foreground">{r.titulo}</span>
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
            <span>{STATUS_LABEL[r.status] ?? r.status}</span>
            {prazo && <span>até {prazo}</span>}
            {r.avancos_abertos > 0 && (
              <span>
                {r.avancos_abertos} {r.avancos_abertos === 1 ? 'avanço aberto' : 'avanços abertos'}
              </span>
            )}
            {semForma && (
              <span className="font-medium text-destructive">sem prazo: toque para completar</span>
            )}
          </span>
          {r.estrategias.length > 0 && (
            <span className="mt-2 block space-y-1 border-l-2 border-border pl-3">
              {r.estrategias.map((s) => (
                <span key={s.id} className="block text-sm text-foreground">
                  <span className="text-muted-foreground">Estratégia: </span>
                  {s.titulo}
                </span>
              ))}
            </span>
          )}
        </span>
        <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  )
}

function ListaDeAvancos({ itens }: { itens: MapaAvanco[] }) {
  return (
    <ul className="flex flex-col gap-2 border-t border-border pt-2.5">
      {itens.map((a) => (
        <li key={a.id}>
          <Link
            to={`/avancos?id=${encodeURIComponent(a.id)}`}
            className="flex min-h-7 items-center gap-2.5 text-[15px] text-foreground"
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-muted-foreground"
            />
            <span className="min-w-0 break-words">{a.titulo}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

// Um resultado na trilha do Construir: prazo, título, progresso e, aberto,
// as estratégias com os avanços de cada uma.
function ResultadoNo({
  r,
  aberto,
  onAlternar,
  semForma,
}: {
  r: MapaResultado
  aberto: boolean
  onAlternar: () => void
  semForma: boolean
}) {
  const prazo = formatarPrazo(r.prazo)
  const ativo = r.status === 'ativo'
  const total = r.avancos_total ?? 0
  const feitos = r.avancos_feitos ?? 0
  const soltos = r.avancos_sem_estrategia ?? []
  return (
    <li
      className={cn(
        'relative flex flex-col gap-3 border-l-2 py-3.5 pl-[18px]',
        ativo ? 'border-primary' : 'border-input',
      )}
      data-resultado={r.id}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute -left-2 top-6 h-3.5 w-3.5 rounded-full',
          ativo ? 'bg-primary' : 'border-2 border-muted-foreground bg-background',
        )}
      />
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
          Resultado
          {!ativo && ` · ${(STATUS_LABEL[r.status] ?? r.status).toLowerCase()}`}
          {prazo && ` · até ${prazo}`}
        </p>
        <Link
          to={`/resultados?id=${r.id}`}
          className="break-words text-[19px] font-semibold leading-tight text-foreground"
        >
          {r.titulo}
        </Link>
        {semForma && (
          <p className="text-[13px] font-medium text-destructive">Sem prazo: toque no título para completar.</p>
        )}
      </div>
      <div className="flex items-center gap-2.5">
        <div
          role="img"
          aria-label={`${feitos} de ${total} avanços concluídos`}
          className="h-2 flex-1 overflow-hidden rounded-full bg-muted-foreground/25"
        >
          <div
            className="h-2 rounded-full bg-foreground"
            style={{ width: `${total ? Math.round((feitos * 100) / total) : 0}%` }}
          />
        </div>
        <p className="text-[13px] text-muted-foreground">
          {feitos} de {total} {total === 1 ? 'avanço' : 'avanços'}
        </p>
      </div>
      {aberto ? (
        <>
          {r.estrategias.map((s) => (
            <div key={s.id} className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                  Estratégia · aposta em teste
                </p>
                <p className="break-words text-base font-medium leading-snug text-foreground">{s.titulo}</p>
              </div>
              {(s.avancos ?? []).length > 0 && <ListaDeAvancos itens={s.avancos ?? []} />}
            </div>
          ))}
          {soltos.length > 0 && (
            <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-3">
              <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">
                Avanços sem estratégia
              </p>
              <ListaDeAvancos itens={soltos} />
            </div>
          )}
          {r.estrategias.length === 0 && soltos.length === 0 && (
            <p className="text-sm text-muted-foreground">Ainda sem estratégia nem avanços abertos.</p>
          )}
        </>
      ) : null}
      <button
        type="button"
        aria-expanded={aberto}
        onClick={onAlternar}
        className="h-11 self-start rounded-full border border-muted-foreground px-3.5 text-sm font-medium text-foreground"
      >
        {aberto ? 'Recolher' : 'Ver estratégia e avanços'}
      </button>
    </li>
  )
}

export function MapPage() {
  const { contextFilter } = useGlobalFilter()
  const [mapa, setMapa] = useState<Mapa | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [modo, setModo] = useState<'construir' | 'sustentar'>('construir')
  const [abertos, setAbertos] = useState<Record<string, boolean>>({})

  const carregar = useCallback(async () => {
    try {
      const res = await op<Mapa>('ver_mapa', {})
      setMapa(res.resultado ?? null)
      setErro(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o mapa.')
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])
  usePegadaMudou(carregar)

  const grupos = useMemo(() => {
    if (!mapa) return []
    const noContexto = (c: string) => contextFilter === 'todos' || c === contextFilter
    const resultados = mapa.resultados
      .filter((r) => noContexto(r.contexto))
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))
    const out: { id: string; titulo: string; detalhe?: string; resultados: MapaResultado[] }[] =
      mapa.responsabilidades
        .filter((r) => noContexto(r.contexto))
        .map((resp) => ({
          id: resp.id,
          titulo: resp.titulo,
          detalhe: resp.contexto === 'vida' ? 'Vida' : 'Trabalho',
          resultados: resultados.filter((r) => r.responsabilidade_id === resp.id),
        }))
    const conhecidas = new Set(mapa.responsabilidades.map((r) => r.id))
    const soltos = resultados.filter(
      (r) => !r.responsabilidade_id || !conhecidas.has(r.responsabilidade_id),
    )
    if (soltos.length > 0) {
      out.push({ id: 'sem-responsabilidade', titulo: 'Sem responsabilidade', resultados: soltos })
    }
    return out
  }, [mapa, contextFilter])

  // Construir: os resultados em trilha, ativos primeiro.
  const trilha = useMemo(() => {
    if (!mapa) return []
    return mapa.resultados
      .filter((r) => contextFilter === 'todos' || r.contexto === contextFilter)
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))
  }, [mapa, contextFilter])

  const semForma = useMemo(
    () => new Set((mapa?.resultados_sem_forma_minima ?? []).map((r) => r.id)),
    [mapa],
  )
  const ativos = mapa?.resultados.filter((r) => r.status === 'ativo').length ?? 0

  if (erro) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{erro}</span>
        </div>
      </div>
    )
  }

  if (!mapa) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Carregando o mapa" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[32px] font-semibold leading-tight tracking-tight text-foreground">
          Mapa
        </h1>
        <div className="flex rounded-full bg-secondary p-1" role="group" aria-label="Visão do mapa">
          {(['construir', 'sustentar'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={modo === m}
              onClick={() => setModo(m)}
              className={cn(
                'h-9 rounded-full px-3.5 text-sm font-medium capitalize',
                modo === m ? 'bg-foreground text-background' : 'text-foreground',
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {modo === 'construir'
          ? `Do seu porquê até cada resultado. ${ativos} de ${mapa.limite_resultados_ativos} resultados ativos.`
          : 'O que você escolheu sustentar, e os resultados de cada responsabilidade.'}
      </p>

      <section
        aria-label="Propósito"
        className="mt-6 rounded-[20px] p-5"
        style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}
      >
        <p
          className="text-xs font-normal uppercase tracking-[0.08em]"
          style={{ color: 'var(--pegada-on-ink-muted)' }}
        >
          Propósito
        </p>
        {mapa.proposito ? (
          <p className="mt-2 text-[17px] font-semibold leading-snug">{mapa.proposito}</p>
        ) : (
          <Link
            to="/configuracoes"
            className="mt-2 block text-[17px] font-semibold underline underline-offset-4"
          >
            Escreva o seu propósito
          </Link>
        )}
      </section>

      {(mapa.avancos_sem_fio > 0 || mapa.resultados_sem_forma_minima.length > 0) && (
        <div className="mt-4 rounded-2xl border border-border bg-card p-4 text-sm text-foreground">
          {mapa.avancos_sem_fio > 0 && (
            <Link to="/avancos" className="block underline-offset-4 hover:underline">
              {mapa.avancos_sem_fio}{' '}
              {mapa.avancos_sem_fio === 1 ? 'avanço ainda sem porquê' : 'avanços ainda sem porquê'}:
              ligue a um resultado.
            </Link>
          )}
          {mapa.resultados_sem_forma_minima.length > 0 && (
            <p className={cn(mapa.avancos_sem_fio > 0 && 'mt-1')}>
              {mapa.resultados_sem_forma_minima.length}{' '}
              {mapa.resultados_sem_forma_minima.length === 1
                ? 'resultado ativo sem prazo'
                : 'resultados ativos sem prazo'}{' '}
              (marcados abaixo).
            </p>
          )}
        </div>
      )}

      {modo === 'construir' && (
        <ul className="mt-4 flex flex-col pl-3.5">
          {trilha.length === 0 && (
            <li className="text-[15px] text-muted-foreground">
              Nenhum resultado neste contexto.{' '}
              <Link to="/resultados" className="text-foreground underline underline-offset-4">
                Criar um resultado
              </Link>
            </li>
          )}
          {trilha.map((r, i) => (
            <ResultadoNo
              key={r.id}
              r={r}
              semForma={semForma.has(r.id)}
              aberto={abertos[r.id] ?? i === 0}
              onAlternar={() => setAbertos((v) => ({ ...v, [r.id]: !(v[r.id] ?? i === 0) }))}
            />
          ))}
        </ul>
      )}

      <div
        className={cn(
          'relative mt-6 space-y-6 border-l-2 border-[var(--pegada-line)] pl-5',
          modo !== 'sustentar' && 'hidden',
        )}
      >
        {grupos.length === 0 && (
          <p className="text-[15px] text-muted-foreground">
            Nenhuma responsabilidade neste contexto.{' '}
            <Link to="/responsabilidades" className="text-foreground underline underline-offset-4">
              Criar uma responsabilidade
            </Link>
          </p>
        )}
        {grupos.map((g) => (
          <section key={g.id} aria-labelledby={`mapa-${g.id}`}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 id={`mapa-${g.id}`} className="text-[17px] font-semibold text-foreground">
                {g.id === 'sem-responsabilidade' ? (
                  g.titulo
                ) : (
                  <Link
                    to={`/responsabilidades?id=${g.id}`}
                    className="hover:underline underline-offset-4"
                  >
                    {g.titulo}
                  </Link>
                )}
              </h2>
              {g.detalhe && <span className="text-[13px] text-muted-foreground">{g.detalhe}</span>}
            </div>
            {g.resultados.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">Nenhum resultado em andamento.</p>
            ) : (
              <ul className="mt-2 rounded-[20px] border border-border bg-card p-1">
                {g.resultados.map((r) => (
                  <ResultadoItem key={r.id} r={r} semForma={semForma.has(r.id)} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}

export default MapPage

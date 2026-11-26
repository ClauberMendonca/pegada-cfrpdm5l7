// PEGADA — o Mapa: a escada inteira em uma lista que abre e fecha.
// Do Propósito saem as Vontades (o que a pessoa quer, e ninguém cobra) e as
// Responsabilidades (o que ela responde por, e alguém cobra). De cada uma
// nascem resultados, estratégias e avanços. O que não nasce de nenhuma fica
// em "Livres", e também vale.
// Cada coisa aparece em um lugar só, e é aqui que se cria o que já tem lugar.
// Fonte única: a operação ver_mapa (os agentes leem o mesmo pelo MCP).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { op } from '@/lib/pegada/api'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { fichaDaResponsabilidade, fichaDaVontade, fichaDoAvanco, fichaDoResultado } from '@/lib/pegada/enderecos'
import { useGlobalFilter } from '@/contexts/FilterContext'
import { actionService, notificarMudanca } from '@/services/actionService'
import { projectService } from '@/services/projectService'
import { responsibilityService } from '@/services/responsibilityService'
import { wishService } from '@/services/wishService'
import { AdicionarNoLugar } from '@/components/mapa/AdicionarNoLugar'
import { ArvoreHorizontal, type NoDaArvore } from '@/components/mapa/ArvoreHorizontal'
import { Desdobrar } from '@/components/Desdobrar'
import { Dica } from '@/components/Dica'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface MapaAvanco {
  id: string
  titulo: string
  tipo: string
  status?: string
  contexto?: string
  hoje?: boolean
  principal?: boolean
  rotina?: boolean
  prazo?: string
}
interface MapaEstrategia {
  id: string
  titulo: string
  sinal_de_teste: string
  avancos?: MapaAvanco[]
}
export interface MapaResultado {
  id: string
  titulo: string
  prazo: string
  status: string
  contexto: string
  responsabilidade_id: string | null
  vontade_id?: string | null
  estrategias: MapaEstrategia[]
  avancos_abertos: number
  avancos_sem_estrategia?: MapaAvanco[]
}
interface MapaResponsabilidade {
  id: string
  titulo: string
  contexto: string
  avancos?: MapaAvanco[]
}
interface MapaVontade {
  id: string
  titulo: string
  contexto: string
}
export interface Mapa {
  proposito: string
  vontades?: MapaVontade[]
  responsabilidades: MapaResponsabilidade[]
  resultados: MapaResultado[]
  avancos_livres?: MapaAvanco[]
  limite_resultados_ativos: number
}

// O Mapa lembra, neste aparelho, o que a pessoa deixou aberto.
const CHAVE = 'pegada.mapa.abertos'
function lerAbertos(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(CHAVE) || '{}') as Record<string, boolean>
  } catch {
    return {}
  }
}

// A vista em árvore só existe no computador; a escolha fica neste aparelho.
const CHAVE_VISTA = 'pegada.mapa.vista'
function useTelaLarga(): boolean {
  const [larga, setLarga] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(min-width: 1024px)')
    const ouvir = () => setLarga(m.matches)
    m.addEventListener('change', ouvir)
    return () => m.removeEventListener('change', ouvir)
  }, [])
  return larga
}

const DEPOIS = new Set(['futuro', 'rascunho'])
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

function formatarPrazo(prazo?: string): string {
  if (!prazo) return ''
  const d = new Date(prazo.slice(0, 10) + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

interface Ctx {
  aberto: (id: string, padrao: boolean) => boolean
  alternar: (id: string, padrao: boolean) => void
  aqui: string
  concluir: (a: MapaAvanco) => void
  paraHoje: (a: MapaAvanco) => void
  concluindo: string | null
}

/** Botão que abre e fecha um degrau. Área de toque de 44 px. */
function Alternar({ id, padrao, nome, c }: { id: string; padrao: boolean; nome: string; c: Ctx }) {
  const aberto = c.aberto(id, padrao)
  return (
    <button
      type="button"
      aria-expanded={aberto}
      aria-label={`${aberto ? 'Recolher' : 'Abrir'} ${nome}`}
      onClick={() => c.alternar(id, padrao)}
      className={cn(
        '-ml-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground',
        FOCO,
      )}
    >
      {aberto ? (
        <ChevronDown className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      )}
    </button>
  )
}

/** O título de um item, que leva à ficha dele. */
function Titulo({
  to,
  children,
  detalhe,
  c,
  forte,
}: {
  to: string
  children: React.ReactNode
  detalhe?: React.ReactNode
  c: Ctx
  forte?: boolean
}) {
  const aqui = c.aqui === to
  return (
    <Link
      to={to}
      aria-current={aqui ? 'page' : undefined}
      className={cn(
        'flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-xl px-2 py-1.5 transition-colors hover:bg-secondary',
        aqui && 'bg-secondary',
        FOCO,
      )}
    >
      <span
        className={cn(
          'break-words leading-snug text-foreground',
          forte ? 'text-[17px] font-semibold' : 'text-base font-medium',
        )}
      >
        {children}
      </span>
      {detalhe && <span className="text-[13px] text-muted-foreground">{detalhe}</span>}
    </Link>
  )
}

function Avancos({ itens, c }: { itens: MapaAvanco[]; c: Ctx }) {
  if (itens.length === 0) return null
  return (
    <ul className="flex flex-col">
      {itens.map((a) => {
        const espera = a.status === 'aguardando' || a.status === 'bloqueada'
        const prazo = formatarPrazo(a.prazo)
        const detalhe = [a.rotina && 'rotina', espera && 'esperando', prazo && `até ${prazo}`]
          .filter(Boolean)
          .join(' · ')
        return (
          <li key={a.id} className="flex items-center gap-1" data-avanco={a.id}>
            <button
              type="button"
              disabled={c.concluindo !== null}
              aria-label={`Concluir: ${a.titulo}`}
              onClick={() => c.concluir(a)}
              className={cn('-ml-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-full', FOCO)}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-muted-foreground text-transparent hover:text-muted-foreground">
                {c.concluindo === a.id ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" aria-hidden="true" />
                ) : (
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                )}
              </span>
            </button>
            <Titulo to={fichaDoAvanco(a.id)} detalhe={detalhe || undefined} c={c}>
              <span className="text-[15px] font-normal">{a.titulo}</span>
            </Titulo>
            {!espera && (
              <button
                type="button"
                aria-pressed={Boolean(a.hoje)}
                aria-label={`${a.hoje ? 'Tirar de Hoje' : 'Fazer hoje'}: ${a.titulo}`}
                title={a.principal ? 'Avanço principal de hoje' : a.hoje ? 'Está em Hoje. Toque para tirar' : 'Fazer hoje'}
                disabled={c.concluindo !== null}
                onClick={() => c.paraHoje(a)}
                data-hoje={a.hoje ? 'sim' : 'nao'}
                className={cn('flex h-11 w-9 shrink-0 items-center justify-center rounded-full hover:bg-secondary', FOCO)}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    a.hoje ? 'bg-primary' : 'border-2 border-input',
                  )}
                />
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function Resultado({ r, c }: { r: MapaResultado; c: Ctx }) {
  const ativo = r.status === 'ativo'
  const id = `resultado:${r.id}`
  const aberto = c.aberto(id, ativo)
  const prazo = formatarPrazo(r.prazo)
  const soltos = r.avancos_sem_estrategia ?? []
  const detalhe = [
    'Resultado',
    r.status === 'pausado' && 'pausado',
    prazo && `até ${prazo}`,
  ]
    .filter(Boolean)
    .join(' · ')
  // Convites discretos, no lugar de um painel de cobrança.
  const convite = !ativo
    ? ''
    : !r.prazo
      ? 'Sem prazo. Abra para marcar a data.'
      : r.avancos_abertos === 0
        ? 'Sem avanço aberto. Qual é o próximo passo?'
        : ''
  return (
    <li data-resultado={r.id}>
      <div className="flex items-start gap-1">
        <Alternar id={id} padrao={ativo} nome={r.titulo} c={c} />
        <Titulo to={fichaDoResultado(r.id)} detalhe={detalhe} c={c}>
          {r.titulo}
        </Titulo>
      </div>
      {aberto && (
        <div className="ml-2.5 flex flex-col gap-1 border-l-2 border-border pl-4">
          {convite && <p className="px-2 py-1 text-[13px] text-muted-foreground">{convite}</p>}
          {r.estrategias.map((s) => {
            const sid = `estrategia:${s.id}`
            return (
              <div key={s.id} data-estrategia={s.id}>
                <div className="flex items-start gap-1">
                  <Alternar id={sid} padrao nome={s.titulo} c={c} />
                  <Titulo to={`${fichaDoResultado(r.id)}#estrategia-${s.id}`} detalhe="Estratégia" c={c}>
                    {s.titulo}
                  </Titulo>
                </div>
                {c.aberto(sid, true) && (
                  <div className="ml-2.5 flex flex-col border-l-2 border-border pl-4">
                    <Avancos itens={s.avancos ?? []} c={c} />
                    <AdicionarNoLugar
                      tipos={['avanco']}
                      onde={{ resultadoId: r.id, estrategiaId: s.id }}
                      contexto={r.contexto === 'vida' ? 'vida' : 'trabalho'}
                      em={s.titulo}
                    />
                  </div>
                )}
              </div>
            )
          })}
          <Avancos itens={soltos} c={c} />
          <AdicionarNoLugar
            tipos={['avanco', 'estrategia']}
            onde={{ resultadoId: r.id }}
            contexto={r.contexto === 'vida' ? 'vida' : 'trabalho'}
            em={r.titulo}
          />
        </div>
      )}
    </li>
  )
}

/** Os resultados de um degrau: os de agora à vista, os de depois recolhidos. */
function Resultados({ itens, grupo, c }: { itens: MapaResultado[]; grupo: string; c: Ctx }) {
  const agora = itens.filter((r) => !DEPOIS.has(r.status))
  const depois = itens.filter((r) => DEPOIS.has(r.status))
  const id = `depois:${grupo}`
  return (
    <>
      {agora.length > 0 && (
        <ul className="flex flex-col gap-1">
          {agora.map((r) => (
            <Resultado key={r.id} r={r} c={c} />
          ))}
        </ul>
      )}
      {depois.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={c.aberto(id, false)}
            onClick={() => c.alternar(id, false)}
            className={cn(
              '-ml-2 flex h-11 items-center gap-1 rounded-full pl-2.5 pr-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
              FOCO,
            )}
          >
            {c.aberto(id, false) ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
            Depois · {depois.length}
          </button>
          {c.aberto(id, false) && (
            <ul className="flex flex-col gap-1">
              {depois.map((r) => (
                <Resultado key={r.id} r={r} c={c} />
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  )
}

function Ramo({
  id,
  nome,
  explicacao,
  c,
  children,
}: {
  id: string
  nome: string
  explicacao: string
  c: Ctx
  children: React.ReactNode
}) {
  const aberto = c.aberto(id, true)
  return (
    <section aria-labelledby={`ramo-${id}`} data-ramo={id}>
      <div className="flex items-center gap-1">
        <Alternar id={id} padrao nome={nome} c={c} />
        <div className="min-w-0 px-2">
          <h2 id={`ramo-${id}`} className="text-xs font-medium uppercase tracking-[0.08em] text-foreground">
            {nome}
          </h2>
          <p className="text-[13px] text-muted-foreground">{explicacao}</p>
        </div>
      </div>
      {aberto && <div className="ml-2.5 mt-1 flex flex-col gap-1 border-l-2 border-border pl-4">{children}</div>}
    </section>
  )
}

interface Encerrado {
  id: string
  titulo: string
  to: string
  detalhe: string
}

/** O que já foi concluído ou arquivado: só aparece quando a pessoa pede. */
function Encerrados({ c }: { c: Ctx }) {
  const { contextFilter } = useGlobalFilter()
  const [itens, setItens] = useState<Encerrado[] | null>(null)
  const aberto = c.aberto('encerrados', false)

  const carregar = useCallback(async () => {
    const contexto = contextFilter === 'todos' ? undefined : contextFilter
    const [concluidos, arquivados, resps, vontades] = await Promise.all([
      projectService.list(contexto, 'concluido').catch(() => []),
      projectService.list(contexto, 'arquivado').catch(() => []),
      responsibilityService.list({ context: contexto }).catch(() => []),
      wishService.list().catch(() => []),
    ])
    setItens([
      ...concluidos.map((p) => ({
        id: p.id,
        titulo: p.title,
        to: fichaDoResultado(p.id),
        detalhe: 'Resultado · concluído',
      })),
      ...arquivados.map((p) => ({
        id: p.id,
        titulo: p.title,
        to: fichaDoResultado(p.id),
        detalhe: 'Resultado · arquivado',
      })),
      ...vontades
        .filter((v) => v.status === 'arquivada' && (!contexto || v.context === contexto))
        .map((v) => ({
          id: v.id,
          titulo: v.title,
          to: fichaDaVontade(v.id),
          detalhe: 'Vontade · arquivada',
        })),
      ...resps
        .filter((r) => r.status === 'arquivada')
        .map((r) => ({
          id: r.id,
          titulo: r.title,
          to: fichaDaResponsabilidade(r.id),
          detalhe: 'Responsabilidade · arquivada',
        })),
    ])
  }, [contextFilter])

  useEffect(() => {
    if (aberto) void carregar()
  }, [aberto, carregar])
  usePegadaMudou(() => {
    if (aberto) void carregar()
  })

  return (
    <section data-ramo="encerrados">
      <button
        type="button"
        aria-expanded={aberto}
        onClick={() => c.alternar('encerrados', false)}
        className={cn(
          '-ml-2 flex h-11 items-center gap-1 rounded-full pl-2.5 pr-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground',
          FOCO,
        )}
      >
        {aberto ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        Encerrados
      </button>
      {aberto && (
        <div className="ml-2.5 border-l-2 border-border pl-4">
          {itens === null ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Carregando…</p>
          ) : itens.length === 0 ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">
              Nada concluído nem arquivado ainda. O que você encerrar fica guardado aqui.
            </p>
          ) : (
            <ul className="flex flex-col">
              {itens.map((i) => (
                <li key={i.to} className="flex">
                  <Titulo to={i.to} detalhe={i.detalhe} c={c}>
                    <span className="text-[15px] font-normal text-muted-foreground">{i.titulo}</span>
                  </Titulo>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export function ArvoreDoMapa({ compacta = false }: { compacta?: boolean }) {
  const { contextFilter } = useGlobalFilter()
  const { pathname, hash } = useLocation()
  const navigate = useNavigate()
  const [mapa, setMapa] = useState<Mapa | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [abertos, setAbertos] = useState<Record<string, boolean>>(lerAbertos)
  const [concluindo, setConcluindo] = useState<string | null>(null)
  const telaLarga = useTelaLarga()
  const [vista, setVista] = useState<'lista' | 'arvore'>(() => {
    try {
      return localStorage.getItem(CHAVE_VISTA) === 'arvore' ? 'arvore' : 'lista'
    } catch {
      return 'lista'
    }
  })
  const emArvore = !compacta && telaLarga && vista === 'arvore'
  const trocarVista = (v: 'lista' | 'arvore') => {
    setVista(v)
    try {
      localStorage.setItem(CHAVE_VISTA, v)
    } catch {
      // Sem armazenamento, o Mapa só não lembra a vista.
    }
  }

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
    void carregar()
  }, [carregar])
  usePegadaMudou(carregar)

  const c: Ctx = useMemo(
    () => ({
      aqui: pathname + hash,
      concluindo,
      aberto: (id, padrao) => abertos[id] ?? padrao,
      alternar: (id, padrao) =>
        setAbertos((v) => {
          const novo = { ...v, [id]: !(v[id] ?? padrao) }
          try {
            localStorage.setItem(CHAVE, JSON.stringify(novo))
          } catch {
            // Sem armazenamento, o Mapa só não lembra o que ficou aberto.
          }
          return novo
        }),
      concluir: (a) => {
        setConcluindo(a.id)
        actionService
          .updateStatus(a.id, 'feita')
          .then(() => notificarMudanca())
          .catch((e: unknown) => {
            toast.error(e instanceof Error ? e.message : 'Não foi possível concluir.')
            // Quando a regra pede mais do que um toque, a ficha resolve.
            navigate(fichaDoAvanco(a.id))
          })
          .finally(() => setConcluindo(null))
      },
      paraHoje: (a) => {
        setConcluindo(a.id)
        actionService
          .setTodaySelected(a.id, !a.hoje)
          .then(() => notificarMudanca())
          .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Não foi possível gravar.'))
          .finally(() => setConcluindo(null))
      },
    }),
    [abertos, concluindo, pathname, hash, navigate],
  )

  const visao = useMemo(() => {
    if (!mapa) return null
    const noContexto = (ctx?: string) => contextFilter === 'todos' || !ctx || ctx === contextFilter
    const ordem: Record<string, number> = { ativo: 0, pausado: 1, rascunho: 2, futuro: 3 }
    const resultados = mapa.resultados
      .filter((r) => noContexto(r.contexto))
      .sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9))
    const responsabilidades = new Set(mapa.responsabilidades.map((r) => r.id))
    const vontades = new Set((mapa.vontades ?? []).map((v) => v.id))
    // Cada resultado mora em um lugar só: na vontade, na responsabilidade ou em Livres.
    const daVontade = (r: MapaResultado) => Boolean(r.vontade_id && vontades.has(r.vontade_id))
    const daResponsabilidade = (r: MapaResultado) =>
      !daVontade(r) && Boolean(r.responsabilidade_id && responsabilidades.has(r.responsabilidade_id))
    return {
      vontades: (mapa.vontades ?? [])
        .filter((v) => noContexto(v.contexto))
        .map((v) => ({ ...v, resultados: resultados.filter((r) => daVontade(r) && r.vontade_id === v.id) })),
      responsabilidades: mapa.responsabilidades
        .filter((r) => noContexto(r.contexto))
        .map((resp) => ({
          ...resp,
          resultados: resultados.filter((r) => daResponsabilidade(r) && r.responsabilidade_id === resp.id),
        })),
      resultadosLivres: resultados.filter((r) => !daVontade(r) && !daResponsabilidade(r)),
      livres: (mapa.avancos_livres ?? []).filter((a) => noContexto(a.contexto)),
      ativos: mapa.resultados.filter((r) => r.status === 'ativo').length,
    }
  }, [mapa, contextFilter])

  if (erro) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-sm text-foreground">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <p>{erro}</p>
          <button type="button" onClick={() => void carregar()} className="mt-2 font-medium underline underline-offset-4">
            Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  if (!mapa || !visao) {
    return (
      <div className="flex justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Carregando o mapa" />
      </div>
    )
  }

  const contexto = contextFilter === 'todos' ? undefined : contextFilter
  const propositoAqui = pathname === '/mapa/proposito'

  // A árvore horizontal usa os mesmos dados e as mesmas chaves da lista.
  const noAvanco = (a: MapaAvanco): NoDaArvore => ({
    id: `avanco:${a.id}`,
    rotulo: 'Avanço',
    titulo: a.titulo,
    to: fichaDoAvanco(a.id),
    tom: 'folha',
    hoje: Boolean(a.hoje),
  })
  const noResultado = (r: MapaResultado): NoDaArvore => ({
    id: `resultado:${r.id}`,
    rotulo: ['Resultado', r.status === 'pausado' && 'pausado', formatarPrazo(r.prazo) && `até ${formatarPrazo(r.prazo)}`]
      .filter(Boolean)
      .join(' · '),
    titulo: r.titulo,
    to: fichaDoResultado(r.id),
    padrao: r.status === 'ativo',
    filhos: [
      ...r.estrategias.map((s) => ({
        id: `estrategia:${s.id}`,
        rotulo: 'Estratégia',
        titulo: s.titulo,
        to: `${fichaDoResultado(r.id)}#estrategia-${s.id}`,
        filhos: (s.avancos ?? []).map(noAvanco),
      })),
      ...(r.avancos_sem_estrategia ?? []).map(noAvanco),
    ],
  })
  const agora = (rs: MapaResultado[]) => rs.filter((r) => !DEPOIS.has(r.status)).map(noResultado)
  const raiz: NoDaArvore = {
    id: 'raiz',
    rotulo: 'Propósito',
    titulo: mapa.proposito || 'Escreva o seu propósito',
    to: '/mapa/proposito',
    tom: 'proposito',
    filhos: [
      {
        id: 'vontades',
        rotulo: 'Se largar, ninguém cobra',
        titulo: 'Vontades',
        tom: 'ramo',
        filhos: visao.vontades.map((v) => ({
          id: `vontade:${v.id}`,
          rotulo: 'Vontade',
          titulo: v.titulo,
          to: fichaDaVontade(v.id),
          tom: 'forte' as const,
          filhos: agora(v.resultados),
        })),
      },
      {
        id: 'responsabilidades',
        rotulo: 'Se largar, alguém cobra',
        titulo: 'Responsabilidades',
        tom: 'ramo',
        filhos: visao.responsabilidades.map((resp) => ({
          id: `responsabilidade:${resp.id}`,
          rotulo: 'Responsabilidade',
          titulo: resp.titulo,
          to: fichaDaResponsabilidade(resp.id),
          tom: 'forte' as const,
          filhos: [...agora(resp.resultados), ...(resp.avancos ?? []).map(noAvanco)],
        })),
      },
      {
        id: 'livres',
        rotulo: 'Também vale',
        titulo: 'Livres',
        tom: 'ramo',
        filhos: [...agora(visao.resultadosLivres), ...visao.livres.map(noAvanco)],
      },
    ],
  }

  return (
    <div data-mapa className={cn('flex flex-col gap-5', !compacta && !emArvore && 'mx-auto max-w-3xl')}>
      <div className={cn(!compacta && 'flex items-start justify-between gap-4')}>
        <div>
        <h1
          className={cn(
            'font-semibold leading-tight tracking-tight text-foreground',
            compacta ? 'text-xl' : 'text-[32px]',
          )}
        >
          {compacta ? <Link to="/mapa">Mapa</Link> : 'Mapa'}
        </h1>
        {!compacta && (
          <p className="mt-1 text-[15px] text-muted-foreground">
            Do seu porquê até o próximo passo. {visao.ativos} de {mapa.limite_resultados_ativos} resultados
            ativos.
          </p>
        )}
        </div>
        {!compacta && telaLarga && (
          <div role="group" aria-label="Vista do Mapa" className="flex shrink-0 rounded-full bg-secondary p-1" data-vista-do-mapa>
            {(['lista', 'arvore'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vista === v}
                onClick={() => trocarVista(v)}
                className={cn(
                  'min-h-9 rounded-full px-4 text-sm font-medium transition-colors',
                  FOCO,
                  vista === v ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {v === 'lista' ? 'Lista' : 'Árvore'}
              </button>
            ))}
          </div>
        )}
      </div>

      {emArvore ? (
        <>
          <ArvoreHorizontal raiz={raiz} aberto={c.aberto} alternar={c.alternar} />
          <p className="text-[13px] text-muted-foreground">
            A árvore mostra o que está em andamento. Para adicionar, concluir ou ver o que ficou para depois, use a
            vista em lista ou abra a ficha do item.
          </p>
        </>
      ) : (
        <>
      {!compacta && (
        <Dica id="mapa-escada">
          O mapa é uma escada: perguntar “para quê?” sobe um degrau, e perguntar “como?” desce um.
        </Dica>
      )}
      {!compacta && (
        <Dica id="mapa-hoje">
          O ponto ao lado de cada avanço escolhe o dia: toque nele para fazer hoje. Laranja quer dizer que já
          está em Hoje.
        </Dica>
      )}

      <Link
        to="/mapa/proposito"
        aria-current={propositoAqui ? 'page' : undefined}
        aria-label={mapa.proposito ? `Propósito: ${mapa.proposito}. Abrir para editar` : 'Escrever o seu propósito'}
        className={cn(
          'block rounded-[20px] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          compacta ? 'p-4' : 'p-5',
        )}
        style={{ background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' }}
      >
        <p className="text-xs font-normal uppercase tracking-[0.08em]" style={{ color: 'var(--pegada-on-ink-muted)' }}>
          Propósito
        </p>
        {mapa.proposito ? (
          <p className={cn('mt-2 font-semibold leading-snug', compacta ? 'line-clamp-3 text-[15px]' : 'text-[17px]')}>
            {mapa.proposito}
          </p>
        ) : (
          <p className="mt-2 text-[17px] font-semibold underline underline-offset-4">Escreva o seu propósito</p>
        )}
      </Link>

      <Ramo id="vontades" nome="Vontades" explicacao="O que você quer construir. Se largar, ninguém cobra." c={c}>
        {visao.vontades.length === 0 && (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            Nenhuma vontade aqui ainda. É algo que você quer porque quer, como “voltar a tocar violão”.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {visao.vontades.map((v) => {
            const id = `vontade:${v.id}`
            return (
              <li key={v.id} data-vontade={v.id}>
                <div className="flex items-start gap-1">
                  <Alternar id={id} padrao nome={v.titulo} c={c} />
                  <Titulo
                    to={fichaDaVontade(v.id)}
                    detalhe={`Vontade · ${v.contexto === 'vida' ? 'Vida' : 'Trabalho'}`}
                    forte
                    c={c}
                  >
                    {v.titulo}
                  </Titulo>
                </div>
                {c.aberto(id, true) && (
                  <div className="ml-2.5 flex flex-col gap-1 border-l-2 border-border pl-4">
                    <Resultados itens={v.resultados} grupo={v.id} c={c} />
                    <AdicionarNoLugar
                      tipos={['resultado']}
                      onde={{ vontadeId: v.id }}
                      contexto={v.contexto === 'vida' ? 'vida' : 'trabalho'}
                      em={v.titulo}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <AdicionarNoLugar tipos={['vontade']} contexto={contexto} em="Vontades" />
      </Ramo>

      <Ramo
        id="responsabilidades"
        nome="Responsabilidades"
        explicacao="O que você responde por. Se largar, alguém cobra."
        c={c}
      >
        {visao.responsabilidades.length === 0 && (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            Nenhuma responsabilidade aqui ainda. É algo pelo qual você responde hoje, como “saúde da família”.
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {visao.responsabilidades.map((resp) => {
            const id = `responsabilidade:${resp.id}`
            return (
              <li key={resp.id} data-responsabilidade={resp.id}>
                <div className="flex items-start gap-1">
                  <Alternar id={id} padrao nome={resp.titulo} c={c} />
                  <Titulo
                    to={fichaDaResponsabilidade(resp.id)}
                    detalhe={`Responsabilidade · ${resp.contexto === 'vida' ? 'Vida' : 'Trabalho'}`}
                    forte
                    c={c}
                  >
                    {resp.titulo}
                  </Titulo>
                </div>
                {c.aberto(id, true) && (
                  <div className="ml-2.5 flex flex-col gap-1 border-l-2 border-border pl-4">
                    <Resultados itens={resp.resultados} grupo={resp.id} c={c} />
                    <Avancos itens={resp.avancos ?? []} c={c} />
                    <AdicionarNoLugar
                      tipos={['resultado', 'avanco']}
                      onde={{ responsabilidadeId: resp.id }}
                      contexto={resp.contexto === 'vida' ? 'vida' : 'trabalho'}
                      em={resp.titulo}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <AdicionarNoLugar tipos={['responsabilidade']} contexto={contexto} em="Responsabilidades" />
        {!compacta && (
          <Desdobrar
            nivel="papel"
            rotulo="Partir de um papel que você vive"
            pergunta="Que papel você vive? Conte do seu jeito."
            exemplo="Sou pai de uma filha de 9 anos e outra de 16."
            onCriar={async (s) => {
              await op('criar_responsabilidade', {
                titulo: s.titulo,
                contexto: s.contexto === 'trabalho' ? 'trabalho' : 'vida',
              })
            }}
            onCriados={() => notificarMudanca()}
          />
        )}
      </Ramo>

      <Ramo
        id="livres"
        nome="Livres"
        explicacao="O que não nasce de uma vontade nem de uma responsabilidade. Também vale."
        c={c}
      >
        <Resultados itens={visao.resultadosLivres} grupo="livres" c={c} />
        <Avancos itens={visao.livres} c={c} />
        <AdicionarNoLugar tipos={['avanco', 'resultado']} contexto={contexto} em="Livres" />
      </Ramo>

      <Encerrados c={c} />
        </>
      )}
    </div>
  )
}

export default ArvoreDoMapa

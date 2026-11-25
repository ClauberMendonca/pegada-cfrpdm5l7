import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { op } from '@/lib/pegada/api'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { actionService, notificarMudanca } from '@/services/actionService'
import { timeService } from '@/services/timeService'
import { fioCurto } from '@/lib/pegada/fioCurto'
import { useGlobalFilter } from '@/contexts/FilterContext'

// PEGADA — o Avanço principal do dia, com a frase do fio.
// Fonte: a operação ver_fio_de_hoje (a mesmo que o MCP lê).
// Laranja só no botão Concluir: é a ação principal da tela Hoje.

interface AvancoHoje {
  id: string
  titulo: string
  tipo: string
  tipo_nome: string
  contexto: string
  fio: {
    frase: string
    sem_fio?: boolean
    resultado?: { id: string; titulo: string } | null
    responsabilidade?: { id: string; titulo: string } | null
  }
}
interface FioDeHoje {
  proposito?: string
  principal: AvancoHoje | null
  compromissos: AvancoHoje[]
  vencendo: AvancoHoje[]
  para_hoje: AvancoHoje[]
  capturas_pendentes: number
  propostas_pendentes: number
}

const INK = { background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' } as const
const ATALHO =
  'flex min-h-[52px] min-w-[150px] flex-1 items-center gap-2.5 rounded-2xl bg-secondary px-3.5 py-2 text-left text-sm leading-tight text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const MUTED = { color: 'var(--pegada-on-ink-muted)' } as const

interface Props {
  /** Conteúdo entre o cartão e os atalhos (a lista "Também hoje"). */
  children?: React.ReactNode
  /** Quantos avanços e resultados pedem reavaliação; 0 esconde o atalho. */
  reavaliar?: number
  onReavaliar?: () => void
}

export function AvancoPrincipalCard({ children, reavaliar = 0, onReavaliar }: Props) {
  const { contextFilter } = useGlobalFilter()
  const [dados, setDados] = useState<FioDeHoje | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const carregar = useCallback(async () => {
    try {
      const res = await op<FioDeHoje>('ver_fio_de_hoje', {})
      setDados(res.resultado ?? null)
    } catch {
      setDados(null)
    }
  }, [])

  useEffect(() => {
    carregar()
  }, [carregar])
  usePegadaMudou(carregar)

  const executar = async (acao: () => Promise<unknown>) => {
    if (ocupado) return
    setOcupado(true)
    try {
      await acao()
      notificarMudanca()
      await carregar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gravar.')
    } finally {
      setOcupado(false)
    }
  }

  if (!dados) return null

  const noContexto = (a: AvancoHoje) => contextFilter === 'todos' || a.contexto === contextFilter
  const principal = dados.principal && noContexto(dados.principal) ? dados.principal : null
  const candidatos = [...dados.compromissos, ...dados.vencendo, ...dados.para_hoje]
    .filter(noContexto)
    .slice(0, 5)

  return (
    <section aria-label="Avanço principal" className="space-y-3">
      <div className="rounded-[20px] p-5 sm:p-6" style={INK}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-[0.08em]" style={MUTED}>
            Avanço principal
          </p>
          {principal && (
            <p className="text-[13px]" style={MUTED}>
              {principal.tipo_nome}
            </p>
          )}
        </div>

        {principal ? (
          <>
            <h2 className="mt-2 text-2xl font-semibold leading-tight">{principal.titulo}</h2>
            <p className="mt-3 text-[15px] leading-relaxed" style={MUTED}>
              {fioCurto(principal.fio, dados.proposito) || 'Avanço livre: ainda sem porquê.'}
            </p>
            <div className="mt-5 flex items-center gap-2.5">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => executar(() => actionService.updateStatus(principal.id, 'feita'))}
                className="flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full bg-primary px-6 text-[17px] font-semibold text-primary-foreground transition-colors duration-200 hover:bg-[var(--ginga-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pegada-on-ink)] disabled:opacity-60"
              >
                {ocupado ? (
                  <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-5 w-5" aria-hidden="true" />
                )}
                Concluir
              </button>
              <button
                type="button"
                disabled={ocupado}
                aria-label="Iniciar cronômetro"
                title="Iniciar cronômetro"
                onClick={() =>
                  executar(async () => {
                    await timeService.start('action', principal.id)
                    toast.success('Cronômetro iniciado')
                  })
                }
                className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full border transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pegada-on-ink)] disabled:opacity-60"
                style={{ borderColor: 'var(--pegada-on-ink-muted)' }}
              >
                <Play className="h-5 w-5 fill-current" aria-hidden="true" />
              </button>
            </div>
            <button
              type="button"
              disabled={ocupado}
              onClick={() => executar(() => actionService.unsetNextStep(principal.id))}
              className="mt-2 min-h-11 text-sm underline underline-offset-4 disabled:opacity-60"
              style={MUTED}
            >
              Trocar o avanço principal
            </button>
          </>
        ) : (
          <>
            <h2 className="mt-2 text-2xl font-semibold leading-tight">
              Qual avanço mais aproxima um resultado seu hoje?
            </h2>
            {candidatos.length > 0 ? (
              <ul className="mt-4 space-y-1">
                {candidatos.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      disabled={ocupado}
                      onClick={() => executar(() => actionService.setAsNextStep(a.id))}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-base transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pegada-on-ink)]"
                    >
                      <span className="min-w-0 truncate">{a.titulo}</span>
                      <span className="shrink-0 text-[13px]" style={MUTED}>
                        Escolher
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[15px]" style={MUTED}>
                Nada escolhido para hoje ainda.{' '}
                <Link
                  to="/avancos"
                  className="underline underline-offset-4"
                  style={{ color: 'var(--pegada-on-ink)' }}
                >
                  Escolher em Avanços
                </Link>
              </p>
            )}
          </>
        )}
      </div>

      {children}

      {(dados.capturas_pendentes > 0 || reavaliar > 0 || dados.propostas_pendentes > 0) && (
        <div className="flex flex-wrap gap-2.5">
          {dados.capturas_pendentes > 0 && (
            <Link to="/capturas" className={ATALHO}>
              <span className="text-xl font-semibold">{dados.capturas_pendentes}</span>
              <span>{dados.capturas_pendentes === 1 ? 'captura para decidir' : 'capturas para decidir'}</span>
            </Link>
          )}
          {reavaliar > 0 && (
            <button type="button" onClick={onReavaliar} className={ATALHO}>
              <span className="text-xl font-semibold">{reavaliar}</span>
              <span>{reavaliar === 1 ? 'item para reavaliar' : 'itens para reavaliar'}</span>
            </button>
          )}
          {dados.propostas_pendentes > 0 && (
            <Link to="/atividade" className={ATALHO}>
              <span className="text-xl font-semibold">{dados.propostas_pendentes}</span>
              <span>
                {dados.propostas_pendentes === 1 ? 'proposta para confirmar' : 'propostas para confirmar'}
              </span>
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

export default AvancoPrincipalCard

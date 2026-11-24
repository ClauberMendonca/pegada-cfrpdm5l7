import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { op } from '@/lib/pegada/api'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { actionService, notificarMudanca } from '@/services/actionService'
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
  fio: { frase: string; livre?: boolean }
}
interface FioDeHoje {
  principal: AvancoHoje | null
  compromissos: AvancoHoje[]
  vencendo: AvancoHoje[]
  para_hoje: AvancoHoje[]
  capturas_pendentes: number
  propostas_pendentes: number
}

const INK = { background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' } as const
const MUTED = { color: 'var(--pegada-on-ink-muted)' } as const

export function AvancoPrincipalCard() {
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
        <p className="text-xs uppercase tracking-[0.08em]" style={MUTED}>
          Avanço principal{principal ? ` · ${principal.tipo_nome}` : ''}
        </p>

        {principal ? (
          <>
            <h2 className="mt-2 text-2xl font-semibold leading-tight">{principal.titulo}</h2>
            <p className="mt-3 text-[15px] leading-relaxed" style={MUTED}>
              {principal.fio?.frase || 'Avanço livre: ainda sem porquê.'}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={ocupado}
                onClick={() => executar(() => actionService.updateStatus(principal.id, 'feita'))}
                className="flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 text-base font-semibold text-primary-foreground transition-colors duration-200 hover:bg-[var(--ginga-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pegada-on-ink)] disabled:opacity-60"
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
                onClick={() => executar(() => actionService.unsetNextStep(principal.id))}
                className="flex min-h-12 items-center rounded-full border border-current px-5 text-base font-medium transition-colors duration-200 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pegada-on-ink)] disabled:opacity-60"
              >
                Trocar
              </button>
            </div>
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

      {(dados.capturas_pendentes > 0 || dados.propostas_pendentes > 0) && (
        <div className="flex flex-wrap gap-2 text-sm">
          {dados.capturas_pendentes > 0 && (
            <Link
              to="/capturas"
              className="flex min-h-11 items-center rounded-full border border-input px-4 font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {dados.capturas_pendentes}{' '}
              {dados.capturas_pendentes === 1
                ? 'captura para processar'
                : 'capturas para processar'}
            </Link>
          )}
          {dados.propostas_pendentes > 0 && (
            <Link
              to="/atividade"
              className="flex min-h-11 items-center rounded-full border border-input px-4 font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {dados.propostas_pendentes}{' '}
              {dados.propostas_pendentes === 1
                ? 'proposta para confirmar'
                : 'propostas para confirmar'}
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

export default AvancoPrincipalCard

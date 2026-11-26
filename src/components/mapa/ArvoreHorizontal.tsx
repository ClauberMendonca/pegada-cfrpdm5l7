// PEGADA — o Mapa em árvore horizontal, só no computador: do Propósito, à
// esquerda, até os avanços, à direita. Usa os mesmos dados da lista e lembra
// os mesmos ramos abertos. Tocar em um item abre a ficha dele.
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface NoDaArvore {
  /** A mesma chave que a lista usa para lembrar o que está aberto. */
  id: string
  rotulo: string
  titulo: string
  to?: string
  /** Aberto quando a pessoa ainda não mexeu. */
  padrao?: boolean
  tom?: 'proposito' | 'ramo' | 'forte' | 'normal' | 'folha'
  /** Avanço que está em Hoje. */
  hoje?: boolean
  filhos?: NoDaArvore[]
}

interface Props {
  raiz: NoDaArvore
  aberto: (id: string, padrao: boolean) => boolean
  alternar: (id: string, padrao: boolean) => void
}

function Caixa({ no }: { no: NoDaArvore }) {
  const tom = no.tom ?? 'normal'
  const conteudo = (
    <>
      {tom !== 'folha' && tom !== 'ramo' && (
        <span
          className={cn('block text-[11px] uppercase tracking-[0.08em]', tom === 'proposito' ? '' : 'text-muted-foreground')}
          style={tom === 'proposito' ? { color: 'var(--pegada-on-ink-muted)' } : undefined}
        >
          {no.rotulo}
        </span>
      )}
      <span
        className={cn(
          'block break-words leading-snug',
          tom === 'proposito' && 'text-[15px] font-semibold',
          tom === 'ramo' && 'text-sm font-semibold text-foreground',
          tom === 'forte' && 'text-[15px] font-semibold text-foreground',
          tom === 'normal' && 'text-sm font-medium text-foreground',
          tom === 'folha' && 'text-sm text-foreground',
        )}
      >
        {no.titulo}
      </span>
    </>
  )
  const classe = cn(
    'block rounded-2xl px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    tom === 'proposito' && 'w-52 p-4',
    tom === 'ramo' && 'w-40 bg-secondary',
    tom === 'forte' && 'w-48 border border-border bg-card',
    tom === 'normal' && 'w-48 border border-border bg-card',
    tom === 'folha' && 'w-48 px-2',
    no.to && tom !== 'proposito' && 'transition-colors hover:bg-secondary',
  )
  const estilo = tom === 'proposito' ? { background: 'var(--pegada-ink)', color: 'var(--pegada-on-ink)' } : undefined
  if (!no.to)
    return (
      <div className={classe} style={estilo}>
        {conteudo}
      </div>
    )
  return (
    <Link to={no.to} className={classe} style={estilo}>
      {tom === 'folha' ? (
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn('h-2.5 w-2.5 shrink-0 rounded-full', no.hoje ? 'bg-primary' : 'border-2 border-input')}
          />
          <span className="min-w-0">{conteudo}</span>
          {no.hoje && <span className="sr-only">Em Hoje</span>}
        </span>
      ) : (
        conteudo
      )}
    </Link>
  )
}

function No({ no, aberto, alternar }: { no: NoDaArvore } & Omit<Props, 'raiz'>) {
  const filhos = no.filhos ?? []
  const padrao = no.padrao ?? true
  const estaAberto = filhos.length > 0 && aberto(no.id, padrao)
  return (
    <div className="flex items-center" data-no={no.id}>
      <Caixa no={no} />
      {filhos.length > 0 && (
        <button
          type="button"
          aria-expanded={estaAberto}
          aria-label={`${estaAberto ? 'Recolher' : 'Abrir'} ${no.titulo}`}
          onClick={() => alternar(no.id, padrao)}
          className="relative z-10 -mr-1 ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {estaAberto ? (
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <span className="flex items-center text-[11px] font-medium">
              {filhos.length}
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </button>
      )}
      {estaAberto && (
        <ul className="relative ml-4 flex flex-col before:absolute before:-left-4 before:top-1/2 before:h-px before:w-4 before:bg-border">
          {filhos.map((f, i) => {
            const so = filhos.length === 1
            const primeiro = i === 0
            const ultimo = i === filhos.length - 1
            return (
              <li
                key={f.id}
                className={cn(
                  'relative py-1 pl-4 before:absolute before:left-0 before:top-1/2 before:h-px before:w-4 before:bg-border',
                  !so && 'after:absolute after:left-0 after:w-px after:bg-border',
                  !so && (primeiro ? 'after:bottom-0 after:top-1/2' : ultimo ? 'after:bottom-1/2 after:top-0' : 'after:bottom-0 after:top-0'),
                )}
              >
                <No no={f} aberto={aberto} alternar={alternar} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export function ArvoreHorizontal({ raiz, aberto, alternar }: Props) {
  return (
    <div
      className="relative left-1/2 w-[max(100%,calc(100vw-24rem))] -translate-x-1/2 overflow-x-auto pb-4"
      data-arvore-horizontal role="tree" aria-label="Mapa em árvore">
      <div className="inline-block min-w-full p-1">
        <No no={raiz} aberto={aberto} alternar={alternar} />
      </div>
    </div>
  )
}

export default ArvoreHorizontal

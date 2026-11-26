// PEGADA — a trilha do fio: os degraus acima do item, como links.
// É ao mesmo tempo o "onde estou" e o "para quê": a hierarquia, nunca o
// histórico de navegação. O item atual vem por último e não é link.
// No celular aparece a seta de voltar e só o degrau de cima.
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'

export interface Degrau {
  rotulo: string
  to: string
}

interface Props {
  /** Do mais alto (Mapa) ao degrau logo acima do item. */
  degraus: Degrau[]
  /** O nome do item aberto. */
  atual: string
}

export function Trilha({ degraus, atual }: Props) {
  const acima = degraus[degraus.length - 1]
  return (
    <nav aria-label="Onde você está" className="flex min-w-0 items-center gap-1" data-trilha>
      {acima && (
        <Link
          to={acima.to}
          aria-label={`Voltar para ${acima.rotulo}`}
          className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
      )}
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted-foreground">
        {degraus.map((d, i) => (
          <li
            key={`${d.to}-${i}`}
            className={i < degraus.length - 1 ? 'hidden items-center gap-1 sm:flex' : 'flex items-center gap-1'}
          >
            <Link
              to={d.to}
              className="max-w-[16rem] truncate rounded underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {d.rotulo}
            </Link>
            <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </li>
        ))}
        <li aria-current="page" className="hidden max-w-[20rem] truncate font-medium text-foreground sm:block">
          {atual}
        </li>
      </ol>
    </nav>
  )
}

export default Trilha

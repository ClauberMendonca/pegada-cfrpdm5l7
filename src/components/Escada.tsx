// PEGADA — a escada: "Para quê?" sobe um degrau, "Como?" desce um.
// A navegação do app é a própria escada do método.
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Link } from 'react-router-dom'

const BOTAO =
  'inline-flex h-11 items-center gap-1.5 rounded-full border border-input bg-card px-3.5 text-sm font-medium text-foreground hover:bg-secondary'

interface Props {
  /** Para onde "Para quê?" leva (o degrau de cima) e o nome dele, para leitores de tela. */
  paraQue?: { to: string; nome: string }
  /** "Como?": um link ou a âncora de uma seção desta tela. */
  como?: { to?: string; ancora?: string; nome: string }
}

export function Escada({ paraQue, como }: Props) {
  if (!paraQue && !como) return null
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Escada do método" data-escada>
      {paraQue && (
        <Link to={paraQue.to} className={BOTAO} title={`Para quê? ${paraQue.nome}`}>
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
          Para quê?
        </Link>
      )}
      {como &&
        (como.to ? (
          <Link to={como.to} className={BOTAO} title={`Como? ${como.nome}`}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
            Como?
          </Link>
        ) : (
          <button
            type="button"
            className={BOTAO}
            title={`Como? ${como.nome}`}
            onClick={() =>
              document.getElementById(como.ancora || '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
            Como?
          </button>
        ))}
    </div>
  )
}

export default Escada

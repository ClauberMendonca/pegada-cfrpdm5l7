// PEGADA — a linha de item de um avanço: círculo de concluir e título.
// O título leva à ficha do avanço, onde fica todo o resto.
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { fichaDoAvanco } from '@/lib/pegada/enderecos'
import { ACTION_KIND_LABEL, type ActionItem, type ActionKind } from '@/types/execution'
import { cn } from '@/lib/utils'

interface Props {
  action: ActionItem
  ocupado?: boolean
  /** Concluir, ou reabrir quando já está feito. */
  onAlternar: (action: ActionItem) => void
  /** Em resultado compartilhado: o nome de quem está com o avanço, quando não é você. */
  com?: string
}

export function LinhaDeAvanco({ action, ocupado, onAlternar, com }: Props) {
  const feito = action.status === 'feita'
  const cancelado = action.status === 'cancelada'
  const espera = action.status === 'aguardando' || action.status === 'bloqueada'
  const hoje = (action.is_today_selected || action.is_next_step) && !feito && !cancelado
  const tipo = (action.kind || 'acao') as ActionKind
  const detalhe = [
    tipo !== 'acao' && ACTION_KIND_LABEL[tipo],
    cancelado && 'cancelado',
    espera && (action.waiting_for ? `esperando ${action.waiting_for}` : 'esperando'),
    com && `com ${com}`,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="flex items-center gap-1" data-avanco={action.id}>
      <button
        type="button"
        disabled={ocupado || cancelado || Boolean(com)}
        aria-label={com ? `Com ${com}: ${action.title}` : `${feito ? 'Reabrir' : 'Concluir'}: ${action.title}`}
        title={com ? `Está com ${com}` : undefined}
        onClick={() => onAlternar(action)}
        className="-ml-2 flex h-11 w-9 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        <span
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full',
            feito ? 'bg-foreground text-background' : 'border-2 border-muted-foreground text-transparent',
          )}
        >
          <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
        </span>
      </button>
      <Link
        to={fichaDoAvanco(action.id)}
        className="flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-xl px-2 py-1.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span
          className={cn(
            'break-words text-[15px] leading-snug text-foreground',
            (feito || cancelado) && 'text-muted-foreground line-through',
          )}
        >
          {action.title}
        </span>
        {detalhe && <span className="text-[13px] text-muted-foreground">{detalhe}</span>}
      </Link>
      {hoje && (
        <span
          role="img"
          aria-label={action.is_next_step ? 'Avanço principal de hoje' : 'Em Hoje'}
          title={action.is_next_step ? 'Avanço principal de hoje' : 'Em Hoje'}
          className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full bg-primary"
        />
      )}
    </div>
  )
}

export default LinhaDeAvanco

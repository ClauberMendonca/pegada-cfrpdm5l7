import React from 'react'
import { cn } from '@/lib/utils'
import {
  EntityNumberKind,
  entityNumberAriaLabel,
  entityNumberCode,
  reportMissingEntityNumber,
} from '@/lib/entityNumber'

/**
 * NUMERAÇÃO PERMANENTE — selo discreto "P-3" / "A-12" antes do título.
 * Vem do banco (sequence_number); sem número não renderiza nada (nunca
 * "P-0", índice ou código inventado). Selo neutro, tokens da paleta,
 * dígitos tabulares, não clicável e fora do alvo de toque dos comandos.
 */
export const EntityNumberBadge: React.FC<{
  kind: EntityNumberKind
  n: number | null | undefined
  entityId?: string
  className?: string
}> = ({ kind, n, entityId, className }) => {
  const code = entityNumberCode(kind, n)
  if (!code) {
    if (entityId) reportMissingEntityNumber(kind, entityId)
    return null
  }
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-md border border-border bg-muted px-1.5 py-0.5',
        'text-[11px] font-semibold leading-none text-muted-foreground',
        'tabular-nums select-none whitespace-nowrap',
        className,
      )}
      title={entityNumberAriaLabel(kind, n as number)}
      aria-label={entityNumberAriaLabel(kind, n as number)}
    >
      {code}
    </span>
  )
}

/**
 * Linha "selo + título" — título com min-width/linha/truncamento responsivos,
 * selo inteiro visível (shrink-0/nowrap). Sem link aninhado nem botão extra.
 */
export const EntityNumberedTitle: React.FC<{
  kind: EntityNumberKind
  n: number | null | undefined
  entityId?: string
  title: string
  titleClassName?: string
  className?: string
}> = ({ kind, n, entityId, title, titleClassName, className }) => (
  <span className={cn('flex min-w-0 items-baseline gap-1.5', className)}>
    <EntityNumberBadge kind={kind} n={n} entityId={entityId} />
    <span className={cn('min-w-0 break-words line-clamp-2', titleClassName)}>{title}</span>
  </span>
)

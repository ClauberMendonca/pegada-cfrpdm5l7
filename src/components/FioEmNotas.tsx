// PEGADA — o fio em notas curtas: de onde o avanço vem, sem repetir a frase
// inteira nem o título dele. O propósito fica no topo da tela (PropositoNoTopo),
// então aqui só entram a vontade ou responsabilidade, o resultado e a estratégia.
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export interface NotaDoFio {
  rotulo: 'Vontade' | 'Responsabilidade' | 'Resultado' | 'Estratégia'
  titulo: string
  to?: string
}

export function notasDoFio(fio: {
  vontade?: { titulo: string; to?: string } | null
  responsabilidade?: { titulo: string; to?: string } | null
  resultado?: { titulo: string; to?: string } | null
  estrategia?: { titulo: string; to?: string } | null
}): NotaDoFio[] {
  const notas: NotaDoFio[] = []
  if (fio.vontade) notas.push({ rotulo: 'Vontade', ...fio.vontade })
  else if (fio.responsabilidade) notas.push({ rotulo: 'Responsabilidade', ...fio.responsabilidade })
  if (fio.resultado) notas.push({ rotulo: 'Resultado', ...fio.resultado })
  if (fio.estrategia) notas.push({ rotulo: 'Estratégia', ...fio.estrategia })
  return notas
}

export function FioEmNotas({
  notas,
  emTinta,
  className,
}: {
  notas: NotaDoFio[]
  /** Dentro do cartão escuro do avanço principal. */
  emTinta?: boolean
  className?: string
}) {
  if (notas.length === 0) return null
  const apagado = emTinta ? { color: 'var(--pegada-on-ink-muted)' } : undefined
  return (
    <dl className={cn('flex flex-col gap-1', className)} data-fio-em-notas>
      {notas.map((n) => (
        <div key={n.rotulo} className="flex items-baseline gap-2 text-[13px] leading-snug">
          <dt className={cn('w-32 shrink-0 text-[11px] uppercase tracking-[0.06em]', !emTinta && 'text-muted-foreground')} style={apagado}>
            {n.rotulo}
          </dt>
          <dd className={cn('min-w-0 break-words text-sm', !emTinta && 'text-foreground')}>
            {n.to ? (
              <Link to={n.to} className="underline-offset-4 hover:underline">
                {n.titulo}
              </Link>
            ) : (
              n.titulo
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

export default FioEmNotas

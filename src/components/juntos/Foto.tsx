// PEGADA — a foto (ou as iniciais) de uma pessoa, pequena.
import { fotoDe, iniciais } from '@/lib/pegada/juntos'
import { cn } from '@/lib/utils'

export function Foto({
  pessoa,
  className,
}: {
  pessoa: { id: string; nome: string; foto?: string }
  className?: string
}) {
  const src = fotoDe(pessoa)
  return (
    <span
      title={pessoa.nome}
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary text-xs font-semibold text-foreground',
        className,
      )}
    >
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : iniciais(pessoa.nome)}
    </span>
  )
}

export default Foto

// PEGADA — "O que reavaliar": prazos vencidos e esperas. Morava em Hoje;
// agora é um passo da Revisão, para o dia ficar só com o que será feito.
import { Link } from 'react-router-dom'
import { fichaDoAvanco } from '@/lib/pegada/enderecos'
import type { ActionItem } from '@/types/execution'

interface Props {
  actions: ActionItem[]
  hoje: string
}

function Lista({ titulo, itens, detalhe }: { titulo: string; itens: ActionItem[]; detalhe: (a: ActionItem) => string }) {
  if (itens.length === 0) return null
  return (
    <div>
      <p className="px-2 pb-1 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo} ({itens.length})
      </p>
      <ul>
        {itens.map((a) => (
          <li key={a.id}>
            <Link
              to={fichaDoAvanco(a.id)}
              className="flex min-h-11 flex-col justify-center rounded-xl px-2 py-1.5 hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="break-words text-[15px] leading-snug text-foreground">{a.title}</span>
              <span className="text-[13px] text-muted-foreground">{detalhe(a)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const dia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function OQueReavaliar({ actions, hoje }: Props) {
  const abertos = actions.filter((a) => a.status !== 'feita' && a.status !== 'cancelada')
  const vencidos = abertos.filter((a) => a.deadline && a.deadline < hoje)
  const esperas = abertos.filter(
    (a) => (a.status === 'aguardando' || a.status === 'bloqueada') && !(a.deadline && a.deadline < hoje),
  )
  return (
    <section id="reavaliar" aria-label="O que reavaliar" className="scroll-mt-24 space-y-3" data-o-que-reavaliar>
      <div>
        <h3 className="text-[17px] font-semibold text-foreground">O que reavaliar</h3>
        <p className="text-sm text-muted-foreground">
          Prazos que passaram e esperas. Para cada um: ainda vale, muda a data ou sai?
        </p>
      </div>
      {vencidos.length + esperas.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Nada para reavaliar agora.
        </p>
      ) : (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-2">
          <Lista titulo="Prazo vencido" itens={vencidos} detalhe={(a) => `venceu em ${dia(a.deadline as string)}`} />
          <Lista
            titulo="Esperando"
            itens={esperas}
            detalhe={(a) => (a.waiting_for ? `esperando ${a.waiting_for}` : 'esperando')}
          />
        </div>
      )}
    </section>
  )
}

export default OQueReavaliar

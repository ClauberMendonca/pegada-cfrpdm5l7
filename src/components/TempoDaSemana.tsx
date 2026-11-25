// PEGADA — o tempo cronometrado da semana, por resultado. Aparece só na
// Revisão: no dia a dia o relógio fica discreto, sem totais de cobrança.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import pb from '@/lib/pocketbase/client'
import { fichaDoResultado } from '@/lib/pegada/enderecos'
import { formatDuration } from '@/lib/timeHelpers'
import type { TimeEntry } from '@/services/timeService'
import type { ActionItem, Project } from '@/types/execution'

function segundaDe(hoje: string): string {
  const d = new Date(`${hoje}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

export function TempoDaSemana({ actions, projects, hoje }: { actions: ActionItem[]; projects: Project[]; hoje: string }) {
  const [entradas, setEntradas] = useState<TimeEntry[]>([])
  useEffect(() => {
    let vivo = true
    pb.collection('time_entries')
      .getFullList<TimeEntry>({
        filter: pb.filter('entry_date >= {:d} && is_deleted != true && status = "ended"', { d: segundaDe(hoje) }),
      })
      .then((l) => vivo && setEntradas(l))
      .catch(() => vivo && setEntradas([]))
    return () => {
      vivo = false
    }
  }, [hoje])

  const doAvanco = new Map(actions.map((a) => [a.id, a.project_id || '']))
  const nome = new Map(projects.map((p) => [p.id, p.title]))
  const porResultado = new Map<string, number>()
  let total = 0
  for (const e of entradas) {
    const s = e.duration_seconds || 0
    if (s <= 0) continue
    const r = e.project_id || (e.action_id ? doAvanco.get(e.action_id) || '' : '')
    const chave = r && nome.has(r) ? r : ''
    porResultado.set(chave, (porResultado.get(chave) || 0) + s)
    total += s
  }
  if (total === 0) return null
  const linhas = [...porResultado.entries()].sort((a, b) => b[1] - a[1])

  return (
    <section aria-label="Tempo da semana" className="rounded-[20px] border border-border bg-card p-[18px]" data-tempo-da-semana>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-foreground">Tempo da semana</h3>
        <p className="text-[13px] text-muted-foreground">{formatDuration(total)}</p>
      </div>
      <ul className="mt-2">
        {linhas.map(([id, s]) => (
          <li key={id || 'livres'} className="flex min-h-11 items-center justify-between gap-3 text-[15px]">
            {id ? (
              <Link to={fichaDoResultado(id)} className="min-w-0 truncate text-foreground underline-offset-4 hover:underline">
                {nome.get(id)}
              </Link>
            ) : (
              <span className="min-w-0 truncate text-foreground">Avanços livres</span>
            )}
            <span className="shrink-0 text-muted-foreground">{formatDuration(s)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default TempoDaSemana

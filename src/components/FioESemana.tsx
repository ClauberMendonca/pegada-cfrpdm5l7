// PEGADA — coluna do computador na tela Hoje: o fio do avanço principal
// (Propósito → Resultado → Estratégia → Avanço) e a semana em barras.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { op } from '@/lib/pegada/api'
import { usePegadaMudou } from '@/lib/pegada/useMudou'
import { dayInZone } from '@/lib/datetime'
import type { ActionItem } from '@/types/execution'
import { cn } from '@/lib/utils'

interface Fio {
  proposito?: string
  principal: {
    titulo: string
    fio: {
      resultado?: { titulo: string } | null
      estrategia?: { titulo: string } | null
      responsabilidade?: { titulo: string } | null
    }
  } | null
}

const LETRAS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D']
const NOMES = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo']

function soma(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function FioESemana({
  actions,
  hoje,
  timezone,
  className,
}: {
  actions: ActionItem[]
  hoje: string
  timezone?: string
  className?: string
}) {
  const [fio, setFio] = useState<Fio | null>(null)
  const carregar = useCallback(async () => {
    try {
      const res = await op<Fio>('ver_fio_de_hoje', {})
      setFio(res.resultado ?? null)
    } catch {
      setFio(null)
    }
  }, [])
  useEffect(() => {
    void carregar()
  }, [carregar])
  usePegadaMudou(carregar)

  // A semana vai de segunda a domingo: feitos em cada dia e o que está planejado.
  const semana = useMemo(() => {
    const dow = (new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7
    const dias = Array.from({ length: 7 }, (_, i) => soma(hoje, i - dow))
    return dias.map((dia, i) => {
      let feitos = 0
      let planejados = 0
      for (const a of actions) {
        if (a.status === 'feita') {
          if (a.completed_at && dayInZone(a.completed_at, timezone) === dia) feitos++
        } else if (a.status !== 'cancelada') {
          const quando = a.planned_date || a.deadline || ((a.is_today_selected || a.is_next_step) ? hoje : '')
          if (quando === dia) planejados++
        }
      }
      return { dia, i, feitos, planejados }
    })
  }, [actions, hoje, timezone])
  const total = semana.reduce((n, d) => n + d.feitos + d.planejados, 0)
  const maior = Math.max(1, ...semana.map((d) => d.feitos + d.planejados))

  const p = fio?.principal
  const nos = p
    ? [
        fio?.proposito ? { rotulo: 'Propósito', texto: fio.proposito } : null,
        p.fio.responsabilidade && !p.fio.resultado
          ? { rotulo: 'Responsabilidade', texto: p.fio.responsabilidade.titulo }
          : null,
        p.fio.resultado ? { rotulo: 'Resultado', texto: p.fio.resultado.titulo } : null,
        p.fio.estrategia ? { rotulo: 'Estratégia', texto: p.fio.estrategia.titulo } : null,
      ].filter((n): n is { rotulo: string; texto: string } => n !== null)
    : []

  return (
    <aside aria-label="O fio e a semana" className={cn('flex-col gap-5', className)}>
      <div className="flex flex-col gap-3.5 pt-3">
        <p className="text-xs uppercase tracking-[0.08em] text-muted-foreground">O fio de hoje</p>
        {p ? (
          <div className="flex flex-col pl-[7px]">
            {nos.map((n, i) => (
              <div key={n.rotulo} className="relative border-l-2 border-primary pb-[18px] pl-[18px]">
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute -left-2 top-[3px] h-3.5 w-3.5 rounded-full',
                    i === 0 ? 'bg-foreground' : 'border-2 border-foreground bg-background',
                  )}
                />
                <p className="text-xs text-muted-foreground">{n.rotulo}</p>
                <p className="break-words text-[15px] font-medium leading-snug text-foreground">{n.texto}</p>
              </div>
            ))}
            <div className="relative pl-5">
              <span aria-hidden="true" className="absolute -left-1.5 top-[3px] h-3.5 w-3.5 rounded-full bg-primary" />
              <p className="text-xs text-muted-foreground">Avanço de hoje</p>
              <p className="break-words text-[15px] font-semibold leading-snug text-foreground">{p.titulo}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Escolha o avanço principal para ver de onde ele vem.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3.5 rounded-[20px] border border-border bg-card p-[18px]">
        <div className="flex items-baseline justify-between">
          <p className="text-base font-semibold text-foreground">Sua semana</p>
          <p className="text-[13px] text-muted-foreground">
            {total} {total === 1 ? 'avanço' : 'avanços'}
          </p>
        </div>
        <div
          role="img"
          aria-label={`Avanços por dia: ${semana.map((d) => `${NOMES[d.i]} ${d.feitos + d.planejados}`).join(', ')}`}
          className="flex h-[72px] items-end gap-2.5"
        >
          {semana.map((d) => {
            const altura = (n: number) => Math.round((n / maior) * 48)
            const vazio = d.feitos + d.planejados === 0
            return (
              <div key={d.dia} className="flex h-[72px] flex-1 flex-col items-center justify-end gap-1.5">
                <div className="flex w-full flex-col justify-end gap-0.5">
                  {vazio && <div className="h-1 w-full rounded-sm bg-muted-foreground/25" />}
                  {d.planejados > 0 && (
                    <div className="w-full rounded-md bg-muted-foreground/25" style={{ height: altura(d.planejados) }} />
                  )}
                  {d.feitos > 0 && (
                    <div className="w-full rounded-md bg-primary" style={{ height: altura(d.feitos) }} />
                  )}
                </div>
                <p className={cn('text-xs', d.dia === hoje ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {LETRAS[d.i]}
                </p>
              </div>
            )
          })}
        </div>
        <p className="text-[13px] leading-snug text-muted-foreground">
          Laranja é o que já foi feito. O resto está planejado.
        </p>
      </div>
    </aside>
  )
}

export default FioESemana

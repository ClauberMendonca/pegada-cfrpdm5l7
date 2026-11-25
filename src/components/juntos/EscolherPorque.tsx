// PEGADA — o porquê de quem participa: em qual Responsabilidade ou Vontade
// SUA o resultado se encaixa. Só a própria pessoa vê.
import { useEffect, useState } from 'react'
import { responsibilityService } from '@/services/responsibilityService'
import { wishService } from '@/services/wishService'

interface Props {
  /** 'r:<id>' | 'v:<id>' | '' */
  valor: string
  onMudar: (valor: string) => void
  id?: string
}

export const porqueDe = (valor: string) =>
  valor.startsWith('r:')
    ? { responsabilidade_id: valor.slice(2) }
    : valor.startsWith('v:')
      ? { vontade_id: valor.slice(2) }
      : {}

export function EscolherPorque({ valor, onMudar, id }: Props) {
  const [resps, setResps] = useState<{ id: string; title: string }[]>([])
  const [vontades, setVontades] = useState<{ id: string; title: string }[]>([])
  useEffect(() => {
    let vivo = true
    responsibilityService
      .list()
      .then((l) => vivo && setResps(l.filter((x) => x.status === 'ativa')))
      .catch(() => {})
    wishService
      .list()
      .then((l) => vivo && setVontades(l.filter((x) => x.status === 'ativa')))
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])
  return (
    <select
      id={id}
      value={valor}
      onChange={(e) => onMudar(e.target.value)}
      className="h-11 w-full rounded-xl border border-input bg-card px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="">Decido depois</option>
      {vontades.length > 0 && (
        <optgroup label="Realiza uma vontade minha">
          {vontades.map((v) => (
            <option key={v.id} value={`v:${v.id}`}>
              {v.title}
            </option>
          ))}
        </optgroup>
      )}
      {resps.length > 0 && (
        <optgroup label="Sustenta uma responsabilidade minha">
          {resps.map((x) => (
            <option key={x.id} value={`r:${x.id}`}>
              {x.title}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

export default EscolherPorque

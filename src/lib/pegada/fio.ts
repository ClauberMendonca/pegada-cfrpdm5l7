// PEGADA — o fio: a frase do porquê de cada avanço, montada pela estrutura.
// "Faço X, pela estratégia S, para alcançar R, sustentando Resp, porque P."
// Mesma regra do servidor (pocketbase/hooks/lib/pegada-core.js → fioOf).
import { ActionItem } from '@/types/execution'

export interface Fio {
  frase: string
  semFio: boolean
  apoio: 'construir' | 'sustentar' | 'livre'
}

export function fioDoAvanco(a: ActionItem, proposito?: string): Fio {
  const result = a.expand?.project_id
  const strategy = a.expand?.strategy_id
  const resp = result ? result.expand?.responsibility_id : a.expand?.responsibility_id
  const semFio = !result && !resp && !a.project_id && !a.responsibility_id
  if (semFio) return { frase: '', semFio: true, apoio: 'livre' }
  const parts = [`Faço “${a.title}”`]
  if (strategy) parts.push(`pela estratégia “${strategy.title}”`)
  if (result) {
    parts.push(`para alcançar “${result.title}”`)
    if (resp) parts.push(`sustentando “${resp.title}”`)
  } else if (resp) {
    parts.push(`para sustentar “${resp.title}”`)
  }
  const p = (proposito || '').trim().replace(/[.\s]+$/, '')
  if (p) parts.push(`porque ${p.charAt(0).toLowerCase()}${p.slice(1)}`)
  return { frase: parts.join(', ') + '.', semFio: false, apoio: resp ? 'sustentar' : 'construir' }
}

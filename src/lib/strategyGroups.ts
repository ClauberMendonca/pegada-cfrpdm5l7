/**
 * 4B1 — Agrupamento PURO dos Avanços já carregados por strategy_id.
 * Cada Avanço aparece uma vez: no grupo da Estratégia correspondente, em
 * "Sem estratégia" (campo vazio/ausente) ou em grupo "indisponível" (ID
 * referenciado que não está na lista confirmada). Nada é inferido pelo texto
 * e nada é gravado. Ordem relativa dos Avanços é preservada.
 */
import { ActionItem, Strategy } from '@/types/execution'

export type StrategyGroupKind = 'strategy' | 'unavailable' | 'none'

export interface StrategyGroup {
  key: string
  kind: StrategyGroupKind
  strategy?: Strategy
  actions: ActionItem[]
}

export function groupActionsByStrategy(
  actions: ActionItem[],
  strategies: Strategy[],
): StrategyGroup[] {
  const known = new Set(strategies.map((s) => s.id))
  const buckets = new Map<string, ActionItem[]>()
  const unavailable = new Map<string, ActionItem[]>()
  const none: ActionItem[] = []

  for (const action of actions) {
    const sid = action.strategy_id ?? ''
    if (!sid) {
      none.push(action)
    } else if (known.has(sid)) {
      const list = buckets.get(sid) ?? []
      list.push(action)
      buckets.set(sid, list)
    } else {
      const list = unavailable.get(sid) ?? []
      list.push(action)
      unavailable.set(sid, list)
    }
  }

  const groups: StrategyGroup[] = []
  for (const strategy of strategies) {
    const list = buckets.get(strategy.id)
    if (list && list.length > 0) {
      groups.push({ key: `s:${strategy.id}`, kind: 'strategy', strategy, actions: list })
    }
  }
  for (const [sid, list] of unavailable) {
    groups.push({ key: `u:${sid}`, kind: 'unavailable', actions: list })
  }
  if (none.length > 0) {
    groups.push({ key: 'none', kind: 'none', actions: none })
  }
  return groups
}

export function strategyGroupLabel(group: StrategyGroup): string {
  if (group.kind === 'strategy' && group.strategy) return group.strategy.title
  if (group.kind === 'unavailable') return 'Estratégia atual indisponível — vínculo preservado'
  return 'Sem estratégia'
}

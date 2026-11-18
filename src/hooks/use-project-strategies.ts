/**
 * 4B1 — Lista ÚNICA de Estratégias do Resultado (gestão + agrupamento).
 * Carrega só quando muda dono/Resultado, no retry manual ou quando uma
 * alteração de Estratégia é confirmada (upsert). Sem polling, sem cache global.
 * Leituras tardias de outro Resultado/dono são descartadas. Falha aqui é
 * erro DESTA lista: não afeta Avanços, Resultado ou tempo da ficha.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { strategyService } from '@/services/strategyService'
import { currentOwnerSnapshot, isSameOwner } from '@/lib/ownerScope'
import { getErrorMessage } from '@/lib/pocketbase/errors'
import { Strategy } from '@/types/execution'

export interface ProjectStrategiesState {
  items: Strategy[]
  loading: boolean
  /** Mensagem legível da falha da LISTA (null = sem erro). */
  error: string | null
  reload: () => void
  /** Aplica uma Estratégia JÁ confirmada pelo backend (criada/editada/status). */
  upsert: (saved: Strategy) => void
}

function sortStrategies(list: Strategy[]): Strategy[] {
  return [...list].sort((a, b) => {
    if (a.created !== b.created) return a.created < b.created ? -1 : 1
    if (a.id === b.id) return 0
    return a.id < b.id ? -1 : 1
  })
}

export function useProjectStrategies(projectId: string): ProjectStrategiesState {
  const ownerId = currentOwnerSnapshot().ownerId
  const [items, setItems] = useState<Strategy[]>([])
  const [loading, setLoading] = useState<boolean>(Boolean(projectId && ownerId))
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const requestRef = useRef(0)
  const currentRef = useRef({ projectId, ownerId })
  currentRef.current = { projectId, ownerId }

  useEffect(() => {
    const requestId = ++requestRef.current
    if (!ownerId || !projectId) {
      setItems([])
      setLoading(false)
      setError(null)
      return
    }
    setItems([])
    setLoading(true)
    setError(null)
    strategyService
      .listByProject(projectId)
      .then((list) => {
        if (requestRef.current !== requestId) return
        if (currentRef.current.projectId !== projectId) return
        if (!isSameOwner({ ownerId })) return
        setItems(sortStrategies(list))
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (requestRef.current !== requestId) return
        if (currentRef.current.projectId !== projectId) return
        setItems([])
        setError(getErrorMessage(err) || 'Erro desconhecido')
        setLoading(false)
      })
    return () => {
      // invalida qualquer retorno tardio desta leitura ao trocar/desmontar
      requestRef.current++
    }
  }, [projectId, ownerId, reloadTick])

  const reload = useCallback(() => setReloadTick((t) => t + 1), [])

  const upsert = useCallback((saved: Strategy) => {
    if (saved.project_id !== currentRef.current.projectId) return
    setItems((prev) => sortStrategies([...prev.filter((s) => s.id !== saved.id), saved]))
  }, [])

  return { items, loading, error, reload, upsert }
}

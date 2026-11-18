/**
 * ENTREGA 3C1 — Referência somente leitura de uma Responsabilidade por ID.
 * Usada na identificação de HERANÇA do Resultado (ActionModal) e na referência
 * discreta da ficha (ProjectDetail). Nunca grava, nunca vira opção de escolha.
 *
 * Contrato de estados:
 * - ''  = ausência CONFIRMADA por leitura autenticada do registro pai;
 * - null/undefined = indeterminado (pai ainda não carregado) — NUNCA vira
 *   "Nenhuma" nem apaga vínculo;
 * - 'error' = leitura falhou (inclui 404/403 de outro dono): o vínculo é
 *   preservado e a UI decide o texto; não autoriza novo vínculo no cliente.
 * Uma leitura por ID vigente, reaproveitada enquanto dono/ID não mudam; guarda
 * de dono descarta retornos tardios de outra sessão.
 */
import { useEffect, useState } from 'react'
import { Responsibility } from '@/types/execution'
import { responsibilityService } from '@/services/responsibilityService'
import { currentOwnerSnapshot, isSameOwner } from '@/lib/ownerScope'

export type ResponsibilityRefState =
  | { status: 'none' }
  | { status: 'unknown' }
  | { status: 'loading' }
  | { status: 'ready'; data: Responsibility }
  | { status: 'error' }

export function useResponsibilityReference(id: string | null | undefined): ResponsibilityRefState {
  const [state, setState] = useState<ResponsibilityRefState>(() =>
    id === '' ? { status: 'none' } : id ? { status: 'loading' } : { status: 'unknown' },
  )

  useEffect(() => {
    if (id === '') {
      setState({ status: 'none' })
      return
    }
    if (!id) {
      setState({ status: 'unknown' })
      return
    }
    const snap = currentOwnerSnapshot()
    let cancelled = false
    setState({ status: 'loading' })
    responsibilityService
      .getById(id)
      .then((r) => {
        if (!cancelled && isSameOwner(snap)) setState({ status: 'ready', data: r })
      })
      .catch(() => {
        if (!cancelled && isSameOwner(snap)) setState({ status: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [id])

  return state
}

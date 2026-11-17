import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { LifeWorkContext } from '@/types/execution'

interface FilterContextType {
  contextFilter: LifeWorkContext
  setContextFilter: (context: LifeWorkContext) => void
}

const FilterContext = createContext<FilterContextType | undefined>(undefined)

// Chave local própria por dono: guarda SOMENTE o valor do filtro (todos|vida|trabalho).
const STORAGE_KEY_PREFIX = 'ginga.contextFilter:'

function storageKeyFor(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`
}

function isValidContext(value: unknown): value is LifeWorkContext {
  return value === 'todos' || value === 'vida' || value === 'trabalho'
}

function readStoredPreference(userId: string): LifeWorkContext | null {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(userId))
    return isValidContext(raw) ? raw : null
  } catch {
    // localStorage indisponível: segue em memória, fallback Todos
    return null
  }
}

function writeStoredPreference(userId: string, value: LifeWorkContext): void {
  try {
    window.localStorage.setItem(storageKeyFor(userId), value)
  } catch {
    // sem persistência disponível: mantém a escolha apenas em memória
  }
}

export const FilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()

  // Estado visível: começa em Todos e NUNCA é gravado por efeito inicial —
  // só a escolha explícita (setContextFilter) persiste.
  const [contextFilter, setContextFilterState] = useState<LifeWorkContext>('todos')

  // Identidade cuja leitura/gravação está em curso; evita aplicar leitura de um
  // dono anterior após logout/troca (retorno tardio) e grava sob outra identidade.
  const ownerIdRef = useRef<string | null>(null)

  // Restaura a preferência do dono atual somente após a identidade resolvida.
  useEffect(() => {
    if (!user?.id) {
      ownerIdRef.current = null
      // Logout/troca de dono: recorte visível volta a Todos, sem apagar a
      // preferência local gravada do dono anterior (não vaza entre contas).
      setContextFilterState('todos')
      return
    }

    const ownerId = user.id
    ownerIdRef.current = ownerId

    const stored = readStoredPreference(ownerId)
    // Aplica a leitura apenas se a identidade corrente ainda for a mesma.
    if (ownerIdRef.current === ownerId) {
      setContextFilterState(stored ?? 'todos')
    }
  }, [user?.id])

  const setContextFilter = useCallback((context: LifeWorkContext) => {
    setContextFilterState(context)

    // Persiste apenas para a identidade/estado correntes (escolha explícita).
    const ownerId = ownerIdRef.current
    if (!ownerId) return
    writeStoredPreference(ownerId, context)
  }, [])

  return (
    <FilterContext.Provider value={{ contextFilter, setContextFilter }}>
      {children}
    </FilterContext.Provider>
  )
}

export function useGlobalFilter() {
  const context = useContext(FilterContext)
  if (!context) {
    throw new Error('useGlobalFilter deve ser usado dentro de FilterProvider')
  }
  return context
}

import React, { createContext, useContext, useState } from 'react'
import { LifeWorkContext } from '@/types/execution'

interface FilterContextType {
  contextFilter: LifeWorkContext
  setContextFilter: (context: LifeWorkContext) => void
}

const FilterContext = createContext<FilterContextType | undefined>(undefined)

export const FilterProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [contextFilter, setContextFilter] = useState<LifeWorkContext>('todos')

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

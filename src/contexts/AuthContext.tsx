import React, { createContext, useContext, useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { op } from '@/lib/pegada/api'
import { UserProfile } from '@/types/execution'
import { mapUserProfile } from '@/lib/profileMapper'

interface AuthContextType {
  user: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
  needsTimezoneSetup: boolean
  login: (email: string, pass: string) => Promise<void>
  logout: () => void
  updateTimezone: (timezone: string) => Promise<void>
  updateLifePurpose: (text: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // FATIA 2A: todos os caminhos que montam UserProfile usam o mapper
  // compartilhado (src/lib/profileMapper.ts), para life_purpose nunca se
  // perder num ajuste de fuso, refresh ou troca de sessão.
  const [user, setUser] = useState<UserProfile | null>(() =>
    mapUserProfile(pb.authStore.isValid ? pb.authStore.model : null),
  )
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    const unsub = pb.authStore.onChange((_token, model) => {
      // Logout / limpeza: model null → perfil null (estado limpo, sem dono antigo).
      setUser(mapUserProfile(model))
    })

    if (pb.authStore.isValid && pb.authStore.model) {
      // Re-fetch fresh user record to ensure timezone is up to date
      const sessionId = pb.authStore.model.id
      pb.collection('users')
        .getOne(sessionId)
        .then((fresh) => {
          // Sessão pode ter mudado durante o request — não aplicar dono antigo.
          if (pb.authStore.isValid && pb.authStore.model?.id === sessionId) {
            setUser(mapUserProfile(fresh))
          }
        })
        .catch(() => {
          // ignore error
        })
        .finally(() => {
          setIsLoading(false)
        })
    } else {
      setIsLoading(false)
    }

    return () => {
      unsub()
    }
  }, [])

  const login = async (email: string, pass: string) => {
    const authData = await pb.collection('users').authWithPassword(email.trim(), pass)
    setUser(mapUserProfile(authData.record))
  }

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
  }

  const updateTimezone = async (timezone: string) => {
    if (!user) return
    const sessionId = user.id
    const updated = await pb.collection('users').update(sessionId, { timezone })
    // Confere a sessão antes de aplicar: resposta atrasada de outra sessão
    // não restaura o dono anterior.
    if (pb.authStore.isValid && pb.authStore.model?.id === sessionId) {
      setUser(mapUserProfile(updated))
    }
  }

  // FATIA 2A — PROPÓSITO DE VIDA: atualiza somente { life_purpose } do ID da
  // sessão atual (nunca spread do perfil com email/name/senha/timezone).
  // Texto preservado como o autor digitou (quebras incluídas); vazio é
  // remoção explícita. Só reflete no perfil compartilhado APÓS confirmação do
  // servidor — sem falso sucesso por setState, sem atualização otimista.
  const updateLifePurpose = async (text: string) => {
    if (!user) throw new Error('Sem sessão ativa para salvar o propósito.')
    const sessionId = user.id
    // PEGADA — o Propósito é escolha do dono e passa pela API do método
    // (histórico com desfazer). A escrita direta em users.life_purpose é recusada.
    await op('definir_proposito', { texto: text })
    const updated = await pb.collection('users').getOne(sessionId)
    if (pb.authStore.isValid && pb.authStore.model?.id === sessionId) {
      setUser(mapUserProfile(updated))
    }
  }

  const isAuthenticated = Boolean(user && pb.authStore.isValid)
  const needsTimezoneSetup = Boolean(
    isAuthenticated && (!user?.timezone || user.timezone.trim() === ''),
  )

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated,
        needsTimezoneSetup,
        login,
        logout,
        updateTimezone,
        updateLifePurpose,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider')
  }
  return context
}

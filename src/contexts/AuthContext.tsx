import React, { createContext, useContext, useEffect, useState } from 'react'
import pb from '@/lib/pocketbase/client'
import { UserProfile } from '@/types/execution'

interface AuthContextType {
  user: UserProfile | null
  isLoading: boolean
  isAuthenticated: boolean
  needsTimezoneSetup: boolean
  login: (email: string, pass: string) => Promise<void>
  logout: () => void
  updateTimezone: (timezone: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserProfile | null>(() => {
    if (pb.authStore.isValid && pb.authStore.model) {
      return {
        id: pb.authStore.model.id,
        email: pb.authStore.model.email || '',
        name: pb.authStore.model.name || '',
        timezone: pb.authStore.model.timezone || '',
        created: pb.authStore.model.created || '',
        updated: pb.authStore.model.updated || '',
      }
    }
    return null
  })
  const [isLoading, setIsLoading] = useState<boolean>(true)

  useEffect(() => {
    const unsub = pb.authStore.onChange((_token, model) => {
      if (model) {
        setUser({
          id: model.id,
          email: model.email || '',
          name: model.name || '',
          timezone: model.timezone || '',
          created: model.created || '',
          updated: model.updated || '',
        })
      } else {
        setUser(null)
      }
    })

    if (pb.authStore.isValid && pb.authStore.model) {
      // Re-fetch fresh user record to ensure timezone is up to date
      pb.collection('users')
        .getOne(pb.authStore.model.id)
        .then((fresh) => {
          setUser({
            id: fresh.id,
            email: fresh.email || '',
            name: fresh.name || '',
            timezone: fresh.timezone || '',
            created: fresh.created || '',
            updated: fresh.updated || '',
          })
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
    setUser({
      id: authData.record.id,
      email: authData.record.email || '',
      name: authData.record.name || '',
      timezone: authData.record.timezone || '',
      created: authData.record.created || '',
      updated: authData.record.updated || '',
    })
  }

  const logout = () => {
    pb.authStore.clear()
    setUser(null)
  }

  const updateTimezone = async (timezone: string) => {
    if (!user) return
    const updated = await pb.collection('users').update(user.id, { timezone })
    setUser({
      id: updated.id,
      email: updated.email || '',
      name: updated.name || '',
      timezone: updated.timezone || '',
      created: updated.created || '',
      updated: updated.updated || '',
    })
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

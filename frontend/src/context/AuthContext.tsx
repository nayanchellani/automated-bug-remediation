import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { authApi, setApiToken } from '../lib/api'

interface AuthContextType {
  accessToken: string | null
  isLoading: boolean
  setAccessToken: (token: string | null) => void
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    authApi.refresh()
      .then(({ data }) => {
        setApiToken(data.access_token)
        setAccessToken(data.access_token)
      })
      .catch(() => setAccessToken(null))
      .finally(() => setIsLoading(false))
  }, [])

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {})
    setAccessToken(null)
  }, [])

  return (
    <AuthContext.Provider value={{ accessToken, isLoading, setAccessToken, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

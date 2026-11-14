import React, { useEffect, useState, useCallback } from 'react'
import { authApi, setApiToken } from '../lib/api'
import { AuthContext } from './authContextValue'

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [accessToken, setAccessTokenState] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Keeps React state and the axios client's in-memory token in sync
  const setAccessToken = useCallback((token: string | null) => {
    setApiToken(token)
    setAccessTokenState(token)
  }, [])

  useEffect(() => {
    authApi.refresh()
      .then(({ data }) => setAccessToken(data.access_token))
      .catch(() => setAccessToken(null))
      .finally(() => setIsLoading(false))
  }, [setAccessToken])

  const logout = useCallback(async () => {
    await authApi.logout().catch(() => {})
    setAccessToken(null)
  }, [setAccessToken])

  return (
    <AuthContext.Provider value={{ accessToken, isLoading, setAccessToken, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

import { createContext } from 'react'

export interface AuthContextType {
  accessToken: string | null
  isLoading: boolean
  setAccessToken: (token: string | null) => void
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextType | null>(null)

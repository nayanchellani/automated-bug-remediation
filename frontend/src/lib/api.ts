import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:8000',
  withCredentials: true,
})

let _accessToken: string | null = null

export function setApiToken(token: string | null) {
  _accessToken = token
}

api.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers['Authorization'] = `Bearer ${_accessToken}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      try {
        const { data } = await api.post<TokenResponse>('/auth/refresh')
        setApiToken(data.access_token)
        original.headers['Authorization'] = `Bearer ${data.access_token}`
        return api(original)
      } catch {
        setApiToken(null)
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export interface RegisterPayload {
  email: string
  password: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface TokenResponse {
  access_token: string
  token_type: string
}

export interface UserOut {
  id: number
  email: string
}

export const authApi = {
  register: (payload: RegisterPayload) =>
    api.post<UserOut>('/auth/register', payload),

  login: (payload: LoginPayload) =>
    api.post<TokenResponse>('/auth/login', payload),

  logout: () =>
    api.post('/auth/logout'),

  refresh: () =>
    api.post<TokenResponse>('/auth/refresh'),
}

export default api

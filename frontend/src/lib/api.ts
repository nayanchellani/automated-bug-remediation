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

export interface Project {
  id: number
  name: string
  user_id: number
  created_at: string
}

export interface ApiKeyItem {
  id: number
  project_id: number
  prefix: string
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

export interface ApiKeyCreatedResponse {
  id: number
  project_id: number
  prefix: string
  raw_key: string
  created_at: string
}

export interface Incident {
  id: number
  name: string
  message: string
  file: string | null
  line: number | null
  count: number
  first_seen: string
  last_seen: string
}

export interface SnapshotFile {
  path: string
  size: number
}

export interface Snapshot {
  id: string
  project_id: number
  created_at: string
  sha256: string
  file_count: number
  total_bytes: number
  tree: SnapshotFile[]
}

export interface Dependency {
  id: string
  snapshot_id: string
  ecosystem: string
  name: string
  version: string | null
  is_dev: boolean
  source_file: string
}

export const projectApi = {
  list: () => api.get<Project[]>('/projects'),
  create: (name: string) => api.post<Project>('/projects', { name }),
  get: (id: number) => api.get<Project>(`/projects/${id}`),
  delete: (id: number) => api.delete<{ message: string; id: number }>(`/projects/${id}`),
  listApiKeys: (projectId: number) => api.get<ApiKeyItem[]>(`/projects/${projectId}/api-keys`),
  createApiKey: (projectId: number) => api.post<ApiKeyCreatedResponse>(`/projects/${projectId}/api-keys`),
  revokeApiKey: (projectId: number, keyId: number) => api.delete<{ message: string; id: number }>(`/projects/${projectId}/api-keys/${keyId}`),
  listIncidents: (projectId: number, limit = 20, offset = 0) =>
    api.get<Incident[]>(`/projects/${projectId}/incidents?limit=${limit}&offset=${offset}`),
  getLatestSnapshot: (projectId: number) =>
    api.get<Snapshot>(`/projects/${projectId}/snapshots/latest`),
  getDependencies: (projectId: number) =>
    api.get<Dependency[]>(`/projects/${projectId}/dependencies`),
}

export default api


import axios from 'axios'

export const API_BASE_URL: string = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
).replace(/\/$/, '')

const api = axios.create({
  baseURL: API_BASE_URL,
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

// Single-flight refresh: concurrent 401s share one /auth/refresh call
let refreshPromise: Promise<string> | null = null

function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = api
      .post<TokenResponse>('/auth/refresh')
      .then(({ data }) => {
        setApiToken(data.access_token)
        return data.access_token
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    // Network errors / cancelled requests may carry no config: nothing to retry
    if (!original) return Promise.reject(error)

    // Only attempt refresh if this was NOT already an auth endpoint (to prevent refresh loops)
    const isAuthEndpoint = original.url?.includes('/auth/')
    if (error.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      original._retry = true
      try {
        const token = await refreshAccessToken()
        original.headers['Authorization'] = `Bearer ${token}`
        return api(original)
      } catch {
        setApiToken(null)
        if (window.location.pathname !== '/login' && window.location.pathname !== '/signup') {
          window.location.href = '/login'
        }
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

export interface VulnerabilityOut {
  id: string
  audit_id: string
  osv_id: string
  package_name: string
  ecosystem: string
  installed_version: string | null
  fixed_version: string | null
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  summary: string
}

export interface VulnAuditOut {
  id: string
  project_id: number
  snapshot_id: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  finished_at: string | null
  vuln_count: number
  error: string | null
  vulns: VulnerabilityOut[]
}

export const projectApi = {
  list: () => api.get<Project[]>('/projects'),
  create: (name: string) => api.post<Project>('/projects', { name }),
  get: (id: number) => api.get<Project>(`/projects/${id}`),
  delete: (id: number) => api.delete<{ message: string; id: number }>(`/projects/${id}`),
  listApiKeys: (projectId: number, signal?: AbortSignal) =>
    api.get<ApiKeyItem[]>(`/projects/${projectId}/api-keys`, { signal }),
  createApiKey: (projectId: number) => api.post<ApiKeyCreatedResponse>(`/projects/${projectId}/api-keys`),
  revokeApiKey: (projectId: number, keyId: number) => api.delete<{ message: string; id: number }>(`/projects/${projectId}/api-keys/${keyId}`),
  listIncidents: (projectId: number, limit = 20, offset = 0, signal?: AbortSignal) =>
    api.get<Incident[]>(`/projects/${projectId}/incidents?limit=${limit}&offset=${offset}`, { signal }),
  getLatestSnapshot: (projectId: number, signal?: AbortSignal) =>
    api.get<Snapshot>(`/projects/${projectId}/snapshots/latest`, { signal }),
  getDependencies: (projectId: number, signal?: AbortSignal) =>
    api.get<Dependency[]>(`/projects/${projectId}/dependencies`, { signal }),
  runVulnAudit: (projectId: number) =>
    api.post<VulnAuditOut>(`/projects/${projectId}/vuln-audits`),
  getLatestVulnAudit: (projectId: number, signal?: AbortSignal) =>
    api.get<VulnAuditOut>(`/projects/${projectId}/vuln-audits/latest`, { signal }),
}

export default api


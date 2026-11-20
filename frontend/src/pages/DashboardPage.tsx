import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  projectApi,
  type Project,
  type ApiKeyItem,
  type ApiKeyCreatedResponse,
  type Incident,
  type Snapshot,
  type Dependency,
  type SnapshotFile,
  type VulnAuditOut,
  type VulnerabilityOut,
} from '../lib/api'
import {
  Key,
  Copy,
  Check,
  Trash2,
  AlertTriangle,
  Plus,
  Terminal,
  Shield,
  RefreshCw,
  FolderPlus,
  Bug,
  Activity,
  Layers,
  Package,
  Folder,
  File as FileIcon,
  ChevronRight,
  ChevronDown,
  ShieldAlert,
} from 'lucide-react'

// Tree node structure for collapsible directory view
interface TreeNode {
  name: string
  path: string
  isDir: boolean
  size?: number
  children?: { [key: string]: TreeNode }
}

function buildTree(files: SnapshotFile[]): TreeNode {
  const root: TreeNode = { name: 'root', path: '', isDir: true, children: {} }

  for (const file of files) {
    const parts = file.path.split('/')
    let curr = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const subPath = parts.slice(0, i + 1).join('/')

      if (!curr.children) curr.children = {}

      if (isLast) {
        curr.children[part] = {
          name: part,
          path: subPath,
          isDir: false,
          size: file.size,
        }
      } else {
        if (!curr.children[part]) {
          curr.children[part] = {
            name: part,
            path: subPath,
            isDir: true,
            children: {},
          }
        }
        curr = curr.children[part]
      }
    }
  }

  return root
}

function formatBytes(bytes?: number): string {
  if (!bytes && bytes !== 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileTreeNode({ node }: { node: TreeNode }) {
  const [isOpen, setIsOpen] = useState(true)

  if (!node.isDir) {
    return (
      <div className="flex items-center justify-between py-1 px-2 hover:bg-neutral-900/60 rounded text-xs font-mono text-neutral-300">
        <div className="flex items-center gap-2">
          <FileIcon className="w-3.5 h-3.5 text-neutral-500" />
          <span>{node.name}</span>
        </div>
        <span className="text-neutral-500 text-[11px]">{formatBytes(node.size)}</span>
      </div>
    )
  }

  const childKeys = Object.keys(node.children || {}).sort((a, b) => {
    const aIsDir = node.children![a].isDir
    const bIsDir = node.children![b].isDir
    if (aIsDir && !bIsDir) return -1
    if (!aIsDir && bIsDir) return 1
    return a.localeCompare(b)
  })

  return (
    <div className="text-xs font-mono">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 py-1 px-1.5 hover:bg-neutral-900/60 rounded cursor-pointer select-none text-neutral-200"
      >
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 text-neutral-500" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-neutral-500" />
        )}
        <Folder className="w-3.5 h-3.5 text-amber-500/80 fill-amber-500/20" />
        <span className="font-medium text-neutral-200">{node.name}</span>
      </div>
      {isOpen && (
        <div className="pl-4 border-l border-[#222222] ml-2 mt-0.5 space-y-0.5">
          {childKeys.map((key) => (
            <FileTreeNode key={key} node={node.children![key]} />
          ))}
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: string
}) {
  return (
    <button
      onClick={onClick}
      className={`pb-3 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
        active
          ? 'border-white text-white'
          : 'border-transparent text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {icon}
      {label}
      {badge && (
        <span className="px-1.5 py-0.5 rounded-full bg-neutral-900 border border-[#333] text-[10px] text-neutral-300">
          {badge}
        </span>
      )}
    </button>
  )
}

const INCIDENT_PAGE_SIZE = 20
// Backend caps `limit` at 100 and we request one extra row to detect "has more"
const INCIDENT_MAX_LIMIT = 99
const INCIDENT_POLL_MS = 4000

// navigator.clipboard only exists on secure origins (https / localhost); fall back to execCommand
function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {})
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  try { document.execCommand('copy') } catch { /* nothing else to try */ }
  document.body.removeChild(ta)
}

export default function DashboardPage() {
  const { logout } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState<'incidents' | 'structure' | 'libraries' | 'security' | 'apikeys'>('incidents')

  // Incidents state
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loadingIncidents, setLoadingIncidents] = useState(true)
  const [incidentLimit, setIncidentLimit] = useState(INCIDENT_PAGE_SIZE)
  const [hasMoreIncidents, setHasMoreIncidents] = useState(false)
  const [incidentsError, setIncidentsError] = useState<string | null>(null)

  // Snapshot / Structure state
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)

  // Libraries / Dependencies state
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [loadingDependencies, setLoadingDependencies] = useState(false)

  // Vuln Audit state
  const [vulnAudit, setVulnAudit] = useState<VulnAuditOut | null>(null)
  const [loadingVulnAudit, setLoadingVulnAudit] = useState(false)
  const [runningAudit, setRunningAudit] = useState(false)
  const [vulnAuditError, setVulnAuditError] = useState<string | null>(null)

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKeyItem[]>([])
  const [loadingKeys, setLoadingKeys] = useState(true)
  const [creatingKey, setCreatingKey] = useState(false)
  const [revokingId, setRevokingId] = useState<number | null>(null)
  const [createdKeyData, setCreatedKeyData] = useState<ApiKeyCreatedResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Project creation state
  const [showNewProjectModal, setShowNewProjectModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [creatingProject, setCreatingProject] = useState(false)

  const loadProjects = useCallback(async () => {
    try {
      const res = await projectApi.list()
      setProjects(res.data)
      if (res.data.length > 0) {
        setSelectedProject((prev) => {
          if (prev && res.data.some((p) => p.id === prev.id)) {
            return prev
          }
          return res.data[0]
        })
      } else {
        setSelectedProject(null)
      }
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to load projects')
    }
  }, [])

  // Every loader takes an AbortSignal: when the project changes (or the page unmounts) the
  // in-flight requests are cancelled and their results are ignored, so a slow response for
  // the previous project can never overwrite the current project's data.
  const loadApiKeys = useCallback(async (projectId: number, signal?: AbortSignal) => {
    try {
      const res = await projectApi.listApiKeys(projectId, signal)
      if (signal?.aborted) return
      setApiKeys(res.data)
    } catch (err: any) {
      if (signal?.aborted) return
      setErrorMsg(err.response?.data?.detail || 'Failed to load API keys')
    } finally {
      if (!signal?.aborted) setLoadingKeys(false)
    }
  }, [])

  const loadIncidents = useCallback(
    async (projectId: number, limit: number, signal?: AbortSignal, isInitial = false) => {
      try {
        // Ask for one extra row so we know whether more incidents exist
        const res = await projectApi.listIncidents(projectId, limit + 1, 0, signal)
        if (signal?.aborted) return
        setHasMoreIncidents(res.data.length > limit)
        setIncidents(res.data.slice(0, limit))
        setIncidentsError(null)
      } catch (err: any) {
        if (signal?.aborted) return
        setIncidentsError(err.response?.data?.detail || 'Could not reach the server')
      } finally {
        if (isInitial && !signal?.aborted) setLoadingIncidents(false)
      }
    },
    [],
  )

  const loadSnapshot = useCallback(async (projectId: number, signal?: AbortSignal) => {
    try {
      const res = await projectApi.getLatestSnapshot(projectId, signal)
      if (signal?.aborted) return
      setSnapshot(res.data)
    } catch {
      if (signal?.aborted) return
      setSnapshot(null)
    } finally {
      if (!signal?.aborted) setLoadingSnapshot(false)
    }
  }, [])

  const loadDependencies = useCallback(async (projectId: number, signal?: AbortSignal) => {
    try {
      const res = await projectApi.getDependencies(projectId, signal)
      if (signal?.aborted) return
      setDependencies(res.data)
    } catch {
      if (signal?.aborted) return
      setDependencies([])
    } finally {      if (!signal?.aborted) setLoadingDependencies(false)
    }
  }, [])

  const loadVulnAudit = useCallback(async (projectId: number, signal?: AbortSignal) => {
    setLoadingVulnAudit(true)
    setVulnAuditError(null)
    try {
      const res = await projectApi.getLatestVulnAudit(projectId, signal)
      if (signal?.aborted) return
      setVulnAudit(res.data)
    } catch (err: any) {
      if (signal?.aborted) return
      if (err.response?.status === 404) {
        setVulnAudit(null)
      } else {
        setVulnAuditError(err.response?.data?.detail || 'Failed to load audit')
      }
    } finally {
      if (!signal?.aborted) setLoadingVulnAudit(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line -- initial fetch; setState happens after the await
    void loadProjects()
  }, [loadProjects])

  const projectId = selectedProject?.id ?? null
  // Controller of the current project's requests (also used by "Load more")
  const projectControllerRef = useRef<AbortController | null>(null)

  // Load everything for the selected project. Previous project's data is cleared immediately.
  const [prevProjectId, setPrevProjectId] = useState(projectId)
  if (prevProjectId !== projectId) {
    // Reset during render (not in an effect) so no frame shows the previous project's data
    setPrevProjectId(projectId)
    setApiKeys([])
    setIncidents([])
    setHasMoreIncidents(false)
    setIncidentsError(null)
    setIncidentLimit(INCIDENT_PAGE_SIZE)
    setSnapshot(null)
    setDependencies([])
    setVulnAudit(null)
    setVulnAuditError(null)
    // Loading flags are raised here too, so the fetch effect never sets state synchronously
    const loading = projectId !== null
    setLoadingKeys(loading)
    setLoadingIncidents(loading)
    setLoadingSnapshot(loading)
    setLoadingDependencies(loading)
  }

  useEffect(() => {
    if (projectId === null) return

    const controller = new AbortController()
    projectControllerRef.current = controller
    // Loaders only set state after an await, so nothing runs synchronously in this effect
    // oxlint-disable-next-line react/set-state-in-effect
    loadApiKeys(projectId, controller.signal)
    loadIncidents(projectId, INCIDENT_PAGE_SIZE, controller.signal, true)
    loadSnapshot(projectId, controller.signal)
    loadDependencies(projectId, controller.signal)
    loadVulnAudit(projectId, controller.signal)

    return () => controller.abort()
  }, [projectId, loadApiKeys, loadIncidents, loadSnapshot, loadDependencies, loadVulnAudit])

  // Poll incidents only while the Incidents tab is open and the browser tab is visible
  useEffect(() => {
    if (projectId === null || activeTab !== 'incidents') return

    let controller: AbortController | null = null
    const poll = () => {
      if (document.hidden) return
      controller?.abort()
      controller = new AbortController()
      loadIncidents(projectId, incidentLimit, controller.signal)
    }

    const timer = setInterval(poll, INCIDENT_POLL_MS)
    const onVisibilityChange = () => {
      if (!document.hidden) poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      controller?.abort()
    }
  }, [projectId, activeTab, incidentLimit, loadIncidents])

  const handleLoadMoreIncidents = () => {
    if (projectId === null) return
    const next = Math.min(incidentLimit + INCIDENT_PAGE_SIZE, INCIDENT_MAX_LIMIT)
    setIncidentLimit(next)
    loadIncidents(projectId, next, projectControllerRef.current?.signal)
  }

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjectName.trim()) return
    try {
      setCreatingProject(true)
      setErrorMsg(null)
      const res = await projectApi.create(newProjectName.trim())
      setProjects((prev) => [...prev, res.data])
      setSelectedProject(res.data)
      setNewProjectName('')
      setShowNewProjectModal(false)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to create project')
    } finally {
      setCreatingProject(false)
    }
  }

  const handleCreateApiKey = async () => {
    if (!selectedProject) return
    try {
      setCreatingKey(true)
      setErrorMsg(null)
      const res = await projectApi.createApiKey(selectedProject.id)
      setCreatedKeyData(res.data)
      await loadApiKeys(selectedProject.id)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to generate API key')
    } finally {
      setCreatingKey(false)
    }
  }

  const handleRevokeKey = async (keyId: number) => {
    if (!selectedProject) return
    if (!window.confirm('Are you sure you want to revoke this API key? This action cannot be undone.')) {
      return
    }
    try {
      setRevokingId(keyId)
      await projectApi.revokeApiKey(selectedProject.id, keyId)
      await loadApiKeys(selectedProject.id)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to revoke API key')
    } finally {
      setRevokingId(null)
    }
  }

  const handleRunAudit = async () => {
    if (!selectedProject) return
    try {
      setRunningAudit(true)
      setVulnAuditError(null)
      const res = await projectApi.runVulnAudit(selectedProject.id)
      setVulnAudit(res.data)
    } catch (err: any) {
      setVulnAuditError(err.response?.data?.detail || 'Audit failed')
    } finally {
      setRunningAudit(false)
    }
  }

  const handleCopyKey = () => {
    if (!createdKeyData) return
    const textToCopy = `TRIAGE_API_KEY=${createdKeyData.raw_key}`
    copyText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fileTree = useMemo(() => {
    if (!snapshot || !snapshot.tree) return null
    return buildTree(snapshot.tree)
  }, [snapshot])

  return (
    <div className="min-h-screen bg-black text-white flex flex-col font-sans selection:bg-neutral-800">
      {/* Top Navbar */}
      <nav className="border-b border-[#333333] px-6 py-4 flex items-center justify-between bg-black/50 backdrop-blur sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
          <span className="text-sm font-semibold tracking-tight">Triage Engine</span>
          <span className="text-xs px-2 py-0.5 rounded border border-[#333333] text-neutral-400 bg-neutral-900">
            Console
          </span>
        </div>
        <div className="flex items-center gap-4">
          <button
            id="logout-btn"
            onClick={logout}
            className="btn-outline text-xs px-3 py-1.5 hover:bg-neutral-900"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-10 space-y-8">
        {/* Project Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-[#222222]">
          <div>
            <div className="text-xs uppercase tracking-wider text-neutral-500 font-mono mb-1">Active Project</div>
            <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
              {selectedProject?.name || 'Loading project...'}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {projects.length > 1 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-neutral-400">Switch:</span>
                <select
                  className="bg-neutral-950 border border-[#333333] text-xs px-2.5 py-1.5 text-white rounded focus:outline-none focus:border-white"
                  value={selectedProject?.id || ''}
                  onChange={(e) => {
                    const p = projects.find((proj) => proj.id === Number(e.target.value))
                    if (p) setSelectedProject(p)
                  }}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <button
              id="create-project-btn"
              onClick={() => setShowNewProjectModal(true)}
              className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5 hover:bg-neutral-900 cursor-pointer"
            >
              <FolderPlus className="w-3.5 h-3.5 text-neutral-400" />
              New Project
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-950/40 border border-red-800 text-red-300 text-xs rounded flex items-center justify-between">
            <span>{errorMsg}</span>
            <button onClick={() => setErrorMsg(null)} className="text-neutral-400 hover:text-white ml-2">×</button>
          </div>
        )}

        {/* Tab Switcher (scrolls horizontally on narrow screens) */}
        <div className="flex items-center gap-4 border-b border-[#222222] overflow-x-auto">
          <TabButton active={activeTab === 'incidents'} onClick={() => setActiveTab('incidents')} icon={<Activity className="w-4 h-4" />} label="Runtime Incidents" badge={incidents.length > 0 ? `${incidents.length}${hasMoreIncidents ? '+' : ''}` : undefined} />
          <TabButton active={activeTab === 'structure'} onClick={() => setActiveTab('structure')} icon={<Layers className="w-4 h-4" />} label="Structure" badge={snapshot ? `${snapshot.file_count} files` : undefined} />
          <TabButton active={activeTab === 'libraries'} onClick={() => setActiveTab('libraries')} icon={<Package className="w-4 h-4" />} label="Libraries" badge={dependencies.length > 0 ? String(dependencies.length) : undefined} />
          <TabButton active={activeTab === 'security'} onClick={() => setActiveTab('security')} icon={<ShieldAlert className="w-4 h-4" />} label="Security" badge={vulnAudit ? String(vulnAudit.vuln_count) : undefined} />
          <TabButton active={activeTab === 'apikeys'} onClick={() => setActiveTab('apikeys')} icon={<Key className="w-4 h-4" />} label="API Keys & Telemetry" />
        </div>

        {/* Incidents Tab */}
        {activeTab === 'incidents' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
                  <Bug className="w-4 h-4 text-rose-400" />
                  Live Runtime Incidents
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Deduplicated runtime errors captured in real-time from your SDK telemetry.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {incidentsError ? (
                  <>
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-[11px] text-red-400 font-mono" title={incidentsError}>
                      Updates paused, retrying...
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[11px] text-neutral-400 font-mono">Live (polling 4s)</span>
                  </>
                )}
              </div>
            </div>

            <div className="border border-[#262626] bg-[#0c0c0c] rounded-lg overflow-hidden shadow-sm">
              {loadingIncidents ? (
                <div className="p-8 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-neutral-400" />
                  Fetching incidents...
                </div>
              ) : incidents.length === 0 ? (
                <div className="p-10 text-center space-y-4">
                  <div className="w-10 h-10 rounded-full bg-neutral-900 border border-[#222] mx-auto flex items-center justify-center">
                    <Activity className="w-5 h-5 text-neutral-500 animate-pulse" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-neutral-300">Waiting for first event...</p>
                    <p className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
                      Initialize the SDK in your codebase. Once an uncaught exception or crash occurs, it will automatically appear here.
                    </p>
                  </div>
                  <div className="max-w-md mx-auto text-left bg-black border border-[#222] rounded p-3 font-mono text-xs text-neutral-300 space-y-2">
                    <div className="text-neutral-500 text-[11px] font-sans"># 1. Install SDK</div>
                    <div className="text-neutral-200">npm install @triage/sdk</div>
                    <div className="text-neutral-500 text-[11px] font-sans pt-1"># 2. Add to server entry</div>
                    <div className="text-neutral-400">
                      import &#123; init &#125; from '@triage/sdk'<br/>
                      init(&#123; apiKey: process.env.TRIAGE_API_KEY &#125;)
                    </div>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#222222] bg-[#111111]/80 text-neutral-400">
                        <th className="py-3 px-4 font-medium">Error Name</th>
                        <th className="py-3 px-4 font-medium">Message</th>
                        <th className="py-3 px-4 font-medium">Location</th>
                        <th className="py-3 px-4 font-medium text-center">Occurrences</th>
                        <th className="py-3 px-4 font-medium text-right">Last Seen</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1c1c1c]">
                      {incidents.map((item) => (
                        <tr key={item.id} className="hover:bg-neutral-900/40 transition-colors">
                          <td className="py-3.5 px-4 font-mono font-semibold text-rose-400">
                            {item.name}
                          </td>
                          <td className="py-3.5 px-4 text-neutral-300 max-w-xs truncate" title={item.message}>
                            {item.message}
                          </td>
                          <td className="py-3.5 px-4 font-mono text-neutral-400">
                            {item.file ? (
                              <span>
                                {item.file}{item.line ? `:${item.line}` : ''}
                              </span>
                            ) : (
                              <span className="text-neutral-600">—</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 text-center">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-neutral-900 border border-[#333] text-neutral-200 font-mono font-bold">
                              {item.count}×
                            </span>
                          </td>
                          <td className="py-3.5 px-4 text-neutral-400 text-right whitespace-nowrap font-mono text-[11px]">
                            {new Date(item.last_seen).toLocaleTimeString(undefined, {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!loadingIncidents && incidents.length > 0 && (hasMoreIncidents || incidentLimit > INCIDENT_PAGE_SIZE) && (
                <div className="border-t border-[#222222] p-3 flex items-center justify-center gap-3 text-[11px] text-neutral-500">
                  <span>Showing {incidents.length} incidents</span>
                  {hasMoreIncidents && incidentLimit < INCIDENT_MAX_LIMIT && (
                    <button onClick={handleLoadMoreIncidents} className="btn-outline text-[11px] px-3 py-1 cursor-pointer">
                      Load more
                    </button>
                  )}
                  {hasMoreIncidents && incidentLimit >= INCIDENT_MAX_LIMIT && <span>(latest {INCIDENT_MAX_LIMIT} shown)</span>}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Structure Tab (File Tree) */}
        {activeTab === 'structure' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-cyan-400" />
                  Project Structure
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Codebase file tree archived during snapshot push.
                </p>
              </div>
              {snapshot && (
                <div className="text-xs text-neutral-400 font-mono">
                  Last pushed {new Date(snapshot.created_at).toLocaleString()} • {formatBytes(snapshot.total_bytes)}
                </div>
              )}
            </div>

            <div className="border border-[#262626] bg-[#0c0c0c] rounded-lg p-5">
              {loadingSnapshot ? (
                <div className="p-8 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-neutral-400" />
                  Loading file tree...
                </div>
              ) : !snapshot || !fileTree || Object.keys(fileTree.children || {}).length === 0 ? (
                <div className="p-10 text-center space-y-4">
                  <div className="w-10 h-10 rounded-full bg-neutral-900 border border-[#222] mx-auto flex items-center justify-center">
                    <Layers className="w-5 h-5 text-neutral-500" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-neutral-300">No snapshot uploaded yet</p>
                    <p className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
                      Run the Triage CLI from your project root to capture and upload a snapshot of your repository.
                    </p>
                  </div>
                  <div className="max-w-md mx-auto text-left bg-black border border-[#222] rounded p-3 font-mono text-xs text-neutral-300">
                    <div className="text-neutral-500 text-[11px] font-sans pb-1"># In your project folder:</div>
                    <div>npx triage push</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  {Object.keys(fileTree.children || {})
                    .sort((a, b) => {
                      const aIsDir = fileTree.children![a].isDir
                      const bIsDir = fileTree.children![b].isDir
                      if (aIsDir && !bIsDir) return -1
                      if (!aIsDir && bIsDir) return 1
                      return a.localeCompare(b)
                    })
                    .map((childKey) => (
                      <FileTreeNode key={childKey} node={fileTree.children![childKey]} />
                    ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Libraries Tab (Dependencies) */}
        {activeTab === 'libraries' && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
                  <Package className="w-4 h-4 text-emerald-400" />
                  Libraries & Packages
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Parsed server-side from lockfiles and manifests for OSV vulnerability auditing.
                </p>
              </div>
              {dependencies.length > 0 && (
                <span className="text-xs text-neutral-400 font-mono">
                  {dependencies.length} packages discovered
                </span>
              )}
            </div>

            <div className="border border-[#262626] bg-[#0c0c0c] rounded-lg overflow-hidden shadow-sm">
              {loadingDependencies ? (
                <div className="p-8 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-neutral-400" />
                  Loading dependencies...
                </div>
              ) : dependencies.length === 0 ? (
                <div className="p-10 text-center space-y-4">
                  <div className="w-10 h-10 rounded-full bg-neutral-900 border border-[#222] mx-auto flex items-center justify-center">
                    <Package className="w-5 h-5 text-neutral-500" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-neutral-300">No libraries discovered</p>
                    <p className="text-xs text-neutral-500 max-w-md mx-auto leading-relaxed">
                      Upload a snapshot containing a <span className="font-mono text-neutral-300">package-lock.json</span>, <span className="font-mono text-neutral-300">package.json</span>, or <span className="font-mono text-neutral-300">requirements.txt</span>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#222222] bg-[#111111]/80 text-neutral-400">
                        <th className="py-3 px-4 font-medium">Package Name</th>
                        <th className="py-3 px-4 font-medium">Version</th>
                        <th className="py-3 px-4 font-medium">Type</th>
                        <th className="py-3 px-4 font-medium">Ecosystem</th>
                        <th className="py-3 px-4 font-medium text-right">Manifest</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1c1c1c]">
                      {dependencies.map((dep) => (
                        <tr key={dep.id} className="hover:bg-neutral-900/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-medium text-neutral-200">
                            {dep.name}
                          </td>
                          <td className="py-3 px-4 font-mono">
                            {dep.version ? (
                              <span className="text-emerald-400 bg-emerald-950/40 px-1.5 py-0.5 rounded border border-emerald-900/50">
                                {dep.version}
                              </span>
                            ) : (
                              <span className="text-amber-400 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-900/50" title="Approximate or unpinned version">
                                approx / unknown
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {dep.is_dev ? (
                              <span className="text-neutral-400 bg-neutral-900 px-1.5 py-0.5 rounded border border-[#333] text-[10px]">
                                dev
                              </span>
                            ) : (
                              <span className="text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-900/50 text-[10px]">
                                prod
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-400">
                            {dep.ecosystem}
                          </td>
                          <td className="py-3 px-4 font-mono text-neutral-500 text-right">
                            {dep.source_file}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Security / Vuln Audit Tab */}
        {activeTab === 'security' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-orange-400" />
                  Dependency Vulnerability Audit
                </h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Checks all dependencies in the latest snapshot against OSV.dev (CVEs &amp; GHSA advisories).
                </p>
              </div>
              <button
                onClick={handleRunAudit}
                disabled={runningAudit}
                className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5 hover:bg-neutral-900 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${runningAudit ? 'animate-spin' : ''}`} />
                {runningAudit ? 'Scanning…' : 'Run Audit'}
              </button>
            </div>

            {vulnAuditError && (
              <div className="p-3 bg-red-950/40 border border-red-800 text-red-300 text-xs rounded">
                {vulnAuditError}
              </div>
            )}

            {loadingVulnAudit && (
              <div className="text-xs text-neutral-500 py-8 text-center">Loading…</div>
            )}

            {!loadingVulnAudit && !vulnAudit && !vulnAuditError && (
              <div className="text-xs text-neutral-500 py-8 text-center border border-dashed border-[#333] rounded-lg">
                No audit yet — click <span className="text-white font-medium">Run Audit</span> to scan dependencies.
              </div>
            )}

            {!loadingVulnAudit && vulnAudit && (
              <>
                <div className="flex items-center gap-6 text-xs text-neutral-400 border border-[#2a2a2a] rounded-lg px-4 py-3 bg-neutral-950/40">
                  <span>Status: <span className={vulnAudit.status === 'completed' ? 'text-green-400' : vulnAudit.status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>{vulnAudit.status}</span></span>
                  <span>Vulnerabilities found: <span className="text-white font-semibold">{vulnAudit.vuln_count}</span></span>
                  {vulnAudit.finished_at && (
                    <span>Scanned: <span className="text-neutral-300">{new Date(vulnAudit.finished_at).toLocaleString()}</span></span>
                  )}
                </div>

                {vulnAudit.error && (
                  <div className="text-xs text-red-300 p-3 bg-red-950/30 border border-red-800 rounded">
                    Error: {vulnAudit.error}
                  </div>
                )}

                {vulnAudit.vulns.length > 0 ? (
                  <div className="border border-[#2a2a2a] rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[#2a2a2a] bg-neutral-950/60">
                          <th className="text-left px-4 py-2.5 text-neutral-400 font-medium">Package</th>
                          <th className="text-left px-4 py-2.5 text-neutral-400 font-medium">Ecosystem</th>
                          <th className="text-left px-4 py-2.5 text-neutral-400 font-medium">Installed</th>
                          <th className="text-left px-4 py-2.5 text-neutral-400 font-medium">Fix available</th>
                          <th className="text-left px-4 py-2.5 text-neutral-400 font-medium">Severity</th>
                          <th className="text-left px-4 py-2.5 text-neutral-400 font-medium">Advisory</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1e1e1e]">
                        {vulnAudit.vulns
                          .slice()
                          .sort((a, b) => {
                            const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }
                            return (order[a.severity] ?? 4) - (order[b.severity] ?? 4)
                          })
                          .map((v: VulnerabilityOut) => (
                            <tr key={v.id} className="hover:bg-neutral-900/40 transition-colors">
                              <td className="px-4 py-2.5 font-mono text-neutral-200">{v.package_name}</td>
                              <td className="px-4 py-2.5 text-neutral-400">{v.ecosystem}</td>
                              <td className="px-4 py-2.5 font-mono text-neutral-400">{v.installed_version ?? '—'}</td>
                              <td className="px-4 py-2.5 font-mono">
                                {v.fixed_version
                                  ? <span className="text-green-400">{v.fixed_version}</span>
                                  : <span className="text-neutral-600">—</span>}
                              </td>
                              <td className="px-4 py-2.5">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                                  v.severity === 'CRITICAL' ? 'bg-red-950/60 text-red-300 border border-red-800'
                                  : v.severity === 'HIGH' ? 'bg-orange-950/60 text-orange-300 border border-orange-800'
                                  : v.severity === 'MEDIUM' ? 'bg-yellow-950/60 text-yellow-300 border border-yellow-800'
                                  : 'bg-blue-950/60 text-blue-300 border border-blue-800'
                                }`}>
                                  {v.severity}
                                </span>
                              </td>
                              <td className="px-4 py-2.5">
                                <a
                                  href={`https://osv.dev/vulnerability/${v.osv_id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-mono text-neutral-400 hover:text-white underline underline-offset-2"
                                  title={v.summary}
                                >
                                  {v.osv_id}
                                </a>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-green-400 py-6 text-center border border-dashed border-green-900/50 rounded-lg bg-green-950/10">
                    ✓ No known vulnerabilities found in this snapshot's dependencies.
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* API Keys Tab */}
        {activeTab === 'apikeys' && (          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight text-white flex items-center gap-2">
                  <Key className="w-4 h-4 text-neutral-400" />
                  API Keys
                </h2>
                <p className="text-xs text-neutral-400 mt-0.5">
                  Secret keys used by the SDKs and CLI to authenticate telemetry and snapshot uploads (limit: 5 active keys).
                </p>
              </div>
              <button
                id="create-api-key-btn"
                onClick={handleCreateApiKey}
                disabled={creatingKey || !selectedProject}
                className="btn-primary text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {creatingKey ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Create API Key
              </button>
            </div>

            {/* Keys List */}
            <div className="border border-[#262626] bg-[#0c0c0c] rounded-lg overflow-hidden shadow-sm">
              {loadingKeys ? (
                <div className="p-8 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-neutral-400" />
                  Loading credentials...
                </div>
              ) : apiKeys.length === 0 ? (
                <div className="p-10 text-center space-y-3">
                  <div className="w-10 h-10 rounded-full bg-neutral-900 border border-[#222] mx-auto flex items-center justify-center">
                    <Key className="w-5 h-5 text-neutral-500" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-neutral-300">No API keys yet</p>
                    <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                      Generate an API key and add it to your application to start capturing runtime errors.
                    </p>
                  </div>
                  {selectedProject && (
                    <button
                      onClick={handleCreateApiKey}
                      className="btn-outline text-xs inline-flex items-center gap-1.5 mt-2"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Generate First Key
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#222222] bg-[#111111]/80 text-neutral-400">
                        <th className="py-3 px-4 font-medium">Key Prefix</th>
                        <th className="py-3 px-4 font-medium">Created</th>
                        <th className="py-3 px-4 font-medium">Last Used</th>
                        <th className="py-3 px-4 font-medium">Status</th>
                        <th className="py-3 px-4 font-medium text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1c1c1c]">
                      {apiKeys.map((key) => {
                        const isRevoked = Boolean(key.revoked_at)
                        return (
                          <tr key={key.id} className="hover:bg-neutral-900/40 transition-colors">
                            <td className="py-3.5 px-4 font-mono font-medium text-neutral-200">
                              <span className="bg-neutral-900 px-2 py-0.5 rounded border border-[#2a2a2a]">
                                {key.prefix}...
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-neutral-400">
                              {new Date(key.created_at).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </td>
                            <td className="py-3.5 px-4 text-neutral-400">
                              {key.last_used_at ? (
                                new Date(key.last_used_at).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              ) : (
                                <span className="text-neutral-600">Never</span>
                              )}
                            </td>
                            <td className="py-3.5 px-4">
                              {isRevoked ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-red-950/60 text-red-400 border border-red-900/50">
                                  <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                                  Revoked
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-950/60 text-emerald-400 border border-emerald-900/50">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  Active
                                </span>
                              )}
                            </td>
                            <td className="py-3.5 px-4 text-right">
                              {!isRevoked && (
                                <button
                                  onClick={() => handleRevokeKey(key.id)}
                                  disabled={revokingId === key.id}
                                  className="text-neutral-400 hover:text-red-400 transition-colors inline-flex items-center gap-1 p-1 rounded hover:bg-neutral-800 disabled:opacity-50"
                                  title="Revoke API Key"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span className="text-[11px]">Revoke</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Integration Guide Box (only relevant next to the API keys) */}
        {activeTab === 'apikeys' && (
          <section className="border border-[#222222] bg-[#0a0a0a] rounded-lg p-5 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">
              <Terminal className="w-4 h-4 text-neutral-300" />
              Quick Setup
            </div>
            <p className="text-xs text-neutral-400 leading-relaxed">
              Configure your environment with your generated key to begin capturing crashes:
            </p>
            <div className="bg-black border border-[#222] p-3 rounded font-mono text-xs text-neutral-300 select-all">
              TRIAGE_API_KEY=tk_live_...
            </div>
          </section>
        )}
      </main>

      {/* New Project Modal */}
      {showNewProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0f0f0f] border border-[#333333] max-w-md w-full p-6 rounded-xl shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5">
              <FolderPlus className="w-5 h-5 text-white" />
              <h3 className="text-base font-semibold text-white">Create New Project</h3>
            </div>
            <form onSubmit={handleCreateProject} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-neutral-400">Project Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. backend-api, web-app"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  className="input-field rounded-md"
                  autoFocus
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewProjectModal(false)}
                  className="btn-outline text-xs px-3 py-1.5"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProject || !newProjectName.trim()}
                  className="btn-primary text-xs px-4 py-1.5 disabled:opacity-50"
                >
                  {creatingProject ? 'Creating...' : 'Create Project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Secret Key Modal */}
      {createdKeyData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="bg-[#0f0f0f] border border-[#333333] max-w-lg w-full p-6 rounded-xl shadow-2xl space-y-5 animate-scale-up">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-neutral-900 border border-[#333] text-white">
                <Shield className="w-5 h-5 text-emerald-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-semibold text-white">Save your API Key</h3>
                <p className="text-xs text-neutral-400">
                  Your new API key has been created for project <span className="text-white font-medium">{selectedProject?.name}</span>.
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-950/40 border border-amber-800/60 rounded-md flex items-start gap-2.5 text-amber-200">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs space-y-0.5 leading-relaxed">
                <span className="font-semibold block">You won't see this again!</span>
                <span>Make sure to copy your API key now. We do not store the unhashed key and cannot recover it later.</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] uppercase tracking-wider text-neutral-400 font-mono">
                Environment Variable
              </label>
              <div className="flex items-center gap-2 bg-black border border-[#333333] p-2.5 rounded-lg group focus-within:border-white transition-colors">
                <input
                  type="text"
                  readOnly
                  value={`TRIAGE_API_KEY=${createdKeyData.raw_key}`}
                  className="bg-transparent font-mono text-xs text-neutral-200 w-full focus:outline-none select-all"
                  id="api-key-display-input"
                />
                <button
                  id="copy-key-btn"
                  onClick={handleCopyKey}
                  className="px-3 py-1 bg-white text-black text-xs font-semibold rounded hover:bg-neutral-200 transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-black" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                id="close-modal-btn"
                onClick={() => setCreatedKeyData(null)}
                className="btn-outline text-xs px-4 py-2 hover:bg-neutral-900"
              >
                I have saved my key
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

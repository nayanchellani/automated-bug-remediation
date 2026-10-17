import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '../context/AuthContext'
import {
  projectApi,
  Project,
  ApiKeyItem,
  ApiKeyCreatedResponse,
  Incident,
  Snapshot,
  Dependency,
  SnapshotFile,
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

export default function DashboardPage() {
  const { logout } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [activeTab, setActiveTab] = useState<'incidents' | 'structure' | 'libraries' | 'apikeys'>('incidents')

  // Incidents state
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loadingIncidents, setLoadingIncidents] = useState(true)

  // Snapshot / Structure state
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)

  // Libraries / Dependencies state
  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [loadingDependencies, setLoadingDependencies] = useState(false)

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

  const loadApiKeys = useCallback(async (projectId: number) => {
    try {
      setLoadingKeys(true)
      const res = await projectApi.listApiKeys(projectId)
      setApiKeys(res.data)
    } catch (err: any) {
      setErrorMsg(err.response?.data?.detail || 'Failed to load API keys')
    } finally {
      setLoadingKeys(false)
    }
  }, [])

  const loadIncidents = useCallback(async (projectId: number, isInitial = false) => {
    try {
      if (isInitial) setLoadingIncidents(true)
      const res = await projectApi.listIncidents(projectId)
      setIncidents(res.data)
    } catch (err: any) {
      console.error('Failed to poll incidents', err)
    } finally {
      if (isInitial) setLoadingIncidents(false)
    }
  }, [])

  const loadSnapshot = useCallback(async (projectId: number) => {
    try {
      setLoadingSnapshot(true)
      const res = await projectApi.getLatestSnapshot(projectId)
      setSnapshot(res.data)
    } catch {
      setSnapshot(null)
    } finally {
      setLoadingSnapshot(false)
    }
  }, [])

  const loadDependencies = useCallback(async (projectId: number) => {
    try {
      setLoadingDependencies(true)
      const res = await projectApi.getDependencies(projectId)
      setDependencies(res.data)
    } catch {
      setDependencies([])
    } finally {
      setLoadingDependencies(false)
    }
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (selectedProject) {
      loadApiKeys(selectedProject.id)
      loadIncidents(selectedProject.id, true)
      loadSnapshot(selectedProject.id)
      loadDependencies(selectedProject.id)

      const timer = setInterval(() => {
        loadIncidents(selectedProject.id, false)
      }, 4000)
      return () => clearInterval(timer)
    } else {
      setApiKeys([])
      setIncidents([])
      setSnapshot(null)
      setDependencies([])
    }
  }, [selectedProject, loadApiKeys, loadIncidents, loadSnapshot, loadDependencies])

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

  const handleCopyKey = () => {
    if (!createdKeyData) return
    const textToCopy = `TRIAGE_API_KEY=${createdKeyData.raw_key}`
    navigator.clipboard.writeText(textToCopy)
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

        {/* Tab Switcher */}
        <div className="flex items-center gap-4 border-b border-[#222222]">
          <button
            onClick={() => setActiveTab('incidents')}
            className={`pb-3 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'incidents'
                ? 'border-white text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Activity className="w-4 h-4" />
            Runtime Incidents
            {incidents.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-neutral-900 border border-[#333] text-[10px] text-neutral-300">
                {incidents.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('structure')}
            className={`pb-3 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'structure'
                ? 'border-white text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            Structure
            {snapshot && (
              <span className="px-1.5 py-0.2 rounded-full bg-neutral-900 border border-[#333] text-[10px] text-neutral-300">
                {snapshot.file_count} files
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('libraries')}
            className={`pb-3 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'libraries'
                ? 'border-white text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Package className="w-4 h-4" />
            Libraries
            {dependencies.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-neutral-900 border border-[#333] text-[10px] text-neutral-300">
                {dependencies.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('apikeys')}
            className={`pb-3 text-xs font-medium flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
              activeTab === 'apikeys'
                ? 'border-white text-white'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Key className="w-4 h-4" />
            API Keys & Telemetry
          </button>
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
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] text-neutral-400 font-mono">Live (polling 4s)</span>
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

        {/* API Keys Tab */}
        {activeTab === 'apikeys' && (
          <section className="space-y-6">
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

        {/* Integration Guide Box */}
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

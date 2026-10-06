import { useAuth } from '../context/AuthContext'

export default function DashboardPage() {
  const { logout } = useAuth()

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <nav className="border-b border-[#333333] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-white" />
          <span className="text-sm font-medium tracking-tight">Triage Engine</span>
        </div>
        <button
          id="logout-btn"
          onClick={logout}
          className="btn-outline text-xs px-3 py-1.5"
        >
          Sign out
        </button>
      </nav>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-neutral-400">You're signed in. Coming soon.</p>
        </div>
      </div>
    </div>
  )
}

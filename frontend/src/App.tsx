import React from 'react'

function App() {
  return (
    <div className="min-h-screen bg-black text-white p-12 selection:bg-neutral-800">
      <div className="max-w-2xl mx-auto space-y-12">
        <header className="space-y-4 border-b border-[#333333] pb-8">
          <h1 className="text-4xl font-semibold tracking-tight">Triage Engine</h1>
          <p className="text-neutral-400 text-sm">
            AI-assisted bug triage and remediation platform.
          </p>
        </header>
        
        <main className="space-y-8">
          <div className="card space-y-6">
            <div className="space-y-2">
              <h2 className="text-xl font-medium tracking-tight">Authentication</h2>
              <p className="text-sm text-neutral-400">Sign in to manage your projects and deployments.</p>
            </div>
            
            <form className="space-y-4" onSubmit={(e) => e.preventDefault()}>
              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Email</label>
                <input type="email" placeholder="dev@example.com" className="input-field" />
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-medium text-neutral-400 uppercase tracking-wider">Password</label>
                <input type="password" placeholder="••••••••" className="input-field" />
              </div>
              
              <div className="pt-2 flex items-center gap-4">
                <button type="button" className="btn-primary">Sign In</button>
                <button type="button" className="btn-outline">Create Account</button>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App

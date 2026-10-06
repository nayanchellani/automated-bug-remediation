import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi, setApiToken } from '../lib/api'
import { useAuth } from '../context/AuthContext'

export default function SignupPage() {
  const navigate = useNavigate()
  const { setAccessToken } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      await authApi.register({ email, password })
      const { data } = await authApi.login({ email, password })
      setApiToken(data.access_token)
      setAccessToken(data.access_token)
      navigate('/dashboard')
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      <nav className="border-b border-[#333333] px-6 py-4 flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-white" />
        <span className="text-sm font-medium tracking-tight">Triage Engine</span>
      </nav>

      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
            <p className="text-sm text-neutral-400">
              Start triaging bugs and shipping fixes faster.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="signup-email" className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
                Email
              </label>
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                required
                placeholder="dev@example.com"
                className="input-field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="signup-password" className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
                Password
              </label>
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                placeholder="Min. 8 characters"
                className="input-field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="signup-confirm" className="text-xs font-medium text-neutral-400 uppercase tracking-wider">
                Confirm Password
              </label>
              <input
                id="signup-confirm"
                type="password"
                autoComplete="new-password"
                required
                placeholder="••••••••"
                className="input-field"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            <button
              id="signup-submit"
              type="submit"
              disabled={loading}
              className="w-full btn-primary py-2.5 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  Creating account…
                </>
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <p className="text-sm text-neutral-400">
            Already have an account?{' '}
            <Link to="/login" className="text-white underline underline-offset-4 hover:text-neutral-300 transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

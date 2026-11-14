/**
 * @triage/sdk browser entry.
 *
 * Captures uncaught errors (`window` "error") and unhandled promise rejections in the
 * browser and posts them to /ingest/error, using the same payload shape as the Node SDK.
 * Never throws into the host page.
 *
 * Bundler usage:  import { init, captureException } from '@triage/sdk/browser'
 * Script tag:     <script src="/triage-browser.js"></script>  ->  window.Triage.init({...})
 *
 * NOTE: an API key shipped to a browser is public. Treat it as a write-only ingest key.
 */
import { scrub } from './scrub'

export { scrub }

export interface BrowserFrame {
  file: string
  line?: number
  function?: string
  in_app: boolean
}

export interface BrowserErrorPayload {
  name: string
  message: string
  stack: string
  frames: BrowserFrame[]
  route?: string
  method?: string
  environment?: string
  release?: string
  count?: number
}

export interface BrowserOptions {
  apiKey?: string
  endpoint?: string
  environment?: string
  release?: string
  autoCapture?: boolean
  dedupeWindowMs?: number
  sendTimeoutMs?: number
  /** Max events sent per page load (guards against render loops). Default 50. */
  maxEventsPerSession?: number
  /** Origin treated as "your app" when classifying frames. Default: window.location.origin. */
  appOrigin?: string
}

export interface CaptureContext {
  route?: string
  method?: string
  count?: number
  immediate?: boolean
  /** React component stack (from an error boundary's componentDidCatch info). */
  componentStack?: string
}

// Server limits (see backend ErrorIn schema)
const MAX_NAME = 200
const MAX_MESSAGE = 2000
const MAX_STACK = 16000
const MAX_FRAMES = 50
const MAX_ROUTE = 500

let _options: BrowserOptions = {
  endpoint: 'http://localhost:8000',
  autoCapture: true,
  dedupeWindowMs: 1000,
  sendTimeoutMs: 2000,
  maxEventsPerSession: 50,
}
let _initialized = false
let _sentCount = 0
const _captured = new WeakSet<object>()

interface QueuedError {
  payload: BrowserErrorPayload
  timer: ReturnType<typeof setTimeout>
  resolvers: Array<(ok: boolean) => void>
}
const _queue = new Map<string, QueuedError>()

function currentOrigin(): string {
  if (_options.appOrigin) return _options.appOrigin
  try {
    return typeof location !== 'undefined' ? location.origin : ''
  } catch {
    return ''
  }
}

/** Splits "path:line:col" (path may itself contain ":" such as in URLs). */
function splitLocation(loc: string): { file: string; line?: number } | null {
  const m = loc.match(/^(.*?):(\d+)(?::(\d+))?$/)
  if (!m) return null
  return { file: m[1], line: parseInt(m[2], 10) }
}

/** Normalizes a frame file path and decides whether it belongs to the app. */
function classifyFile(rawFile: string, origin: string): { file: string; inApp: boolean } {
  let file = rawFile.replace(/[?#].*$/, '')

  if (/^https?:\/\//i.test(file)) {
    try {
      const url = new URL(file)
      const pathname = url.pathname.replace(/^\//, '') || '(index)'
      const sameOrigin = !!origin && url.origin === origin
      return { file: pathname, inApp: sameOrigin && !pathname.includes('node_modules') }
    } catch {
      return { file, inApp: false }
    }
  }

  if (/^(chrome-extension|moz-extension|safari-extension|safari-web-extension):/i.test(file)) {
    return { file, inApp: false }
  }
  if (file === '<anonymous>' || file === 'native' || file.startsWith('webpack-internal:')) {
    return { file, inApp: false }
  }

  file = file.replace(/^webpack:\/\/[^/]*\//, '').replace(/^file:\/\//, '').replace(/\\/g, '/')
  return { file, inApp: !file.includes('node_modules') }
}

/**
 * Parses Chrome/Edge (V8) and Firefox/Safari (SpiderMonkey/JSC) stack traces.
 *   V8:      "    at fn (http://host/app.js:10:5)"  /  "    at http://host/app.js:10:5"
 *   Firefox: "fn@http://host/app.js:10:5"  /  "@http://host/app.js:10:5"
 *   Safari:  "fn@http://host/app.js:10:5"  /  "global code@http://host/app.js:10:5"
 */
export function parseBrowserStack(stack: string, originOverride?: string): BrowserFrame[] {
  if (!stack) return []
  const origin = originOverride ?? currentOrigin()
  const frames: BrowserFrame[] = []

  for (const rawLine of stack.split('\n')) {
    try {
      const line = rawLine.trim()
      if (!line) continue

      let func: string | undefined
      let loc: string

      if (line.startsWith('at ')) {
        // V8 format
        let rest = line.slice(3).replace(/^async\s+/, '')
        const m = rest.match(/^(.*?)\s+\((.*)\)$/)
        if (m) {
          func = m[1] || undefined
          loc = m[2]
        } else {
          loc = rest
        }
        // eval frames: "eval at foo (http://host/a.js:1:1), <anonymous>:3:7" -> keep the trailing location
        if (loc.startsWith('eval at ')) {
          const idx = loc.lastIndexOf(', ')
          loc = idx >= 0 ? loc.slice(idx + 2) : loc
        }
      } else if (line.includes('@')) {
        // Firefox / Safari format
        const idx = line.indexOf('@')
        func = line.slice(0, idx) || undefined
        loc = line.slice(idx + 1)
        if (func === 'global code') func = undefined
      } else {
        continue
      }

      const parts = splitLocation(loc)
      if (!parts) continue

      const { file, inApp } = classifyFile(parts.file, origin)
      frames.push({
        file,
        line: parts.line,
        function: func,
        in_app: inApp,
      })
    } catch {
      // Never fail frame parsing
    }
  }

  return frames
}

function localFingerprint(name: string, frames: BrowserFrame[]): string {
  const f = frames.find((fr) => fr.in_app)
  return f ? `${name}:${f.file}:${f.line || 0}:${f.function || ''}` : name
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'string') return new Error(value)
  try {
    return new Error(typeof value === 'object' ? JSON.stringify(value) : String(value))
  } catch {
    return new Error('Unknown error')
  }
}

/** Builds an Error from a window "error" event that carries no Error object. */
function errorFromEvent(ev: ErrorEvent): Error | null {
  const rawMessage = (ev.message || '').replace(/^Uncaught\s+/, '')
  // Cross-origin scripts without CORS headers give no usable details
  if (!ev.error && (!ev.filename || rawMessage === 'Script error.')) return null

  const m = rawMessage.match(/^([A-Za-z]*Error):\s*(.*)$/s)
  const err = new Error(m ? m[2] : rawMessage)
  if (m) err.name = m[1]
  err.stack = `${err.name}: ${err.message}\n    at <anonymous> (${ev.filename}:${ev.lineno || 0}:${ev.colno || 0})`
  return err
}

async function sendPayload(payload: BrowserErrorPayload): Promise<boolean> {
  const apiKey = _options.apiKey
  if (!apiKey) return false

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timeoutId = controller ? setTimeout(() => controller.abort(), _options.sendTimeoutMs || 2000) : null

  try {
    const url = `${(_options.endpoint || '').replace(/\/$/, '')}/ingest/error`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(payload),
      keepalive: true, // lets the request outlive page unload
      signal: controller ? controller.signal : undefined,
    })
    return res.ok
  } catch {
    return false
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}

function dispatch(entry: QueuedError, fp: string): Promise<void> {
  clearTimeout(entry.timer)
  _queue.delete(fp)
  return sendPayload(entry.payload)
    .then((ok) => entry.resolvers.forEach((r) => r(ok)))
    .catch(() => entry.resolvers.forEach((r) => r(false)))
}

/** Sends everything still waiting in the dedupe window (called when the page is hidden). */
export function flush(): void {
  for (const [fp, entry] of Array.from(_queue.entries())) {
    void dispatch(entry, fp)
  }
}

export function captureException(error: unknown, context?: CaptureContext): Promise<boolean> {
  try {
    if (!_options.apiKey) {
      console.warn('[Triage SDK] apiKey is not set. Dropping browser telemetry.')
      return Promise.resolve(false)
    }

    const err = toError(error)

    // The same Error object can reach us twice (error boundary + window "error")
    if (_captured.has(err)) return Promise.resolve(true)
    _captured.add(err)

    if (_sentCount >= (_options.maxEventsPerSession || 50)) return Promise.resolve(false)
    _sentCount++

    let stack = err.stack || `${err.name}: ${err.message}`
    if (context?.componentStack) {
      stack += `\n\nReact component stack:${context.componentStack}`
    }

    const frames = parseBrowserStack(err.stack || '').slice(0, MAX_FRAMES)
    const isLocal = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)

    const payload: BrowserErrorPayload = {
      name: (err.name || 'Error').slice(0, MAX_NAME),
      message: scrub(err.message || 'Unknown error').slice(0, MAX_MESSAGE),
      stack: scrub(stack).slice(0, MAX_STACK),
      frames,
      route: scrub(context?.route ?? (typeof location !== 'undefined' ? location.pathname : '')).slice(0, MAX_ROUTE) || undefined,
      method: context?.method,
      environment: _options.environment || (isLocal ? 'development' : 'production'),
      release: _options.release,
      count: context?.count || 1,
    }

    const fp = localFingerprint(payload.name, payload.frames)

    if (context?.immediate) return sendPayload(payload)

    const existing = _queue.get(fp)
    if (existing) {
      existing.payload.count = (existing.payload.count || 1) + (payload.count || 1)
      existing.payload.message = payload.message // keep the latest message
      return Promise.resolve(true)
    }

    return new Promise<boolean>((resolve) => {
      const entry: QueuedError = {
        payload,
        resolvers: [resolve],
        timer: setTimeout(() => {
          void dispatch(entry, fp)
        }, _options.dedupeWindowMs ?? 1000),
      }
      _queue.set(fp, entry)
    })
  } catch {
    // Top-level safety guarantee: the SDK never breaks the host page
    return Promise.resolve(false)
  }
}

export function init(options?: BrowserOptions): void {
  try {
    if (_initialized) return
    _initialized = true

    _options = { ..._options, ...options }

    if (!_options.apiKey) {
      console.warn('[Triage SDK] Initialized without apiKey. Browser errors will not be sent.')
    }

    if (_options.autoCapture !== false && typeof window !== 'undefined') {
      window.addEventListener('error', (ev: ErrorEvent) => {
        try {
          // Resource load failures (img/script 404) bubble here with a non-window target
          if (ev.target && ev.target !== window) return
          const err = ev.error != null ? toError(ev.error) : errorFromEvent(ev)
          if (err) void captureException(err)
        } catch {
          // ignore
        }
      })

      window.addEventListener('unhandledrejection', (ev: PromiseRejectionEvent) => {
        try {
          void captureException(ev.reason)
        } catch {
          // ignore
        }
      })

      // Flush the dedupe window before the tab goes away
      window.addEventListener('pagehide', flush)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush()
      })
    }
  } catch {
    // Safety guard
  }
}

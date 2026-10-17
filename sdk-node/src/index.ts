import * as path from 'path'

export interface Frame {
  file: string
  line?: number
  function?: string
  in_app: boolean
}

export interface ErrorPayload {
  name: string
  message: string
  stack: string
  frames: Frame[]
  route?: string
  method?: string
  environment?: string
  release?: string
  count?: number
}

export interface TriageOptions {
  apiKey?: string
  endpoint?: string
  environment?: string
  release?: string
  autoCapture?: boolean
  dedupeWindowMs?: number
  sendTimeoutMs?: number
}

let _options: TriageOptions = {
  endpoint: 'http://localhost:8000',
  autoCapture: true,
  dedupeWindowMs: 1000, // 1 second batch window
  sendTimeoutMs: 2000,   // 2s timeout on network sends
}

let _initialized = false

// Deduplication queue: fingerprint -> { payload, timer }
interface QueuedError {
  payload: ErrorPayload
  timer: NodeJS.Timeout
}
const _queue = new Map<string, QueuedError>()

/**
 * PII scrubber: cleans emails, bearer tokens, and query-string secrets.
 */
export function scrub(text: string): string {
  if (!text) return text
  try {
    return text
      // Emails
      .replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '[EMAIL]')
      // Bearer tokens & JWTs
      .replace(/Bearer\s+[A-Za-z0-9\-_.~+/]+=*/gi, 'Bearer [REDACTED]')
      .replace(/ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[JWT]')
      // Common secret query params or keys: token=..., secret=..., password=..., api_key=...
      .replace(/([?&](?:token|access_token|secret|password|api_key|apiKey|key)=)([^& \t\r\n]+)/gi, '$1[REDACTED]')
      // JSON / object key secrets: "password": "...", "secret": "..."
      .replace(/(["']?(?:token|access_token|secret|password|api_key|apiKey)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi, '$1[REDACTED]$3')
  } catch {
    return text
  }
}

export function parseStackTrace(stack: string): Frame[] {
  if (!stack) return []
  const lines = stack.split('\n').slice(1) // skip the error header line
  const frames: Frame[] = []
  const cwd = process.cwd()

  for (const line of lines) {
    try {
      const trimmed = line.trim()
      if (!trimmed.startsWith('at ')) continue

      const match = trimmed.match(/^at (?:(?<func>.*?)\s+\((?<loc>.*?)\)|(?<locOnly>.*))$/)
      if (!match || !match.groups) continue

      const funcName = match.groups.func || undefined
      const location = match.groups.loc || match.groups.locOnly || ''

      const locMatch = location.match(/^(?<filePath>.*?):(?<line>\d+)(?::\d+)?$/)
      if (!locMatch || !locMatch.groups) continue

      let rawPath = locMatch.groups.filePath
      const lineNum = parseInt(locMatch.groups.line, 10)

      if (rawPath.startsWith('file://')) {
        rawPath = rawPath.slice(7)
      }

      const isNodeInternal = rawPath.startsWith('node:') || rawPath.includes('internal/') || !path.isAbsolute(rawPath)
      const isNodeModules = rawPath.includes('node_modules')
      const inApp = !isNodeInternal && !isNodeModules

      let normalizedFile = rawPath
      if (path.isAbsolute(rawPath)) {
        normalizedFile = path.relative(cwd, rawPath).replace(/\\/g, '/')
        if (!normalizedFile.startsWith('./') && !normalizedFile.startsWith('../')) {
          normalizedFile = './' + normalizedFile
        }
      } else {
        normalizedFile = rawPath.replace(/\\/g, '/')
      }

      frames.push({
        file: normalizedFile,
        line: lineNum,
        function: funcName,
        in_app: inApp,
      })
    } catch {
      // Never fail frame parsing
    }
  }

  return frames
}

/**
 * Computes a quick local fingerprint for in-memory batching / deduping.
 */
function localFingerprint(name: string, frames: Frame[]): string {
  const inAppFrame = frames.find((f) => f.in_app)
  if (inAppFrame) {
    return `${name}:${inAppFrame.file}:${inAppFrame.line || 0}:${inAppFrame.function || ''}`
  }
  return name
}

async function sendPayload(payload: ErrorPayload): Promise<boolean> {
  const apiKey = _options.apiKey || process.env.TRIAGE_API_KEY
  if (!apiKey) {
    return false
  }

  const timeoutMs = _options.sendTimeoutMs || 2000
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `${_options.endpoint?.replace(/\/$/, '')}/ingest/error`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    return res.ok
  } catch (err) {
    return false
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function captureException(
  error: unknown,
  context?: { route?: string; method?: string; count?: number; immediate?: boolean }
): Promise<boolean> {
  try {
    const apiKey = _options.apiKey || process.env.TRIAGE_API_KEY
    if (!apiKey) {
      console.warn('[Triage SDK] TRIAGE_API_KEY is not set. Dropping telemetry.')
      return false
    }

    const err = error instanceof Error ? error : new Error(String(error))
    const frames = parseStackTrace(err.stack || '')

    const payload: ErrorPayload = {
      name: err.name || 'Error',
      message: scrub(err.message || 'Unknown error'),
      stack: scrub(err.stack || ''),
      frames,
      route: context?.route ? scrub(context.route) : undefined,
      method: context?.method,
      environment: _options.environment || process.env.NODE_ENV || 'development',
      release: _options.release,
      count: context?.count || 1,
    }

    // If immediate send is requested (e.g. fatal process exit)
    if (context?.immediate) {
      return await sendPayload(payload)
    }

    const fp = localFingerprint(payload.name, payload.frames)
    const windowMs = _options.dedupeWindowMs || 1000

    if (_queue.has(fp)) {
      const existing = _queue.get(fp)!
      existing.payload.count = (existing.payload.count || 1) + (payload.count || 1)
      existing.payload.message = payload.message // latest message
      return true
    }

    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(async () => {
        _queue.delete(fp)
        try {
          const ok = await sendPayload(payload)
          resolve(ok)
        } catch {
          resolve(false)
        }
      }, windowMs)

      _queue.set(fp, { payload, timer })
    })
  } catch (outerErr) {
    // Top-level safety guarantee: SDK will never crash host application
    return false
  }
}

export function init(options?: TriageOptions): void {
  try {
    if (_initialized) return
    _initialized = true

    _options = {
      ..._options,
      ...options,
      apiKey: options?.apiKey || process.env.TRIAGE_API_KEY,
    }

    if (!_options.apiKey) {
      console.warn('[Triage SDK] Initialized without API key. Please provide apiKey or set TRIAGE_API_KEY.')
    }

    if (_options.autoCapture !== false) {
      process.on('uncaughtException', (err) => {
        try {
          // Send immediately on fatal uncaughtException, then exit(1)
          captureException(err, { immediate: true }).finally(() => {
            process.exit(1)
          })
        } catch {
          process.exit(1)
        }
      })

      process.on('unhandledRejection', (reason) => {
        try {
          // In Node 15+, unhandled rejections terminate process by default.
          // We report the error immediately and exit(1) to respect Node's fail-fast semantics.
          captureException(reason, { immediate: true }).finally(() => {
            process.exit(1)
          })
        } catch {
          process.exit(1)
        }
      })
    }
  } catch {
    // Safety guard
  }
}

/**
 * Express error-handling middleware.
 * Must take exactly 4 arguments (err, req, res, next) and call next(err).
 */
export function triageMiddleware() {
  return (err: any, req: any, _res: any, next: any) => {
    try {
      captureException(err, {
        route: req.originalUrl || req.url,
        method: req.method,
      })
    } catch {
      // SDK safety guard
    }
    next(err)
  }
}

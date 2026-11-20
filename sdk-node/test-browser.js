const assert = require('assert')

// ---- Minimal browser environment stub (no DOM library needed) ----
const listeners = { window: {}, document: {} }
const fetchCalls = []

global.window = {
  addEventListener: (type, fn) => {
    ;(listeners.window[type] = listeners.window[type] || []).push(fn)
  },
}
global.document = {
  visibilityState: 'visible',
  addEventListener: (type, fn) => {
    ;(listeners.document[type] = listeners.document[type] || []).push(fn)
  },
}
global.location = { origin: 'http://localhost:3000', pathname: '/dashboard', hostname: 'localhost' }
global.fetch = async (url, opts) => {
  fetchCalls.push({ url, opts, body: JSON.parse(opts.body) })
  return { ok: true }
}

const { parseBrowserStack, init, captureException, scrub } = require('./dist/browser.js')

const ORIGIN = 'http://localhost:3000'

// 1. Chrome / V8 stack
const chrome = `TypeError: Cannot read properties of undefined (reading 'x')
    at Counter (http://localhost:3000/Counter.jsx:12:15)
    at async handleClick (http://localhost:3000/src/app.js?v=3:40:9)
    at http://localhost:3000/anon.js:7:1
    at Object.render [as r] (https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/react-dom.production.min.js:100:5)
    at fn (eval at <anonymous> (http://localhost:3000/a.js:1:1), <anonymous>:3:7)`
let frames = parseBrowserStack(chrome, ORIGIN)
assert.strictEqual(frames.length, 5, 'chrome: 5 frames')
assert.deepStrictEqual(frames[0], { file: 'Counter.jsx', line: 12, function: 'Counter', in_app: true })
assert.strictEqual(frames[1].file, 'src/app.js', 'query string stripped')
assert.strictEqual(frames[1].function, 'handleClick', 'async prefix stripped')
assert.strictEqual(frames[2].function, undefined, 'anonymous frame has no function')
assert.strictEqual(frames[2].in_app, true)
assert.strictEqual(frames[3].in_app, false, 'cross-origin CDN frame is not in-app')
assert.strictEqual(frames[4].file, '<anonymous>', 'eval frame keeps trailing location')
assert.strictEqual(frames[4].line, 3)

// 2. Firefox / Safari stack
const firefox = `Counter/<@http://localhost:3000/Counter.jsx:12:15
handleClick@http://localhost:3000/src/app.js:40:9
@http://localhost:3000/anon.js:7:1
global code@http://localhost:3000/main.js:1:1
dispatch@https://cdnjs.cloudflare.com/react-dom.js:9:9
[native code]`
frames = parseBrowserStack(firefox, ORIGIN)
assert.strictEqual(frames.length, 5, 'firefox: 5 frames (native code skipped)')
assert.strictEqual(frames[0].file, 'Counter.jsx')
assert.strictEqual(frames[0].line, 12)
assert.strictEqual(frames[0].in_app, true)
assert.strictEqual(frames[2].function, undefined)
assert.strictEqual(frames[3].function, undefined, 'global code has no function')
assert.strictEqual(frames[4].in_app, false)

// 3. node_modules paths are never in-app
frames = parseBrowserStack('    at f (http://localhost:3000/node_modules/lib/x.js:1:1)', ORIGIN)
assert.strictEqual(frames[0].in_app, false)

// 4. Empty / garbage input
assert.deepStrictEqual(parseBrowserStack('', ORIGIN), [])
assert.deepStrictEqual(parseBrowserStack('garbage line without location', ORIGIN), [])

// 5. Scrubber is shared with the Node entry
assert.strictEqual(scrub('mail me at a.b@example.com'), 'mail me at [EMAIL]')

;(async () => {
  // 6. init registers global handlers
  init({ apiKey: 'tk_live_test', endpoint: 'http://api.test/', dedupeWindowMs: 20 })
  assert(listeners.window.error && listeners.window.error.length === 1, 'error listener registered')
  assert(listeners.window.unhandledrejection, 'unhandledrejection listener registered')
  assert(listeners.window.pagehide, 'pagehide flush registered')

  // 7. window "error" event with an Error object -> POST /ingest/error
  const err = new TypeError('Cannot read properties of undefined for user bob@example.com')
  err.stack = `TypeError: Cannot read properties of undefined for user bob@example.com
    at Counter (http://localhost:3000/Counter.jsx:12:15)`
  listeners.window.error[0]({ target: global.window, error: err, message: err.message })
  // duplicate of the same object is ignored, a second similar error is merged into count
  listeners.window.error[0]({ target: global.window, error: err, message: err.message })
  const err2 = new TypeError('Cannot read properties of undefined for user carol@example.com')
  err2.stack = err.stack
  listeners.window.error[0]({ target: global.window, error: err2, message: err2.message })
  await new Promise((r) => setTimeout(r, 60))

  assert.strictEqual(fetchCalls.length, 1, 'deduped into one request')
  const call = fetchCalls[0]
  assert.strictEqual(call.url, 'http://api.test/ingest/error')
  assert.strictEqual(call.opts.headers['X-API-Key'], 'tk_live_test')
  assert.strictEqual(call.body.name, 'TypeError')
  assert.strictEqual(call.body.count, 2, 'two distinct error objects merged, duplicate object ignored')
  assert(call.body.message.includes('[EMAIL]') && !call.body.message.includes('@example.com'), 'message scrubbed')
  assert.strictEqual(call.body.frames[0].file, 'Counter.jsx')
  assert.strictEqual(call.body.frames[0].in_app, true)
  assert.strictEqual(call.body.route, '/dashboard')
  assert.strictEqual(call.body.environment, 'development')

  // 8. Resource load errors (target is not window) are ignored
  listeners.window.error[0]({ target: { tagName: 'IMG' }, message: 'x' })
  // 9. Opaque cross-origin "Script error." is ignored
  listeners.window.error[0]({ target: global.window, message: 'Script error.', filename: '' })
  await new Promise((r) => setTimeout(r, 60))
  assert.strictEqual(fetchCalls.length, 1, 'ignored events send nothing')

  // 10. Error event without an Error object builds one from filename/line
  listeners.window.error[0]({
    target: global.window,
    message: 'Uncaught ReferenceError: foo is not defined',
    filename: 'http://localhost:3000/Counter.jsx',
    lineno: 20,
    colno: 3,
  })
  await new Promise((r) => setTimeout(r, 60))
  assert.strictEqual(fetchCalls.length, 2)
  assert.strictEqual(fetchCalls[1].body.name, 'ReferenceError')
  assert.strictEqual(fetchCalls[1].body.message, 'foo is not defined')
  assert.strictEqual(fetchCalls[1].body.frames[0].file, 'Counter.jsx')
  assert.strictEqual(fetchCalls[1].body.frames[0].line, 20)

  // 11. unhandledrejection with a non-Error reason
  listeners.window.unhandledrejection[0]({ reason: 'payment declined' })
  await new Promise((r) => setTimeout(r, 60))
  assert.strictEqual(fetchCalls.length, 3)
  assert.strictEqual(fetchCalls[2].body.message, 'payment declined')

  // 12. React component stack is appended to the stack text; payload respects server limits
  const big = new Error('x'.repeat(5000))
  big.stack = 'Error: ' + 'x'.repeat(30000)
  await captureException(big, { immediate: true, componentStack: '\n    in Counter' })
  const bp = fetchCalls[3].body
  assert(bp.message.length <= 2000 && bp.stack.length <= 16000, 'truncated to server limits')

  const rc = new Error('render crash')
  rc.stack = 'Error: render crash\n    at Counter (http://localhost:3000/Counter.jsx:5:1)'
  await captureException(rc, { immediate: true, componentStack: '\n    in Counter\n    in App' })
  assert(fetchCalls[4].body.stack.includes('React component stack:'))
  assert(fetchCalls[4].body.stack.includes('in Counter'))

  console.log('All browser SDK tests passed!')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})

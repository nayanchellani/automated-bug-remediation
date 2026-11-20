const fs = require('fs')
const path = require('path')
const express = require('express')
const { transform } = require('sucrase')
const { init, triageMiddleware, captureException } = require('@triage/sdk')

const app = express()
const PORT = process.env.PORT || 3000

// Initialize Triage SDK
init({
  apiKey: process.env.TRIAGE_API_KEY || 'tk_live_demo_key_placeholder',
  endpoint: process.env.TRIAGE_ENDPOINT || 'http://localhost:8000',
  environment: 'development',
  release: 'v1.0.0',
})

app.use(express.json())

// Compiles public/Counter.jsx on request. Sucrase keeps line numbers identical to the source,
// so browser stack traces point at the real line in Counter.jsx.
app.get('/Counter.jsx', (req, res) => {
  try {
    const source = fs.readFileSync(path.join(__dirname, 'public', 'Counter.jsx'), 'utf-8')
    const { code } = transform(source, { transforms: ['jsx'], jsxRuntime: 'classic', filePath: 'Counter.jsx' })
    res.type('application/javascript').send(code)
  } catch (err) {
    console.error('Failed to compile Counter.jsx:', err.message)
    res.status(500).type('application/javascript').send(`console.error(${JSON.stringify('Counter.jsx failed to compile: ' + err.message)})`)
  }
})

// Browser SDK bundle (built from sdk-node: `npm run build`)
app.get('/triage-browser.js', (req, res) => {
  res.sendFile(path.join(path.dirname(require.resolve('@triage/sdk')), 'triage-browser.global.js'))
})

// Public browser config. NOTE: an API key in the browser is public by design.
app.get('/triage-config.js', (req, res) => {
  const config = {
    apiKey: process.env.TRIAGE_API_KEY || 'tk_live_demo_key_placeholder',
    endpoint: process.env.TRIAGE_BROWSER_ENDPOINT || process.env.TRIAGE_ENDPOINT || 'http://localhost:8000',
    environment: 'development',
    release: 'v1.0.0',
  }
  res.type('application/javascript').send(`window.__TRIAGE_CONFIG__ = ${JSON.stringify(config)};`)
})

// Serves the React counter UI (public/index.html) at "/"
app.use(express.static(path.join(__dirname, 'public')))

const COUNTER_LIMIT = 5

// Counter API: the React counter posts its next value here.
// Any value above COUNTER_LIMIT throws, so the error reaches triageMiddleware.
app.post('/api/counter', (req, res) => {
  const { value } = req.body || {}
  if (value > COUNTER_LIMIT) {
    throw new RangeError(`Counter exceeded limit of ${COUNTER_LIMIT} (got ${value})`)
  }
  res.json({ value })
})

// Throws a TypeError when the client asks for it (undefined.length)
app.post('/api/counter/crash', (req, res) => {
  const items = undefined
  res.json({ size: items.length })
})

app.get('/info', (req, res) => {
  res.json({
    message: 'Demo App is running with @triage/sdk integration!',
    endpoints: [
      'POST /api/counter -> Throws RangeError when value > 5',
      'POST /api/counter/crash -> Trigger TypeError',
      'GET /crash-type-error -> Trigger TypeError',
      'GET /crash-reference-error -> Trigger ReferenceError',
      'GET /manual-capture -> Manually capture custom exception',
      'GET /crash-async -> Trigger async unhandled rejection',
    ],
  })
})

// Crashing Route 1: TypeError
app.get('/crash-type-error', (req, res) => {
  const user = undefined
  // Intentionally crash: Cannot read properties of undefined
  res.send(user.profile.email)
})

// Crashing Route 2: ReferenceError
app.get('/crash-reference-error', (req, res) => {
  // Intentionally crash: nonExistentService is not defined
  nonExistentService.performAction()
  res.send('Success')
})

// Route 3: Manual Exception Capture
app.get('/manual-capture', async (req, res) => {
  try {
    throw new Error('Database transaction timeout while processing payment')
  } catch (err) {
    await captureException(err, { route: '/manual-capture', method: 'GET' })
    res.status(500).json({ error: 'Payment failed, error recorded by Triage SDK' })
  }
})

// Crashing Route 4: Unhandled Promise Rejection
app.get('/crash-async', (req, res) => {
  setTimeout(() => {
    Promise.reject(new Error('Async worker job failed unexpectedly'))
  }, 10)
  res.send('Async crash triggered')
})

// Triage error middleware MUST be registered before other error handlers
app.use(triageMiddleware())

// Standard express fallback error handler
app.use((err, req, res, next) => {
  res.status(500).json({
    status: 'error',
    message: err.message || 'Internal Server Error',
  })
})

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Demo App listening on http://localhost:${PORT}`)
    console.log(`Try visiting http://localhost:${PORT}/crash-type-error to test runtime error capture.`)
  })
}

module.exports = app

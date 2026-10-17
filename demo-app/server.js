const express = require('express')
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

app.get('/', (req, res) => {
  res.json({
    message: 'Demo App is running with @triage/sdk integration!',
    endpoints: [
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

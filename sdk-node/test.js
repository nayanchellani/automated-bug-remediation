const assert = require('assert')
const path = require('path')
const { parseStackTrace, scrub } = require('./dist/index.js')

// 1. Stack trace parsing tests
const sampleStack = `TypeError: Cannot read properties of undefined (reading 'items')
    at processOrder (${path.join(process.cwd(), 'src', 'order.ts')}:45:12)
    at handleRequest (${path.join(process.cwd(), 'node_modules', 'express', 'lib', 'router.js')}:100:5)
    at Module._compile (node:internal/modules/cjs/loader:1469:14)`

const frames = parseStackTrace(sampleStack)
assert.strictEqual(frames.length, 3, 'Should parse 3 frames')

// Frame 1: in_app = true, relative file path
assert.strictEqual(frames[0].in_app, true, 'App code should be in_app: true')
assert.strictEqual(frames[0].line, 45)
assert.strictEqual(frames[0].function, 'processOrder')
assert(frames[0].file.includes('src/order.ts') || frames[0].file.includes('order.ts'))

// Frame 2: node_modules => in_app: false
assert.strictEqual(frames[1].in_app, false, 'node_modules should be in_app: false')

// Frame 3: node:internal => in_app: false
assert.strictEqual(frames[2].in_app, false, 'node internal should be in_app: false')

// 2. PII Scrubbing tests
const emailText = 'Failed for user john.doe@example.com when processing'
assert.strictEqual(scrub(emailText), 'Failed for user [EMAIL] when processing')

const bearerText = 'Authorization header was Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz.123'
assert(scrub(bearerText).includes('Bearer [REDACTED]') || scrub(bearerText).includes('[JWT]'))

const queryText = '/api/checkout?user=123&apiKey=secret12345&token=tok_987'
assert.strictEqual(scrub(queryText), '/api/checkout?user=123&apiKey=[REDACTED]&token=[REDACTED]')

console.log('All SDK stack parsing & PII scrubbing tests passed!')

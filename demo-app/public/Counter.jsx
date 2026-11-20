const { useState } = React

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.message || `Request failed (${res.status})`)
  }
  return res.json()
}

// Reports render-time crashes to Triage, then shows a fallback instead of a blank page.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    Triage.captureException(error, { componentStack: info.componentStack })
  }

  render() {
    if (this.state.error) {
      return (
        <div className="counter">
          <div>Something went wrong</div>
          <div className="status error">{this.state.error.message}</div>
          <div className="row">
            <button onClick={() => this.setState({ error: null })}>Try again</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

function BrokenWidget({ user }) {
  // Intentional render-time crash: `user` is undefined, so `user.profile` throws a TypeError
  return <div>{user.profile.name}</div>
}

function Counter() {
  const [count, setCount] = useState(0)
  const [showBroken, setShowBroken] = useState(false)
  const [status, setStatus] = useState({ text: 'Click + past 5 to trigger a server error.', error: false })

  const run = async (fn) => {
    try {
      await fn()
    } catch (err) {
      setStatus({ text: err.message, error: true })
    }
  }

  const increment = () =>
    run(async () => {
      const next = count + 1
      const data = await post('/api/counter', { value: next })
      setCount(data.value)
      setStatus({ text: 'OK', error: false })
    })

  const decrement = () => setCount((c) => c - 1)
  const reset = () => {
    setCount(0)
    setStatus({ text: 'Reset.', error: false })
  }

  // Server-side errors (captured by @triage/sdk in Node)
  const crashServer = () => run(() => post('/api/counter/crash'))

  // Browser-side errors (captured by the @triage/sdk browser entry)
  const throwInHandler = () => {
    const settings = undefined
    return settings.theme // TypeError thrown inside an event handler -> window "error"
  }
  const rejectPromise = () => {
    Promise.reject(new Error('Async save failed in the browser')) // -> unhandledrejection
  }

  return (
    <div className="counter">
      <div>Triage demo counter</div>
      <div className="value">{count}</div>
      <div className="row">
        <button onClick={decrement} className="outline">-</button>
        <button onClick={increment}>+</button>
        <button onClick={reset} className="outline">Reset</button>
      </div>

      <div className="label">Server errors</div>
      <div className="row">
        <button onClick={crashServer} className="danger">Crash server</button>
      </div>

      <div className="label">Browser errors</div>
      <div className="row">
        <button onClick={throwInHandler} className="danger">Throw in handler</button>
        <button onClick={rejectPromise} className="danger">Reject promise</button>
        <button onClick={() => setShowBroken(true)} className="danger">Break render</button>
      </div>

      {showBroken && <BrokenWidget />}
      <div className={`status${status.error ? ' error' : ''}`}>{status.text}</div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Counter />
  </ErrorBoundary>
)

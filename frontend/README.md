# Triage Engine frontend

React 19 + Vite + TypeScript + Tailwind CSS v4 dashboard for Triage Engine.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
npm run lint     # oxlint
```

## Configuration

| Variable            | Default                 | Purpose                          |
| ------------------- | ----------------------- | -------------------------------- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend API URL used by the app  |

Copy `.env.example` to `.env` to override. The backend must list the frontend origin in its `CORS_ORIGINS`.

## Structure

- `src/pages/` Login, Signup, Dashboard (incidents, structure, libraries, API keys)
- `src/context/AuthContext.tsx` in-memory access token + silent refresh via httpOnly cookie
- `src/lib/api.ts` axios client, single-flight token refresh, typed API helpers

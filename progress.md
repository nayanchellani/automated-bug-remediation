# Triage Engine — Build Progress

## Legend
- ✅ Done
- ⚠️ Partial / has known gaps
- ❌ Not started

---

## Phase 0 — Monorepo Setup

| Item | Status | Notes |
|------|--------|-------|
| Monorepo folder structure created | ✅ | `backend/`, `frontend/`, `sdk-node/`, `sdk-python/`, `sandbox/`, `demo-app/`, `eval/` |
| `memory.md` architecture document | ✅ | Full tech stack, data model, roadmap documented |
| `docker-compose.yml` scaffolded | ⚠️ | File exists but is empty — PostgreSQL + pgvector + Redis not configured yet |
| FastAPI app bootstrapped (`main.py`) | ✅ | `lifespan` context manager, health check endpoint |
| SQLAlchemy async engine (`db/session.py`) | ✅ | `create_async_engine`, `async_sessionmaker`, `Base` |
| Pydantic settings (`core/config.py`) | ✅ | `DATABASE_URL`, `SECRET_KEY`, token expiry settings, reads from `.env` |
| CORS middleware | ✅ | Allows `localhost:5173` with credentials |
| React + Vite + TypeScript frontend | ✅ | Vite project scaffolded |
| Tailwind CSS v4 | ✅ | Configured with `@theme` design tokens |
| Frontend dependencies | ✅ | `axios`, `react-router-dom`, `lucide-react`, `clsx` installed |
| **Database: SQLite (dev)** | ✅ | `sqlite+aiosqlite:///./triage.db` — temp for local dev |
| **Database: PostgreSQL + pgvector (prod)** | ❌ | Planned, not set up yet |

---

## Feature 1 — Auth & Tenant Projects

### Backend

| Item | Status | Notes |
|------|--------|-------|
| `User` SQLAlchemy model | ✅ | `id`, `email`, `password_hash` — table auto-created on startup |
| `UserCreate`, `UserOut`, `Token` Pydantic schemas | ✅ | In `schemas/user.py` |
| Password hashing — **Argon2** | ⚠️ | `core/security.py` imports Argon2 via `passlib`. `user_service.py` has a fallback stub if import fails — should be cleaned up |
| `get_user_by_email()` service | ✅ | Async SQLAlchemy select |
| `create_user()` service | ✅ | Hashes password, inserts user, returns ORM object |
| `authenticate_user()` service | ✅ | Looks up user, verifies hash |
| JWT access token generation | ✅ | 15-min expiry, `sub` = user ID, `type` = `"access"` |
| JWT refresh token generation | ✅ | 7-day expiry, `type` = `"refresh"` |
| `POST /auth/register` | ✅ | 400 if email exists, returns `UserOut` |
| `POST /auth/login` | ✅ | Returns `access_token`, sets `refresh_token` httpOnly cookie |
| `POST /auth/refresh` | ✅ | Reads refresh cookie, issues new access token |
| `POST /auth/logout` | ✅ | Deletes refresh cookie |
| `get_current_user` dependency | ✅ | JWT decode → user lookup, reusable across all protected routes |
| `get_db` dependency | ✅ | Yields `AsyncSession`, auto-closes after request |
| **Tenant scoping** | ❌ | `tenants` table not created. Users are not linked to a tenant yet. Required before Feature 2. |
| **Projects model** | ❌ | Not created yet |

### Frontend

| Item | Status | Notes |
|------|--------|-------|
| Axios API client (`lib/api.ts`) | ✅ | `withCredentials: true`, attaches Bearer token from localStorage |
| Auto token refresh interceptor | ✅ | On 401, hits `/auth/refresh`, retries original request |
| Login page (`pages/LoginPage.tsx`) | ✅ | Form → `POST /auth/login` → saves token → redirects to `/dashboard` |
| Signup page (`pages/SignupPage.tsx`) | ✅ | Register → auto-login → redirects to `/dashboard` |
| `PrivateRoute` guard | ✅ | Redirects to `/login` if no `access_token` in localStorage |
| React Router setup (`App.tsx`) | ✅ | `/login`, `/signup`, `/dashboard` routes |
| Dashboard page (`pages/DashboardPage.tsx`) | ⚠️ | Placeholder only — shows "Coming soon" |
| Design system — Vercel aesthetic | ✅ | Dark mode, 1px borders, high-contrast white CTAs, Inter font |

---

## Feature 2 — API Keys & Error Ingestion
❌ Not started. See plan below.

**What needs to be built:**
- `tenants` model + link users to tenant *(prerequisite)*
- `projects` model (belongs to tenant)
- `api_keys` model — prefix + hashed key, `project_id`, `last_used_at`, `revoked_at`
- `error_events` model — fingerprint, message, stack, file, line, count, first/last seen
- `POST /projects/{id}/api-keys` — generate `tk_live_...` key (shown raw once)
- `POST /ingest/error` — SDK-facing endpoint, authenticates via API key header
- SHA-256 stack trace fingerprinting + dedup upsert logic
- `slowapi` rate limiting on ingest endpoint (100 req/min per key)
- `sdk-node/` — `@triage/sdk` npm package skeleton
- `sdk-python/` — `triage-sdk` pip package skeleton

---

## Features 3–10
❌ Not started. Defined in `memory.md`.

---

## Known Issues / Tech Debt

| Issue | Priority |
|-------|----------|
| `user_service.py` has fallback stub for password hashing — should import `core/security` cleanly | Medium |
| `docker-compose.yml` is empty — need PostgreSQL + pgvector + Redis | High (before deploy) |
| `DATABASE_URL` is SQLite — must switch to `postgresql+asyncpg` before Feature 3+ | High |
| No tenant model — blocks Feature 2 properly | High |
| Dashboard is a placeholder | Low |
| No email validation beyond Pydantic `EmailStr` | Low |
| `SECRET_KEY` is hardcoded default in `config.py` — must be changed via `.env` before deploy | High |

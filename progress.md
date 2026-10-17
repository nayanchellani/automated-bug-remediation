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
| **User scoping** | ✅ | Scoped directly by `user_id` |
| **Projects model** | ✅ | `id`, `name`, `user_id`, `created_at` in `models/project.py` |

### Frontend

| Item | Status | Notes |
|------|--------|-------|
| Axios API client (`lib/api.ts`) | ✅ | `withCredentials: true`, attaches Bearer token from in-memory AuthContext |
| Auto token refresh interceptor | ✅ | On 401, hits `/auth/refresh`, retries original request |
| Login page (`pages/LoginPage.tsx`) | ✅ | Form → `POST /auth/login` → sets in-memory token → redirects to `/dashboard` |
| Signup page (`pages/SignupPage.tsx`) | ✅ | Register → auto-login → redirects to `/dashboard` |
| `PrivateRoute` guard | ✅ | Checks in-memory token, handles silent token refresh on boot |
| React Router setup (`App.tsx`) | ✅ | `/login`, `/signup`, `/dashboard` routes wrapped with `AuthProvider` |
| Dashboard page (`pages/DashboardPage.tsx`) | ✅ | Project view, API Keys table, revoke action, modal with copy button & warning |
| Design system — Vercel aesthetic | ✅ | Dark mode, 1px borders, high-contrast white CTAs, Inter font |

---

## Feature 2 — API Keys & Error Ingestion
✅ Completed.

**Implementation Status:**
- `projects` model & full CRUD endpoints (`POST /projects`, `GET /projects`, `GET /projects/{id}`, `DELETE /projects/{id}`) ✅
- Atomic user + default project creation on registration (`user_service.py`) ✅
- `api_keys` model (`id`, `project_id`, `prefix`, `key_hash`, `created_at`, `last_used_at`, `revoked_at`) ✅
- `generate_api_key()` (`tk_live_...` with SHA-256 hash & prefix) ✅
- `POST /projects/{id}/api-keys` — creates key, returns raw key once, enforces 5 active keys limit with row lock (`with_for_update`) ✅
- `GET /projects/{id}/api-keys` — returns prefix, timestamps, revoked status (never hash) ✅
- `DELETE /projects/{id}/api-keys/{key_id}` — strict project & key ownership verification, sets `revoked_at` ✅
- `get_project_from_api_key` dependency — reads `X-API-Key`, throttles `last_used_at` writes (>60s), returns constant 401 on failure ✅
- Machine-facing `GET /sdk/validate` endpoint for SDK init check ✅
- `001_initial_schema` migration includes `CREATE EXTENSION IF NOT EXISTS vector;` on Postgres ✅
- Docker Compose includes `db_test` service on port 5433 with `tmpfs` ✅
- Strict PostgreSQL test requirement in `conftest.py` (no silent SQLite fallback) ✅
- `error_events` model & migration (`002_error_events.py`) with unique constraint on `(project_id, fingerprint)` and index on `(project_id, last_seen)` ✅
- Server-side authoritative fingerprinting (`app/core/fingerprint.py`) picking first in-app frame or normalized message with IDs/numbers stripped ✅
- `POST /ingest/error` route with `pg_insert` upsert (increments count, updates `last_seen` and latest message) ✅
- `slowapi` rate limiting on ingest endpoint (100 req/min per key) ✅
- 64KB Content-Length payload protection (HTTP 413) ✅
- `GET /projects/{id}/incidents` endpoint with ownership check, ordered by `last_seen DESC` ✅
- Frontend Live Incidents table polling every 4s, with install code snippet empty state and tabs ✅
- `@triage/sdk` Node.js SDK (`sdk-node/`) with relative path frame parsing and `in_app` detection ✅
- Express demo app (`demo-app/`) with crashing endpoints and middleware integration ✅
- Integration test suite (`test_api_keys.py`, `test_ingest.py`) ✅

---

## Feature 3 — Project Snapshot, Structure & Libraries (Non-GitHub)
✅ Completed.

**Implementation Status:**
- `Snapshot` and `Dependency` models ([snapshot.py](file:///d:/code/automated-bug-remediation/automated-bug-remediation/backend/app/models/snapshot.py), [dependency.py](file:///d:/code/automated-bug-remediation/automated-bug-remediation/backend/app/models/dependency.py)) & migration `003_snapshots_dependencies.py` ✅
- OSV ecosystem names (`npm`, `PyPI`) used directly in database models ✅
- In-memory hostile zip parser ([snapshots.py](file:///d:/code/automated-bug-remediation/automated-bug-remediation/backend/app/api/routers/snapshots.py)): 20MB archive limit, 100MB uncompressed limit, 5,000 file cap, zip-slip protection, server-side secret filtering (`.env*`, `*.pem`, `*.key`, `id_rsa*`) ✅
- Server-side manifest parser ([manifest_parser.py](file:///d:/code/automated-bug-remediation/automated-bug-remediation/backend/app/core/manifest_parser.py)) for `package-lock.json`, `package.json`, and `requirements.txt` with lockfile priority ✅
- Project snapshot retention pruning (keeps latest 3 snapshots & removes old zip archives) ✅
- Owner-verified endpoints (`GET /projects/{id}/snapshots/latest`, `GET /projects/{id}/dependencies`) ✅
- `triage push` CLI in `@triage/sdk` ([bin/triage.js](file:///d:/code/automated-bug-remediation/automated-bug-remediation/sdk-node/bin/triage.js)) with hard excludes (`node_modules`, `.git`, `.env*`, etc.) and multipart upload ✅
- Frontend **Structure** tab with collapsible file tree, size badges, and `npx triage push` empty state ✅
- Frontend **Libraries** tab displaying package name, exact/approximate version, dev/prod badge, ecosystem, and source manifest ✅
- Backend integration tests ([test_snapshots.py](file:///d:/code/automated-bug-remediation/automated-bug-remediation/backend/tests/test_snapshots.py)) covering valid upload, zip-slip rejection, secret filtering, and cross-user isolation ✅

---

## Features 4–10
❌ Not started. Defined in `memory.md`.

---

## Known Issues / Tech Debt

| Issue | Priority | Status |
|-------|----------|--------|
| `user_service.py` fallback stub | Medium | Resolved |
| `docker-compose.yml` db and db_test configuration | High | Resolved |
| `DATABASE_URL` PostgreSQL switch | High | Resolved |
| User and Project scoping | High | Resolved |
| Dashboard UI & Token Security in memory | High | Resolved |

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
| `docker-compose.yml` | ✅ | `db` (pgvector pg16, healthcheck), `db_test` (port 5433, tmpfs), `backend`, `frontend`. Redis is not configured (not needed yet) |
| Dockerfiles | ✅ | `backend/Dockerfile` is multi-stage: it copies a Node 22 binary plus the analyzer's `node_modules` into the Python 3.12 image and runs `alembic upgrade head` on start. `frontend/Dockerfile` runs the Vite dev server. Both are dev-oriented (`--reload`, no production build) |
| FastAPI app bootstrapped (`main.py`) | ✅ | `lifespan` context manager, health check endpoint |
| SQLAlchemy async engine (`db/session.py`) | ✅ | `create_async_engine`, `async_sessionmaker`, `Base` |
| Pydantic settings (`core/config.py`) | ✅ | `DATABASE_URL`, `SECRET_KEY`, token expiry settings, reads from `.env` |
| CORS middleware | ✅ | Origins come from `CORS_ORIGINS` (default `localhost:5173,localhost:3000`), credentials allowed |
| React + Vite + TypeScript frontend | ✅ | Vite project scaffolded |
| Tailwind CSS v4 | ✅ | Configured with `@theme` design tokens |
| Frontend dependencies | ✅ | `axios`, `react-router-dom`, `lucide-react`, `clsx` installed |
| Frontend API URL | ✅ | `VITE_API_BASE_URL` (default `http://localhost:8000`), see `frontend/.env.example` |
| **Database: PostgreSQL + pgvector** | ✅ | Required for the app and the tests. The SQLite fallback was removed; `backend/triage.db` is a stale leftover file, now gitignored and untracked |

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

## Feature 4 — Dependency Vulnerability Audit (OSV.dev)
❌ Not started. Dependencies are parsed and stored (Feature 3), but nothing is checked against OSV yet.

---

## Feature 5 — Static Code Analysis (JS/TS only so far)
⚠️ Partial. Backend done and tested; no dashboard UI yet.

**Implementation Status:**
- Node analyzer (`backend/analyzer/analyze.mjs`, Babel 8 parser) reports, each with file, line, column, severity, rule, message and a code snippet:
  - JS/TS/JSX/TSX syntax errors (`.js .jsx .mjs .cjs .ts .tsx .mts .cts`)
  - JSON parse errors
  - `no-undef` (warning) and `no-unreachable` (warning)
  It parses only and never executes project code. Lint is skipped for files that have syntax errors. ✅
- `scans` and `findings` models plus migration `004_scans_findings.py` (applies and rolls back cleanly) ✅
- `app/core/analyzer_runner.py`: safe extraction of analyzable files from the snapshot zip (zip-slip, size caps) into a temp dir, then a 60s-timeout subprocess ✅
- Endpoints: `POST /projects/{id}/scans`, `GET /projects/{id}/scans/latest`, `GET /projects/{id}/findings?severity=&type=` (owner-verified; keeps the last 5 scans) ✅
- Tests in `backend/tests/test_scans.py` (nested folders, syntax/JSON/lint findings, filters, ownership). Full backend suite: 13 passed ✅
- Python, Semgrep, ESLint rule packs, Docker sandbox for analyzers ❌
- Dashboard "Findings" tab and `api.ts` scan calls ❌

---

## Browser SDK (entry in `sdk-node`)
⚠️ Implemented and unit-tested; not yet verified in a real browser.

- `@triage/sdk/browser` (`src/browser.ts`): hooks `window` `error` and `unhandledrejection`, parses Chrome/Firefox/Safari stacks, scrubs PII, dedupes (1s window), flushes on page hide, truncates to the server's limits, caps 50 events per page ✅
- IIFE bundle `dist/triage-browser.global.js` (esbuild, exposes `window.Triage`); `npm run build` produces it ✅
- Scrubber shared with the Node entry (`src/scrub.ts`) ✅
- `test-browser.js` (stubbed DOM) passes alongside `test.js` ✅
- Demo React counter in `demo-app/public/` (error boundary, server and browser crash buttons, JSX compiled by `sucrase` so line numbers stay exact) ✅
- Real-browser end-to-end run (demo page to backend to dashboard) ❌ not done
- Per-key allowed-origin limits for browser API keys ❌ (a browser API key is public)

---

## Frontend hardening
✅ Done:
- Logout clears the axios token; token refresh is single-flight; refresh errors without a request config are handled
- Login and signup redirect signed-in users to the dashboard
- Project switching aborts in-flight requests and clears the previous project's data
- Incidents: "Load more" pagination (`20+` badge), polling only on the Incidents tab and while the browser tab is visible, visible "updates paused" state when polling fails
- Scrollable tab bar, tab badge padding fixed, modal animations defined, "Quick Setup" only on the API Keys tab, Vite template leftovers removed, page title and Inter font set

---

## Features 6–10
❌ Not started. Defined in `memory.md`.

---

## Known Issues / Tech Debt

Resolved:

| Issue | Priority | Status |
|-------|----------|--------|
| `user_service.py` fallback stub | Medium | Resolved |
| `docker-compose.yml` db and db_test configuration | High | Resolved |
| `DATABASE_URL` PostgreSQL switch | High | Resolved |
| User and Project scoping | High | Resolved |
| Dashboard UI & Token Security in memory | High | Resolved |
| `triage` (unrelated public npm package) in `demo-app` | Medium | Resolved |
| Identical re-pushes shared one `{sha}.zip`; pruning deleted the newest snapshot's archive | High | Resolved (prune skips paths kept snapshots use) |
| Copy button threw on non-secure origins | Low | Resolved (`execCommand` fallback) |
| Vite HMR in Docker on Windows | Low | Resolved, untested (`CHOKIDAR_USEPOLLING=true` enables `usePolling`) |
| Frontend lint warnings (`set-state-in-effect`, `only-export-components`) | Low | Resolved (loading flags set in the render-time reset; `useAuth` split into `context/useAuth.ts`; one targeted `oxlint-disable-next-line` on the fetch effect) |
| `.gitignore` missing `.env.*`, `backend/storage/`, `*.db` | High | Resolved (`.env.example` still tracked) |

Open (found in the latest code review, not yet fixed):

| Area | Issue | Priority |
|------|-------|----------|
| Backend / snapshots | Secret filtering only hides files from the tree; the raw uploaded zip, including `.env`/`.pem` files from a non-standard client, is still written to `storage/` | High |
| Backend / snapshots | Multipart body is fully buffered before the 20MB check; there is no HTTP-level size limit on `/snapshots` | Medium |
| Backend / snapshots | Dependency `version` is `String(100)` and `source_file` `String(300)`; a long git URL version or deep path makes the upload fail with a 500 | Medium |
| Backend / snapshots | Deleting a project leaves its archive files in `storage/{project_id}/` | Medium |
| Backend / CORS | `localhost:3000` was added with `allow_credentials=True`; any app on that origin can call `/auth/refresh` with the refresh cookie. `/ingest` needs a separate no-credentials CORS policy | Medium |
| Backend / auth | Registration with an existing email races to a 500 (IntegrityError); emails are not lowercased; no server-side password length rule; login returns early for unknown users (timing leak); refresh tokens cannot be revoked and are not rotated | Medium |
| Backend / auth | Argon2 hashing runs on the event loop and blocks other requests | Low |
| Backend / ingest | Rate limiting runs after the DB key lookup, so requests with random invalid keys are never limited; the limiter is in-memory per process | Medium |
| Backend / ingest | `Content-Length: abc` raises a 500 in the payload-size middleware; the chunked-body path buffers the whole body | Low |
| Backend / ingest | Upsert never updates `environment` or `release`; fingerprint ignores both, so staging and production merge | Low |
| Backend / fingerprint | The ID-stripping regex also rewrites ordinary words made only of letters a-f (for example "facade" and "decade" collapse to the same fingerprint) | Low |
| Backend / manifests | `requirements.txt` lines with extras (`uvicorn[standard]==0.54.0`) lose their pinned version; nested duplicate packages in `package-lock.json` collapse to one row; `package.json` ranges are shown as exact versions in the UI | Medium |
| Backend / analyzer | False positives: decorators and Flow-annotated files are reported as syntax errors; an exported TypeScript `enum` is reported as `no-undef` | Medium |
| Backend / db | `echo=True` logs every SQL statement and its parameters; deleting a project loads all child rows through the ORM cascade | Low |
| SDK / Node | Payloads are not truncated to server limits (message 2000, stack 16000), so long errors are rejected with a 422 and dropped silently; queued errors are lost on exit | Medium |
| SDK / CLI | Hard excludes are anchored to the project root: nested `node_modules`, `dist` and `build` folders in monorepos are still archived | Medium |
| Infra | Dev-only containers (`--reload`, Vite dev server) and `SECRET_KEY` in `docker-compose.yml`. `backend/triage.db` and `backend/storage/` were untracked from git (files still on disk; `backend/triage.db` can be deleted) | Medium |
| Housekeeping | `memory.md` is listed in `.gitignore` but referenced as documentation; `README.md` is empty | Low |

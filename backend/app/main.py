from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from app.api.routers import auth, projects, sdk, ingest, snapshots
from app.db.session import engine
import contextlib

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await engine.dispose()

app = FastAPI(title="Triage Engine API", lifespan=lifespan)

# Rate limiting
app.state.limiter = ingest.limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def check_payload_size(request: Request, call_next):
    if request.url.path.startswith("/ingest"):
        cl = request.headers.get("content-length")
        if cl and int(cl) > 65536:
            return JSONResponse(status_code=413, content={"detail": "Payload too large (maximum 64KB)"})
        # Guard chunked transfer-encoding requests where Content-Length is absent
        if not cl and request.method in {"POST", "PUT", "PATCH"}:
            body = await request.body()
            if len(body) > 65536:
                return JSONResponse(status_code=413, content={"detail": "Payload too large (maximum 64KB)"})
    return await call_next(request)


app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(projects.router, prefix="/projects", tags=["projects"])
app.include_router(sdk.router, prefix="/sdk", tags=["sdk"])
app.include_router(ingest.router)
app.include_router(snapshots.router)

@app.get("/health")
async def health_check():
    return {"status": "ok"}

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.auth import router as auth_router
from app.api.v1.live import register_event_loop, router as live_router
from app.api.v1.payment import router as payment_router
from app.api.v1.users import router as users_router
from app.db.session import Base, engine, ensure_sqlite_schema
from app.models.alert import Alert  # noqa: F401
from app.models.otp_state import OtpState  # noqa: F401
from app.models.transaction import Transaction  # noqa: F401
from app.models.user import User  # noqa: F401
from app.services.auth_service import ensure_demo_users
from app.db.session import SessionLocal

@asynccontextmanager
async def lifespan(_: FastAPI):
    register_event_loop(asyncio.get_running_loop())
    yield


app = FastAPI(title="Fraud Detection Auth Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

Base.metadata.create_all(bind=engine)
ensure_sqlite_schema()
with SessionLocal() as db:
    ensure_demo_users(db)
app.include_router(auth_router, prefix="/api/v1")
app.include_router(payment_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(live_router, prefix="/api/v1")


@app.get("/")
def root() -> dict[str, str]:
    return {
        "message": "Fraud Detection Auth Service is running",
        "health": "/health",
        "docs": "/docs",
    }


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy"}

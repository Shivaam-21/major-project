"""Live event feed for the admin command center.

Sync endpoints run in FastAPI's threadpool, so `broadcast_event` hands the
coroutine to the main event loop (captured at startup) instead of awaiting it.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.core.security import decode_access_token
from app.db.session import SessionLocal
from app.models.user import User

router = APIRouter(tags=["live"])
logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, event: dict) -> None:
        async with self._lock:
            connections = list(self._connections)
        for connection in connections:
            try:
                await connection.send_json(event)
            except Exception:
                await self.disconnect(connection)


manager = ConnectionManager()
_loop: asyncio.AbstractEventLoop | None = None


def register_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def broadcast_event(event_type: str, **payload) -> None:
    """Fire-and-forget broadcast, safe to call from sync request handlers."""
    if _loop is None or _loop.is_closed():
        return
    event = {
        "type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **payload,
    }
    try:
        asyncio.run_coroutine_threadsafe(manager.broadcast(event), _loop)
    except RuntimeError:
        logger.debug("Event loop unavailable; dropped live event %s", event_type)


def _resolve_admin(token: str) -> bool:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (ValueError, KeyError, TypeError):
        return False
    with SessionLocal() as db:
        user = db.get(User, user_id)
        return user is not None and user.role == "admin"


@router.websocket("/ws/live")
async def live_feed(websocket: WebSocket, token: str = Query(default="")) -> None:
    if not token or not _resolve_admin(token):
        await websocket.close(code=4401, reason="Admin authentication required")
        return

    await manager.connect(websocket)
    try:
        await websocket.send_json(
            {
                "type": "CONNECTED",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": "Live fraud feed connected",
            }
        )
        while True:
            # Clients send periodic pings to keep the connection alive; the
            # content is irrelevant.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)

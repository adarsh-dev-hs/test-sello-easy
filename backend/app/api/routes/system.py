"""MCP registry, signed file access for MCP servers, health."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Source, User
from app.security import get_current_user, verify_file_token
from app.services.mcp_hub import get_hub
from app.services.queue import get_pool

router = APIRouter(tags=["system"])


@router.get("/mcp/servers")
async def mcp_servers(_: User = Depends(get_current_user)):
    return await get_hub().describe()


@router.get("/files/{fid}")
async def get_file(fid: uuid.UUID, token: str, session: AsyncSession = Depends(get_session)):
    """Signed, short-lived URL used by the docparser MCP server to fetch uploads."""
    if not verify_file_token(token, fid):
        raise HTTPException(403, "Invalid or expired file token")
    src = await session.get(Source, fid)
    if src is None or not src.storage_path:
        raise HTTPException(404, "File not found")
    return FileResponse(src.storage_path, media_type=src.mime or None, filename=src.filename or None)


@router.get("/health")
async def health(session: AsyncSession = Depends(get_session)):
    db_ok = redis_ok = False
    try:
        await session.execute(text("select 1"))
        db_ok = True
    except Exception:  # noqa: BLE001
        pass
    try:
        redis_ok = bool(await (await get_pool()).ping())
    except Exception:  # noqa: BLE001
        pass
    return {"ok": db_ok and redis_ok, "db": db_ok, "redis": redis_ok}

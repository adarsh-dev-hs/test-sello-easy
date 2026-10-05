import uuid

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session
from app.models import Company, Lead, Signal, User, Workspace
from app.security import get_current_user


async def owned_workspace(
    wid: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Workspace:
    ws = await session.get(Workspace, wid)
    if ws is None or ws.owner_id != user.id:
        raise HTTPException(404, "Workspace not found")
    return ws


async def _company_for(session: AsyncSession, cid: uuid.UUID, user: User) -> Company:
    company = await session.get(Company, cid)
    if company is None:
        raise HTTPException(404, "Company not found")
    ws = await session.get(Workspace, company.workspace_id)
    if ws is None or ws.owner_id != user.id:
        raise HTTPException(404, "Company not found")
    return company


async def owned_company(
    cid: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Company:
    return await _company_for(session, cid, user)


async def owned_lead(
    lid: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Lead:
    lead = await session.get(Lead, lid)
    if lead is None:
        raise HTTPException(404, "Lead not found")
    await _company_for(session, lead.company_id, user)
    return lead


async def owned_signal(
    sid: uuid.UUID, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
) -> Signal:
    sig = await session.get(Signal, sid)
    if sig is None:
        raise HTTPException(404, "Signal not found")
    await _company_for(session, sig.company_id, user)
    return sig

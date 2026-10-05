"""ICP, signals and signal runs."""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_schemas import CHANNELS, ICP
from app.api.deps import owned_company, owned_signal
from app.api.serializers import icp_out, run_out, signal_out
from app.db import get_session
from app.models import Company, ICPRecord, Signal, SignalRun
from app.services.queue import enqueue_pipeline

router = APIRouter(tags=["intel"])


class ICPIn(BaseModel):
    data: ICP


class SignalPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    channels: list[str] | None = None
    queries: list[str] | None = None
    weight: float | None = None
    lookback_days: int | None = None
    is_active: bool | None = None


@router.get("/companies/{cid}/icp")
async def get_icp(company: Company = Depends(owned_company), session: AsyncSession = Depends(get_session)):
    rec = await session.scalar(
        select(ICPRecord).where(ICPRecord.company_id == company.id, ICPRecord.is_active.is_(True))
    )
    if rec is None:
        raise HTTPException(404, "ICP not generated yet")
    return icp_out(rec)


@router.get("/companies/{cid}/icp/versions")
async def icp_versions(company: Company = Depends(owned_company), session: AsyncSession = Depends(get_session)):
    rows = (
        await session.scalars(
            select(ICPRecord).where(ICPRecord.company_id == company.id).order_by(ICPRecord.version.desc())
        )
    ).all()
    return [icp_out(r) for r in rows]


@router.put("/companies/{cid}/icp")
async def put_icp(body: ICPIn, company: Company = Depends(owned_company), session: AsyncSession = Depends(get_session)):
    version = (await session.scalar(select(func.max(ICPRecord.version)).where(ICPRecord.company_id == company.id))) or 0
    await session.execute(update(ICPRecord).where(ICPRecord.company_id == company.id).values(is_active=False))
    rec = ICPRecord(company_id=company.id, version=version + 1, is_active=True, origin="user", data=body.data.model_dump())
    session.add(rec)
    await session.commit()
    return icp_out(rec)


@router.post("/companies/{cid}/icp/regenerate")
async def regenerate_icp(company: Company = Depends(owned_company)):
    return {"job_id": await enqueue_pipeline(company.id, "icp", only=True)}


@router.get("/companies/{cid}/signals")
async def list_signals(company: Company = Depends(owned_company), session: AsyncSession = Depends(get_session)):
    rows = (
        await session.scalars(
            select(Signal)
            .where(Signal.company_id == company.id, Signal.archived.is_(False))
            .order_by(Signal.weight.desc(), Signal.created_at)
        )
    ).all()
    return [signal_out(s) for s in rows]


@router.post("/companies/{cid}/signals/regenerate")
async def regenerate_signals(company: Company = Depends(owned_company)):
    return {"job_id": await enqueue_pipeline(company.id, "signals", only=True)}


@router.patch("/signals/{sid}")
async def patch_signal(
    body: SignalPatch, sig: Signal = Depends(owned_signal), session: AsyncSession = Depends(get_session)
):
    data = body.model_dump(exclude_unset=True)
    if "channels" in data:
        bad = [c for c in data["channels"] or [] if c not in CHANNELS]
        if bad:
            raise HTTPException(422, f"Unknown channels: {bad}")
    if "queries" in data:
        data["queries"] = [q.strip() for q in data["queries"] or [] if q.strip()]
    if "weight" in data and data["weight"] is not None:
        data["weight"] = min(1.0, max(0.0, data["weight"]))
    for k, v in data.items():
        if v is not None:
            setattr(sig, k, v)
    await session.commit()
    return signal_out(sig)


@router.post("/companies/{cid}/runs")
async def start_run(company: Company = Depends(owned_company)):
    return {"job_id": await enqueue_pipeline(company.id, "leads", only=True)}


@router.get("/companies/{cid}/runs")
async def list_runs(company: Company = Depends(owned_company), session: AsyncSession = Depends(get_session)):
    rows = (
        await session.scalars(
            select(SignalRun).where(SignalRun.company_id == company.id).order_by(SignalRun.started_at.desc()).limit(50)
        )
    ).all()
    return [run_out(r) for r in rows]

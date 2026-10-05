"""Workspaces, seller company, pipeline control, sources and profile."""

from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_schemas import CompanyProfile
from app.api.deps import owned_company, owned_workspace
from app.api.serializers import company_out, company_summary, source_out
from app.db import get_session
from app.models import Company, Lead, Signal, Source, User, Workspace
from app.pipelines.common import status_view
from app.security import get_current_user
from app.services import storage
from app.services.queue import enqueue_pipeline

router = APIRouter(tags=["companies"])
MAX_UPLOAD_BYTES = 200 * 1024 * 1024


class WorkspaceIn(BaseModel):
    name: str


class CompanyIn(BaseModel):
    name: str
    website_url: str | None = None


class PipelineIn(BaseModel):
    from_step: Literal["ingest", "profile", "icp", "signals", "leads"] = "ingest"
    only: bool = False


async def _workspace_out(session: AsyncSession, ws: Workspace) -> dict:
    company = ws.company
    summary = None
    if company is not None:
        leads = await session.scalar(select(func.count()).select_from(Lead).where(Lead.company_id == company.id))
        sigs = await session.scalar(
            select(func.count())
            .select_from(Signal)
            .where(Signal.company_id == company.id, Signal.archived.is_(False))
        )
        summary = company_summary(company, leads or 0, sigs or 0)
    return {"id": str(ws.id), "name": ws.name, "created_at": ws.created_at, "company": summary}


@router.get("/workspaces")
async def list_workspaces(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    rows = (
        await session.scalars(select(Workspace).where(Workspace.owner_id == user.id).order_by(Workspace.created_at))
    ).all()
    return [await _workspace_out(session, ws) for ws in rows]


@router.post("/workspaces")
async def create_workspace(
    body: WorkspaceIn, user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)
):
    ws = Workspace(owner_id=user.id, name=body.name.strip() or "Workspace")
    session.add(ws)
    await session.commit()
    await session.refresh(ws, ["company"])
    return await _workspace_out(session, ws)


@router.post("/workspaces/{wid}/company")
async def create_company(
    body: CompanyIn, ws: Workspace = Depends(owned_workspace), session: AsyncSession = Depends(get_session)
):
    if ws.company is not None:
        raise HTTPException(409, "This workspace already has a company")
    url = (body.website_url or "").strip() or None
    if url and not url.startswith(("http://", "https://")):
        url = "https://" + url
    company = Company(workspace_id=ws.id, name=body.name.strip(), website_url=url, status="draft", status_detail={})
    session.add(company)
    await session.commit()
    return company_out(company)


@router.get("/companies/{cid}")
async def get_company(company: Company = Depends(owned_company)):
    return company_out(company)


@router.get("/companies/{cid}/status")
async def get_status(company: Company = Depends(owned_company)):
    return status_view(company)


@router.post("/companies/{cid}/pipeline")
async def start_pipeline(body: PipelineIn, company: Company = Depends(owned_company)):
    return {"job_id": await enqueue_pipeline(company.id, body.from_step, body.only)}


@router.post("/companies/{cid}/sources")
async def upload_sources(
    files: list[UploadFile] = File(...),
    company: Company = Depends(owned_company),
    session: AsyncSession = Depends(get_session),
):
    created = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"{f.filename} exceeds 200MB")
        name = f.filename or "upload"
        path = storage.save_bytes(company.id, name, data)
        src = Source(
            company_id=company.id,
            kind=storage.kind_for(name),
            uri=f"upload://{name}",
            filename=name,
            mime=f.content_type or storage.mime_for(name),
            storage_path=path,
            status="pending",
            meta={"size": len(data)},
        )
        session.add(src)
        created.append(src)
    await session.commit()
    return [source_out(s) for s in created]


@router.get("/companies/{cid}/sources")
async def list_sources(company: Company = Depends(owned_company), session: AsyncSession = Depends(get_session)):
    rows = (
        await session.scalars(
            select(Source).where(Source.company_id == company.id).order_by(Source.kind, Source.created_at)
        )
    ).all()
    return [source_out(s) for s in rows]


@router.get("/companies/{cid}/profile")
async def get_profile(company: Company = Depends(owned_company)):
    if not company.profile:
        raise HTTPException(404, "Profile not built yet")
    return company.profile


@router.put("/companies/{cid}/profile")
async def put_profile(
    body: CompanyProfile, company: Company = Depends(owned_company), session: AsyncSession = Depends(get_session)
):
    company.profile = body.model_dump()
    company.profile_edited = True
    await session.commit()
    return company.profile

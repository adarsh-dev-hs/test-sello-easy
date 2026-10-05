"""Signal feed (leads) and outreach actions."""

import re
import urllib.parse
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import owned_company, owned_lead
from app.api.serializers import activity_out, lead_out
from app.db import get_session
from app.models import Activity, Company, ICPRecord, Lead, LeadSignal, RawHit, Signal, User
from app.pipelines.drafts import draft_message
from app.security import get_current_user
from app.services import llm
from app.services.mailer import send_email

router = APIRouter(tags=["leads"])


class LeadPatch(BaseModel):
    status: Literal["new", "contacted", "qualified", "disqualified"]


class DraftIn(BaseModel):
    channel: Literal["email", "whatsapp"]


class EmailIn(BaseModel):
    to: str
    subject: str
    body: str


class CallIn(BaseModel):
    outcome: Literal["connected", "voicemail", "no_answer", "wrong_number"]
    notes: str = ""


class WhatsAppIn(BaseModel):
    phone: str
    message: str


class NoteIn(BaseModel):
    text: str


@router.get("/companies/{cid}/leads")
async def list_leads(
    company: Company = Depends(owned_company),
    session: AsyncSession = Depends(get_session),
    status: str | None = None,
    signal_type: str | None = None,
    channel: str | None = None,
    min_score: float | None = None,
    q: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    conds = [Lead.company_id == company.id]
    if status:
        conds.append(Lead.status == status)
    if min_score is not None:
        conds.append(Lead.score >= min_score)
    if q:
        like = f"%{q}%"
        conds.append(
            or_(Lead.org_name.ilike(like), Lead.contact_name.ilike(like), Lead.domain.ilike(like), Lead.industry.ilike(like))
        )
    if signal_type:
        conds.append(
            exists().where(
                LeadSignal.lead_id == Lead.id, LeadSignal.signal_id == Signal.id, Signal.type == signal_type
            )
        )
    if channel:
        conds.append(
            exists().where(LeadSignal.lead_id == Lead.id, LeadSignal.raw_hit_id == RawHit.id, RawHit.source == channel)
        )
    total = await session.scalar(select(func.count()).select_from(Lead).where(*conds))
    rows = (
        await session.scalars(
            select(Lead)
            .where(*conds)
            .order_by(Lead.score.desc(), Lead.last_signal_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return {"items": [lead_out(lead) for lead in rows], "total": total or 0, "page": page, "page_size": page_size}


async def _activities(session: AsyncSession, lead: Lead) -> list[dict]:
    rows = (
        await session.scalars(select(Activity).where(Activity.lead_id == lead.id).order_by(Activity.created_at.desc()))
    ).all()
    return [activity_out(a) for a in rows]


@router.get("/leads/{lid}")
async def get_lead(lead: Lead = Depends(owned_lead), session: AsyncSession = Depends(get_session)):
    return {**lead_out(lead), "activities": await _activities(session, lead)}


async def _log(session, lead: Lead, user: User, channel: str, payload: dict, status: str = "done") -> Activity:
    act = Activity(lead_id=lead.id, user_id=user.id, channel=channel, payload=payload, status=status)
    session.add(act)
    if channel in ("email", "call", "whatsapp") and status == "done" and lead.status == "new":
        lead.status = "contacted"
    await session.commit()
    await session.refresh(act, ["user"])
    return act


@router.patch("/leads/{lid}")
async def patch_lead(
    body: LeadPatch,
    lead: Lead = Depends(owned_lead),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    old = lead.status
    lead.status = body.status
    await _log(session, lead, user, "status", {"from": old, "to": body.status})
    return lead_out(lead)


@router.post("/leads/{lid}/draft")
async def draft(body: DraftIn, lead: Lead = Depends(owned_lead), session: AsyncSession = Depends(get_session)):
    company = await session.get(Company, lead.company_id)
    icp = await session.scalar(
        select(ICPRecord).where(ICPRecord.company_id == company.id, ICPRecord.is_active.is_(True))
    )
    try:
        d = await draft_message(lead, body.channel, company.profile or {}, icp.data if icp else {})
    except llm.LLMError as e:
        raise HTTPException(503, str(e))
    return {"subject": d.subject, "body": d.body}


@router.post("/leads/{lid}/actions/email")
async def email_action(
    body: EmailIn,
    lead: Lead = Depends(owned_lead),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    payload = {"to": body.to, "subject": body.subject, "body": body.body}
    try:
        await send_email(body.to, body.subject, body.body)
    except Exception as e:  # noqa: BLE001
        await _log(session, lead, user, "email", {**payload, "error": str(e)}, status="failed")
        raise HTTPException(502, f"Email sending failed: {e}")
    return activity_out(await _log(session, lead, user, "email", payload))


@router.post("/leads/{lid}/actions/call")
async def call_action(
    body: CallIn,
    lead: Lead = Depends(owned_lead),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    payload = {"outcome": body.outcome, "notes": body.notes, "phone": lead.phone}
    return activity_out(await _log(session, lead, user, "call", payload))


@router.post("/leads/{lid}/actions/whatsapp")
async def whatsapp_action(
    body: WhatsAppIn,
    lead: Lead = Depends(owned_lead),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    digits = re.sub(r"\D", "", body.phone)
    if len(digits) < 7:
        raise HTTPException(422, "Invalid phone number")
    url = f"https://wa.me/{digits}?text={urllib.parse.quote(body.message)}"
    act = await _log(session, lead, user, "whatsapp", {"phone": body.phone, "message": body.message, "url": url})
    return {"activity": activity_out(act), "url": url}


@router.post("/leads/{lid}/notes")
async def add_note(
    body: NoteIn,
    lead: Lead = Depends(owned_lead),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
):
    return activity_out(await _log(session, lead, user, "note", {"text": body.text}))

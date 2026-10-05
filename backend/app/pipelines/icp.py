"""Step 3: CompanyProfile → ICP (new active version)."""

import json
import uuid

from sqlalchemy import func, select, update

from app.ai_schemas import ICP
from app.db import SessionLocal
from app.models import Company, ICPRecord
from app.pipelines.common import PipelineError, update_status
from app.services import llm

ICP_SYSTEM = """You are a B2B go-to-market strategist. From the SELLER's company profile, define its \
Ideal Customer Profile: the organisations and people most likely to BUY the seller's products.
Rules:
- firmographics.industries: 4-8 specific buyer industries; employee_range like "200-2000" or "1000+"; \
geographies: buyer regions/countries; tech_stack: technologies buyers typically run that relate to the offer.
- personas: 3-5 buying-committee roles (exact job titles used in the market), with goals and pains.
- pain_points: problems the seller solves, phrased the way buyers describe them online.
- buying_triggers: observable events that indicate a buyer is in-market (hiring, expansion, new exec, funding...).
- keywords: 8-15 phrases buyers use when they have the problem (good for searching posts, news, jobs).
- negative_keywords: 5-10 terms that indicate noise (consumers, students, job seekers, the seller's \
competitors' marketing...).
- exclusions: organisation types to exclude (e.g. competitors, vendors, too small/too large).
- disqualifiers: facts that rule a prospect out.
Be concrete and consistent with the profile."""


async def run_icp(company_id: uuid.UUID) -> None:
    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        profile = company.profile
    if not profile:
        raise PipelineError("Company profile missing — build the profile first")

    await update_status(company_id, message="Defining ideal customer profile", progress=30)
    icp = await llm.structured(ICP_SYSTEM, "SELLER PROFILE:\n" + json.dumps(profile, indent=1), ICP)

    async with SessionLocal() as s:
        version = (await s.scalar(select(func.max(ICPRecord.version)).where(ICPRecord.company_id == company_id))) or 0
        await s.execute(update(ICPRecord).where(ICPRecord.company_id == company_id).values(is_active=False))
        s.add(ICPRecord(company_id=company_id, version=version + 1, is_active=True, origin="ai", data=icp.model_dump()))
        await s.commit()
    await update_status(company_id, message="ICP ready", progress=100)


async def active_icp(session, company_id: uuid.UUID) -> ICPRecord | None:
    return await session.scalar(
        select(ICPRecord).where(ICPRecord.company_id == company_id, ICPRecord.is_active.is_(True))
    )

"""Step 4: ICP → runnable signal definitions (limited to channels our MCP servers provide)."""

import json
import uuid

from sqlalchemy import update

from app.ai_schemas import SignalSet
from app.db import SessionLocal
from app.models import Company, Signal
from app.pipelines.common import PipelineError, update_status
from app.pipelines.icp import active_icp
from app.services import llm
from app.services.mcp_hub import get_hub

# channel → (capability, tool, extra args)
CHANNEL_ROUTES: dict[str, tuple[str, str, dict]] = {
    "web": ("web_search", "search_web", {}),
    "news": ("news_search", "search_news", {}),
    "jobs": ("job_search", "search_jobs", {}),
    "x": ("social_search", "search_social", {"platform": "x"}),
    "linkedin": ("social_search", "search_social", {"platform": "linkedin"}),
    "reddit": ("social_search", "search_social", {"platform": "reddit"}),
    "facebook": ("social_search", "search_social", {"platform": "facebook"}),
}

SIGNALS_SYSTEM = """You design buying-signal monitors for a B2B sales team. Given the SELLER profile and \
its ICP, create 6-8 signals: observable public events/posts that show an organisation matching the ICP \
is likely in-market for the seller's products.
Rules:
- Use a mix of types (hiring, expansion, leadership_change, pain_post, funding, tech_adoption, \
rfp_tender, competitor_mention, event_participation) — at least 4 different types.
- channels: choose only from AVAILABLE CHANNELS. Hiring signals → "jobs" (+ "linkedin"); \
pain posts → "reddit"/"x"; company announcements → "news"/"web"; exec moves → "linkedin"/"news". \
Across all signals cover at least 4 different channels.
- queries: 3-4 short search queries (3-6 words each) exactly as typed into a search box: plain words, \
no quotes, no boolean operators, no site: filters. Combine the trigger with ICP industry/persona/pain \
vocabulary (e.g. "hiring OT network engineer manufacturing").
- weight: 0.4-1.0 = how strongly the signal indicates buying intent. lookback_days: 14-90.
- description: one sentence on why this signal matters to the seller."""


def available_channels() -> list[str]:
    caps = {c for s in get_hub().servers if s.enabled for c in s.capabilities}
    return [ch for ch, (cap, _, _) in CHANNEL_ROUTES.items() if cap in caps]


async def run_signals(company_id: uuid.UUID) -> None:
    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        profile = company.profile
        icp = await active_icp(s, company_id)
    if not profile or icp is None:
        raise PipelineError("Profile and ICP are required before generating signals")
    channels = available_channels()
    if not channels:
        raise PipelineError("No search-capable MCP servers are enabled")

    await update_status(company_id, message="Designing buying signals", progress=30)
    user = (
        f"AVAILABLE CHANNELS: {', '.join(channels)}\n\n"
        f"SELLER PROFILE:\n{json.dumps(profile, indent=1)}\n\nICP:\n{json.dumps(icp.data, indent=1)}"
    )
    result = await llm.structured(SIGNALS_SYSTEM, user, SignalSet)

    async with SessionLocal() as s:
        await s.execute(
            update(Signal).where(Signal.company_id == company_id).values(archived=True, is_active=False)
        )
        for sd in result.signals[:10]:
            chans = [c for c in dict.fromkeys(sd.channels) if c in channels] or channels[:1]
            queries = [q.strip() for q in sd.queries if q.strip()][:5]
            if not queries:
                continue
            s.add(
                Signal(
                    company_id=company_id,
                    icp_id=icp.id,
                    name=sd.name[:300],
                    type=sd.type,
                    description=sd.description,
                    channels=chans,
                    queries=queries,
                    weight=min(1.0, max(0.1, sd.weight)),
                    lookback_days=min(180, max(7, sd.lookback_days)),
                    is_active=True,
                )
            )
        await s.commit()
    await update_status(company_id, message=f"{len(result.signals)} signals created", progress=100)

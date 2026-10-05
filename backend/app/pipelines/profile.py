"""Step 2: extracted source text → CompanyProfile (map-reduce when the corpus is large)."""

import asyncio
import uuid

from sqlalchemy import select

from app.ai_schemas import CompanyProfile, SourceSummary
from app.db import SessionLocal
from app.models import Company, Source
from app.pipelines.common import PipelineError, update_status
from app.services import llm

DIRECT_LIMIT = 60_000
PER_SOURCE_LIMIT = 12_000
PRIORITY = ("product", "solution", "platform", "about", "industr", "customer", "pricing", "integration")

PROFILE_SYSTEM = """You are a senior B2B market analyst. Build a factual profile of the SELLER company \
described by the sources (its website pages and its own documents).
Rules:
- Use only information present in the sources. Unknown scalars → null, unknown lists → [].
- products: every distinct product/offering with concrete key features.
- value_propositions / differentiators: specific, not generic marketing fluff.
- target_markets: industries/segments the seller sells to; geographies: regions it serves.
- customer_examples: named customers or case studies mentioned.
- competitors: named competitors or competitor categories mentioned.
- source_citations: 5-10 of the most important claims, each with the exact source_id given in the \
[source:...] header and a short verbatim quote (<= 25 words) supporting it. Cite several different sources."""

SUMMARY_SYSTEM = """Summarise this source about a company for a B2B analyst. Keep every concrete fact: \
products, features, customers, industries, regions, pricing, numbers, competitors. 150-300 words."""


def _priority(src: Source) -> int:
    uri = (src.uri or "").lower()
    if src.kind != "website":
        return 0
    return 1 if any(p in uri for p in PRIORITY) else 2


def _header(src: Source) -> str:
    return f"[source:{src.id} kind={src.kind} name={src.filename or ''} uri={src.uri}]"


async def run_profile(company_id: uuid.UUID) -> None:
    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        name, website = company.name, company.website_url
        sources = (
            await s.scalars(
                select(Source).where(
                    Source.company_id == company_id, Source.status == "parsed", Source.extracted_text.is_not(None)
                )
            )
        ).all()
    if not sources:
        raise PipelineError("No parsed sources — run ingestion first")
    sources = sorted(sources, key=_priority)

    total = sum(len(src.extracted_text) for src in sources)
    if total <= DIRECT_LIMIT:
        corpus = "\n\n".join(f"{_header(src)}\n{src.extracted_text}" for src in sources)
    else:
        await update_status(company_id, message=f"Summarising {len(sources)} sources", progress=10)
        summaries = await asyncio.gather(
            *(
                llm.structured(SUMMARY_SYSTEM, src.extracted_text[:PER_SOURCE_LIMIT], SourceSummary, cheap=True)
                for src in sources[:40]
            )
        )
        corpus = "\n\n".join(
            f"{_header(src)}\n{sm.summary}\nFacts:\n- " + "\n- ".join(sm.key_facts)
            for src, sm in zip(sources, summaries)
        )

    await update_status(company_id, message="Writing company profile", progress=60)
    user = f"Seller company name: {name}\nWebsite: {website or 'n/a'}\n\nSOURCES:\n{corpus}"
    profile = await llm.structured(PROFILE_SYSTEM, user, CompanyProfile)
    valid_ids = {str(src.id) for src in sources}
    profile.source_citations = [c for c in profile.source_citations if c.source_id in valid_ids]

    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        company.profile = profile.model_dump()
        company.profile_edited = False
        await s.commit()
    await update_status(company_id, message="Profile ready", progress=100)

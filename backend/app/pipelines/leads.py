"""Step 5: run active signals through MCP search tools → qualify hits with the LLM → upsert, enrich, score leads."""

import asyncio
import hashlib
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.ai_schemas import HitQualificationBatch
from app.config import settings
from app.db import SessionLocal
from app.models import Company, Lead, LeadSignal, RawHit, Signal, SignalRun, utcnow
from app.pipelines import scoring
from app.pipelines.common import PipelineError, update_status
from app.pipelines.icp import active_icp
from app.pipelines.signals import CHANNEL_ROUTES
from app.services import llm
from app.services.mcp_hub import MCPError, get_hub

log = logging.getLogger(__name__)
QUALIFY_BATCH = 8
MAX_QUERIES_PER_SIGNAL = 4
HITS_PER_CALL = 8

QUALIFY_SYSTEM = """You qualify sales leads for a B2B SELLER. Each HIT is a public post, article or \
job ad returned by a buying-signal search. Search results are noisy: most hits will NOT be relevant. \
Judge every hit (by hit_index) strictly on what its own title and snippet say.
For each hit fill, in order:
- evidence_quote: the exact phrase (copied verbatim, 5-25 words) from the title or snippet that best \
shows the buying signal. If nothing in the text shows it, use "".
- shows_signal: true only if the text itself explicitly shows the signal named for that hit.
- seller_can_help: true only if the text explicitly describes a need, project or problem that the \
SELLER's products solve (see seller products / pain_points). Do NOT infer needs from generic growth, \
funding or expansion that is unrelated to what the seller sells (e.g. a finance-system project is not \
a connectivity need; a warehouse robot Wi-Fi problem is not an accounts-payable need).
- relevant: true only if shows_signal AND seller_can_help AND a specific prospect organisation is \
named AND it is not the seller, a competitor/vendor of similar products, a consumer/student/personal \
post, and it does not violate the ICP exclusions/disqualifiers or negative keywords.
Extraction: prospect_org exactly as written; prospect_domain only if a domain of that organisation \
appears in the hit, else null; contact_name/contact_title only if a person at the prospect is named; \
prospect_industry/prospect_location only if stated or obvious.
confidence 0-1 = how sure you are this is a real in-market prospect for THIS seller. icp_fit = how \
well the organisation matches the ICP firmographics. reason: one sentence a salesperson can read \
("why this lead"), grounded in the evidence_quote."""


def _url_hash(url: str) -> str:
    return hashlib.sha256(url.strip().lower().rstrip("/").encode()).hexdigest()


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _quote_in_text(quote: str, text: str) -> bool:
    """Anti-hallucination check: the LLM's evidence quote must actually occur in the hit."""
    q = _norm(quote)
    if len(q) < 8:
        return False
    t = _norm(text)
    if q in t:
        return True
    # tolerate light paraphrase/ellipsis: >= 80% of quote words appear in order-insensitive form
    words = q.split()
    return len(words) >= 4 and sum(w in t.split() for w in words) / len(words) >= 0.8


def _parse_dt(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _icp_brief(profile: dict, icp: dict) -> str:
    firmo = icp.get("firmographics") or {}
    return json.dumps(
        {
            "seller": {
                "name": profile.get("name"),
                "one_liner": profile.get("one_liner"),
                "products": [p.get("name") + ": " + (p.get("description") or "")[:160] for p in profile.get("products") or []],
                "competitors": profile.get("competitors"),
            },
            "icp_summary": icp.get("summary"),
            "pain_points": icp.get("pain_points"),
            "industries": firmo.get("industries"),
            "employee_range": firmo.get("employee_range"),
            "geographies": firmo.get("geographies"),
            "personas": [p.get("title") for p in icp.get("personas") or []],
            "exclusions": icp.get("exclusions"),
            "disqualifiers": icp.get("disqualifiers"),
            "negative_keywords": icp.get("negative_keywords"),
        },
        indent=1,
    )


async def run_leads(company_id: uuid.UUID) -> dict:
    hub = get_hub()
    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        profile = company.profile or {}
        icp_rec = await active_icp(s, company_id)
        signals = (
            await s.scalars(
                select(Signal).where(
                    Signal.company_id == company_id, Signal.is_active.is_(True), Signal.archived.is_(False)
                )
            )
        ).all()
        if icp_rec is None or not signals:
            raise PipelineError("An ICP and at least one active signal are required to find leads")
        icp = icp_rec.data
        run = SignalRun(company_id=company_id, status="running", stats={})
        s.add(run)
        await s.commit()
        run_id = run.id
        signal_info = {
            sig.id: {"name": sig.name, "type": sig.type, "weight": sig.weight} for sig in signals
        }

    stats = {"queries": 0, "mcp_calls": 0, "hits": 0, "new_hits": 0, "relevant": 0, "new_leads": 0, "updated_leads": 0}
    try:
        # 1. Search ------------------------------------------------------------------------------
        calls, call_signal = [], []
        for sig in signals:
            for q in (sig.queries or [])[:MAX_QUERIES_PER_SIGNAL]:
                stats["queries"] += 1
                for ch in sig.channels or []:
                    if ch not in CHANNEL_ROUTES:
                        continue
                    cap, tool, extra = CHANNEL_ROUTES[ch]
                    args = {"query": q, "since_days": sig.lookback_days, "limit": HITS_PER_CALL, **extra}
                    calls.append((cap, tool, args))
                    call_signal.append(sig.id)
        calls, call_signal = calls[: settings.max_mcp_calls_per_run], call_signal[: settings.max_mcp_calls_per_run]
        await update_status(company_id, message=f"Searching {len(calls)} signal queries via MCP", progress=10)
        results = await hub.fan_out(calls, concurrency=6, company_id=company_id, run_id=run_id)
        stats["mcp_calls"] = len(calls)

        # 2. Normalise + dedupe -----------------------------------------------------------------
        seen: dict[str, dict] = {}
        errors = 0
        for sig_id, res in zip(call_signal, results):
            if isinstance(res, MCPError):
                errors += 1
                continue
            for h in (res or {}).get("hits") or []:
                url = (h.get("url") or "").strip()
                if not url:
                    continue
                stats["hits"] += 1
                key = _url_hash(url)
                if key not in seen:
                    seen[key] = {**h, "url": url, "url_hash": key, "signal_id": sig_id}
        if calls and errors == len(calls):
            raise PipelineError("All MCP search calls failed — check MCP server health on the Settings page")

        new_hits: list[dict] = []
        async with SessionLocal() as s:
            for h in seen.values():
                stmt = (
                    pg_insert(RawHit)
                    .values(
                        id=uuid.uuid4(),
                        company_id=company_id,
                        run_id=run_id,
                        signal_id=h["signal_id"],
                        source=(h.get("source") or "web")[:20],
                        url=h["url"][:2000],
                        url_hash=h["url_hash"],
                        title=h.get("title") or "",
                        snippet=h.get("snippet") or "",
                        author=(h.get("author") or None),
                        published_at=_parse_dt(h.get("published_at")),
                        payload={k: v for k, v in h.items() if k != "signal_id"},
                        created_at=utcnow(),
                    )
                    .on_conflict_do_nothing(constraint="uq_raw_hits_company_url")
                    .returning(RawHit.id)
                )
                hit_id = await s.scalar(stmt)
                if hit_id:
                    new_hits.append({**h, "id": hit_id})
            await s.commit()
        stats["new_hits"] = len(new_hits)

        # 3. Qualify with LLM -------------------------------------------------------------------
        await update_status(company_id, message=f"Qualifying {len(new_hits)} new hits with AI", progress=40)
        brief = _icp_brief(profile, icp)
        batches = [new_hits[i : i + QUALIFY_BATCH] for i in range(0, len(new_hits), QUALIFY_BATCH)]
        batches = batches[: settings.max_llm_calls_per_run]

        async def qualify(batch: list[dict]):
            items = [
                {
                    "hit_index": i,
                    "signal": signal_info[h["signal_id"]]["name"],
                    "signal_type": signal_info[h["signal_id"]]["type"],
                    "source": h.get("source"),
                    "title": h.get("title"),
                    "snippet": h.get("snippet"),
                    "author": h.get("author"),
                    "company_hint": h.get("company"),
                    "url": h.get("url"),
                }
                for i, h in enumerate(batch)
            ]
            user = f"SELLER & ICP:\n{brief}\n\nHITS:\n{json.dumps(items, indent=1)}"
            try:
                out = await llm.structured(
                    QUALIFY_SYSTEM, user, HitQualificationBatch, model=settings.openai_model_qualify or None
                )
            except Exception as e:  # noqa: BLE001
                log.warning("qualification batch failed: %s", e)
                return batch, {}
            return batch, {r.hit_index: r for r in out.results}

        qualified = await asyncio.gather(*(qualify(b) for b in batches))

        # 4. Upsert leads -----------------------------------------------------------------------
        touched: set[uuid.UUID] = set()
        new_lead_ids: set[uuid.UUID] = set()
        async with SessionLocal() as s:
            for batch, by_idx in qualified:
                for i, h in enumerate(batch):
                    q = by_idx.get(i)
                    hit = await s.get(RawHit, h["id"])
                    if q is None:
                        hit.relevant, hit.reason = None, "not qualified (LLM error)"
                        continue
                    grounded = _quote_in_text(q.evidence_quote, f"{h.get('title') or ''} {h.get('snippet') or ''}")
                    hit.relevant = bool(
                        q.relevant and q.shows_signal and q.seller_can_help and q.prospect_org and grounded
                    )
                    hit.reason = q.reason if grounded else f"rejected: evidence quote not found in hit ({q.reason})"
                    if not hit.relevant:
                        continue
                    key = scoring.dedupe_key(q.prospect_org, q.prospect_domain)
                    if not key:
                        continue
                    stats["relevant"] += 1
                    lead = await s.scalar(select(Lead).where(Lead.company_id == company_id, Lead.dedupe_key == key))
                    if lead is None:
                        # also try the name-based key in case domain-based key differs
                        name_key = scoring.dedupe_key(q.prospect_org, None)
                        lead = await s.scalar(
                            select(Lead).where(Lead.company_id == company_id, Lead.dedupe_key == name_key)
                        )
                    if lead is None:
                        lead = Lead(
                            company_id=company_id,
                            dedupe_key=key,
                            org_name=q.prospect_org[:300],
                            domain=q.prospect_domain,
                            industry=q.prospect_industry,
                            hq=q.prospect_location,
                            contact_name=q.contact_name,
                            contact_title=q.contact_title,
                            llm_fit=q.icp_fit,
                            contacts=[],
                            score_breakdown={},
                        )
                        s.add(lead)
                        await s.flush()
                        new_lead_ids.add(lead.id)
                    else:
                        lead.industry = lead.industry or q.prospect_industry
                        lead.hq = lead.hq or q.prospect_location
                        lead.domain = lead.domain or q.prospect_domain
                        if q.contact_name and not lead.contact_name:
                            lead.contact_name, lead.contact_title = q.contact_name, q.contact_title
                        lead.llm_fit = _better_fit(lead.llm_fit, q.icp_fit)
                    lead.last_signal_at = utcnow()
                    s.add(
                        LeadSignal(
                            lead_id=lead.id,
                            signal_id=h["signal_id"],
                            raw_hit_id=hit.id,
                            confidence=max(0.0, min(1.0, q.confidence)),
                            explanation=q.reason,
                        )
                    )
                    touched.add(lead.id)
            await s.commit()
        stats["new_leads"] = len(new_lead_ids)
        stats["updated_leads"] = len(touched - new_lead_ids)

        # 5. Enrich new leads -------------------------------------------------------------------
        await update_status(company_id, message=f"Enriching {len(new_lead_ids)} new leads", progress=75)
        persona_titles = [p.get("title") for p in icp.get("personas") or [] if p.get("title")]
        await _enrich(hub, company_id, run_id, list(new_lead_ids), persona_titles)

        # 6. Score ------------------------------------------------------------------------------
        await _score(list(touched), icp)

        async with SessionLocal() as s:
            run = await s.get(SignalRun, run_id)
            run.status, run.finished_at, run.stats = "completed", utcnow(), stats
            await s.commit()
        await update_status(
            company_id, message=f"{stats['new_leads']} new leads, {stats['updated_leads']} updated", progress=100
        )
        return stats
    except Exception as e:
        async with SessionLocal() as s:
            run = await s.get(SignalRun, run_id)
            run.status, run.finished_at, run.stats, run.error = "failed", utcnow(), stats, str(e)[:2000]
            await s.commit()
        raise


def _better_fit(a: str | None, b: str | None) -> str | None:
    order = ["none", "weak", "medium", "strong"]
    vals = [x for x in (a, b) if x in order]
    return max(vals, key=order.index) if vals else None


async def _enrich(hub, company_id, run_id, lead_ids: list[uuid.UUID], titles: list[str]) -> None:
    sem = asyncio.Semaphore(4)

    async def one(lead_id: uuid.UUID):
        async with SessionLocal() as s:
            lead = await s.get(Lead, lead_id)
            name, domain = lead.org_name, lead.domain
        async with sem:
            try:
                comp = (
                    await hub.call(
                        "enrich", "enrich_company", {"name": name, "domain": domain}, company_id=company_id, run_id=run_id
                    )
                    or {}
                ).get("company")
            except MCPError:
                comp = None
            try:
                contacts = (
                    await hub.call(
                        "enrich",
                        "find_contacts",
                        {"company": name, "domain": (comp or {}).get("domain") or domain, "titles": titles},
                        company_id=company_id,
                        run_id=run_id,
                    )
                    or {}
                ).get("contacts") or []
            except MCPError:
                contacts = []
        async with SessionLocal() as s:
            lead = await s.get(Lead, lead_id)
            if comp:
                lead.domain = lead.domain or comp.get("domain")
                lead.industry = comp.get("industry") or lead.industry
                lead.employees = comp.get("employees") if isinstance(comp.get("employees"), int) else lead.employees
                lead.hq = comp.get("hq") or lead.hq
                lead.linkedin_url = lead.linkedin_url or comp.get("linkedin_url")
                lead.description = comp.get("description") or lead.description
            lead.contacts = contacts
            primary = None
            if lead.contact_name:
                primary = next(
                    (c for c in contacts if (c.get("name") or "").lower() == lead.contact_name.lower()), None
                )
            elif contacts:
                primary = contacts[0]
                lead.contact_name, lead.contact_title = primary.get("name"), primary.get("title")
            if primary:
                lead.email = lead.email or primary.get("email")
                lead.phone = lead.phone or primary.get("phone")
                lead.linkedin_url = primary.get("linkedin_url") or lead.linkedin_url
            await s.commit()

    await asyncio.gather(*(one(lid) for lid in lead_ids))


async def _score(lead_ids: list[uuid.UUID], icp: dict) -> None:
    async with SessionLocal() as s:
        for lead_id in lead_ids:
            lead = await s.get(Lead, lead_id)
            await s.refresh(lead, ["signals"])
            fit, fit_reasons = scoring.fit_score(
                {
                    "industry": lead.industry,
                    "description": lead.description,
                    "employees": lead.employees,
                    "hq": lead.hq,
                    "contact_title": lead.contact_title,
                    "llm_fit": lead.llm_fit,
                },
                icp,
            )
            sigs = [
                {
                    "weight": ls.signal.weight if ls.signal else 0.5,
                    "confidence": ls.confidence,
                    "published_at": ls.raw_hit.published_at,
                    "type": ls.signal.type if ls.signal else None,
                    "name": ls.signal.name if ls.signal else None,
                }
                for ls in lead.signals
            ]
            intent, intent_reasons = scoring.intent_score(sigs)
            lead.fit_score, lead.intent_score = fit, intent
            lead.score = scoring.total_score(fit, intent)
            lead.score_breakdown = {"fit_reasons": fit_reasons, "intent_reasons": intent_reasons}
            dates = [ls.raw_hit.published_at for ls in lead.signals if ls.raw_hit.published_at]
            if dates:
                lead.last_signal_at = max(dates)
        await s.commit()

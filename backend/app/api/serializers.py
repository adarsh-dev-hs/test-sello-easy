"""Model → JSON dicts matching docs/CONTRACTS.md."""

from app.models import Activity, Company, ICPRecord, Lead, LeadSignal, Signal, SignalRun, Source, User


def user_out(u: User) -> dict:
    return {"id": str(u.id), "email": u.email, "name": u.name}


def company_summary(c: Company, lead_count: int = 0, signal_count: int = 0) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "website_url": c.website_url,
        "status": c.status,
        "lead_count": lead_count,
        "signal_count": signal_count,
        "updated_at": c.updated_at,
    }


def company_out(c: Company) -> dict:
    d = c.status_detail or {}
    return {
        "id": str(c.id),
        "workspace_id": str(c.workspace_id),
        "name": c.name,
        "website_url": c.website_url,
        "status": c.status,
        "status_detail": {
            "step": d.get("step"),
            "progress": d.get("progress", 0),
            "message": d.get("message"),
            "error": d.get("error"),
        },
        "profile": c.profile,
        "profile_edited": c.profile_edited,
        "updated_at": c.updated_at,
    }


def source_out(s: Source) -> dict:
    return {
        "id": str(s.id),
        "kind": s.kind,
        "uri": s.uri,
        "filename": s.filename,
        "mime": s.mime,
        "status": s.status,
        "error": s.error,
        "chars": len(s.extracted_text or ""),
        "created_at": s.created_at,
    }


def icp_out(r: ICPRecord) -> dict:
    return {
        "id": str(r.id),
        "version": r.version,
        "is_active": r.is_active,
        "origin": r.origin,
        "data": r.data,
        "created_at": r.created_at,
    }


def signal_out(s: Signal) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "type": s.type,
        "description": s.description,
        "channels": list(s.channels or []),
        "queries": list(s.queries or []),
        "weight": s.weight,
        "lookback_days": s.lookback_days,
        "is_active": s.is_active,
        "created_at": s.created_at,
    }


def run_out(r: SignalRun) -> dict:
    return {
        "id": str(r.id),
        "status": r.status,
        "started_at": r.started_at,
        "finished_at": r.finished_at,
        "stats": r.stats or {},
        "error": r.error,
    }


def lead_signal_out(ls: LeadSignal) -> dict:
    h = ls.raw_hit
    return {
        "id": str(ls.id),
        "signal_id": str(ls.signal_id) if ls.signal_id else None,
        "signal_name": ls.signal.name if ls.signal else None,
        "signal_type": ls.signal.type if ls.signal else None,
        "source": h.source,
        "url": h.url,
        "title": h.title,
        "snippet": h.snippet,
        "published_at": h.published_at,
        "confidence": ls.confidence,
        "explanation": ls.explanation,
    }


def lead_out(lead: Lead) -> dict:
    sigs = sorted(
        lead.signals,
        key=lambda ls: (ls.raw_hit.published_at is not None, ls.raw_hit.published_at, ls.confidence),
        reverse=True,
    )
    return {
        "id": str(lead.id),
        "org_name": lead.org_name,
        "domain": lead.domain,
        "industry": lead.industry,
        "employees": lead.employees,
        "hq": lead.hq,
        "description": lead.description,
        "contact_name": lead.contact_name,
        "contact_title": lead.contact_title,
        "email": lead.email,
        "phone": lead.phone,
        "linkedin_url": lead.linkedin_url,
        "contacts": lead.contacts or [],
        "fit_score": lead.fit_score,
        "intent_score": lead.intent_score,
        "score": lead.score,
        "score_breakdown": lead.score_breakdown or {"fit_reasons": [], "intent_reasons": []},
        "status": lead.status,
        "first_seen_at": lead.first_seen_at,
        "last_signal_at": lead.last_signal_at,
        "signals": [lead_signal_out(ls) for ls in sigs],
    }


def activity_out(a: Activity) -> dict:
    return {
        "id": str(a.id),
        "channel": a.channel,
        "payload": a.payload or {},
        "status": a.status,
        "created_at": a.created_at,
        "user_name": a.user.name if a.user else None,
    }

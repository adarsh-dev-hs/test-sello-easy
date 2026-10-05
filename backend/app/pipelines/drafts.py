import json

from app.ai_schemas import Draft
from app.models import Lead
from app.services import llm

EMAIL_SYSTEM = """You write short, specific B2B cold emails for the SELLER to a prospect. Reference the \
concrete signal evidence naturally (without sounding creepy), connect it to one relevant pain and one \
seller capability, and end with a low-friction call to action. 90-140 words, plain text, no placeholders \
like [Name] — use the contact's first name if known, otherwise a neutral greeting. Sign off with the \
seller company name. Subject: max 7 words, no clickbait."""

WHATSAPP_SYSTEM = """You write a brief, friendly WhatsApp message from a salesperson at the SELLER to a \
prospect. Max 60 words, plain text, one reference to the signal evidence, one question as a call to \
action. subject must be null."""


async def draft_message(lead: Lead, channel: str, profile: dict, icp: dict) -> Draft:
    evidence = [
        {
            "signal": ls.signal.name if ls.signal else None,
            "source": ls.raw_hit.source,
            "title": ls.raw_hit.title,
            "snippet": ls.raw_hit.snippet,
            "why": ls.explanation,
        }
        for ls in sorted(lead.signals, key=lambda x: x.confidence, reverse=True)[:3]
    ]
    context = {
        "seller": {
            "name": profile.get("name"),
            "one_liner": profile.get("one_liner"),
            "value_propositions": profile.get("value_propositions"),
            "products": [p.get("name") for p in profile.get("products") or []],
        },
        "icp_pain_points": icp.get("pain_points"),
        "prospect": {
            "organisation": lead.org_name,
            "industry": lead.industry,
            "contact_name": lead.contact_name,
            "contact_title": lead.contact_title,
        },
        "signal_evidence": evidence,
    }
    system = EMAIL_SYSTEM if channel == "email" else WHATSAPP_SYSTEM
    draft = await llm.structured(system, json.dumps(context, indent=1), Draft)
    if channel != "email":
        draft.subject = None
    return draft

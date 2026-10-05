"""Explainable lead scoring: score = 0.5 * fit + 0.5 * intent (both 0-100)."""

import math
import re
from datetime import datetime, timezone

LLM_FIT_VALUE = {"strong": 0.9, "medium": 0.6, "weak": 0.3, "none": 0.05}
FIT_WEIGHTS = {"industry": 0.35, "size": 0.20, "geo": 0.20, "persona": 0.25}
_STOP = {"and", "or", "of", "the", "for", "&", "-", "in", "a", "an", "to", "with"}
_COMPANY_SUFFIXES = {
    "inc", "llc", "ltd", "limited", "gmbh", "ag", "sa", "bv", "nv", "plc", "corp", "corporation",
    "co", "company", "group", "holdings", "oy", "ab", "as", "srl", "spa", "sarl", "pty", "kg",
}


def dedupe_key(org_name: str | None, domain: str | None) -> str | None:
    if domain:
        d = domain.lower().strip()
        d = re.sub(r"^https?://", "", d).split("/")[0]
        d = d.removeprefix("www.")
        if "." in d:
            return d
    if not org_name:
        return None
    n = re.sub(r"(?<=\b[a-z])\.(?=[a-z]\b)|\.(?=\s|$)", "", org_name.lower())  # "a.s." → "as"
    tokens = re.sub(r"[^a-z0-9&]+", " ", n).split()
    while len(tokens) > 1 and tokens[-1] in _COMPANY_SUFFIXES:
        tokens.pop()
    return " ".join(tokens) or None


def _tokens(text: str | None) -> set[str]:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return {w.rstrip("s") for w in words if w not in _STOP and len(w) > 1}


REGIONS = {
    "north america": "united states usa us canada mexico ontario quebec texas ohio california illinois new york",
    "europe": "eu uk united kingdom england germany france netherlands belgium poland czech republic spain italy "
    "sweden finland norway denmark austria switzerland ireland portugal",
    "emea": "europe middle east africa uk germany france netherlands uae saudi",
    "nordic": "sweden finland norway denmark iceland",
    "dach": "germany austria switzerland",
    "benelux": "belgium netherlands luxembourg",
    "apac": "asia pacific australia japan singapore india china korea",
    "latam": "latin america brazil mexico argentina chile colombia",
    "uk": "united kingdom england scotland wales london",
    "us": "united states usa",
}


def _expand_geo(options: list[str]) -> list[str]:
    out = list(options)
    for opt in options:
        low = opt.lower()
        for region, members in REGIONS.items():
            if re.search(rf"\b{region}s?\b", low):
                out.append(members)
    return out


def _overlap(a: str | None, options: list[str]) -> float | None:
    """1.0 if any option shares a meaningful token with `a`; None if `a` unknown."""
    if not a:
        return None
    ta = _tokens(a)
    if not options:
        return None
    for opt in options:
        if ta & _tokens(opt):
            return 1.0
    return 0.0


def parse_range(text: str | None) -> tuple[int | None, int | None]:
    """Parse '200-2,000 employees' / '1000+' / '50 to 500' → (lo, hi)."""
    if not text:
        return None, None
    t = text.lower().replace(",", "")
    nums = [int(float(n) * (1000 if k == "k" else 1)) for n, k in re.findall(r"(\d+(?:\.\d+)?)\s*(k?)", t)]
    if not nums:
        return None, None
    if len(nums) == 1:
        if "+" in t or "more" in t or "over" in t or "above" in t:
            return nums[0], None
        if "under" in t or "less" in t or "below" in t or "<" in t:
            return None, nums[0]
        return nums[0], None
    return min(nums[0], nums[1]), max(nums[0], nums[1])


def _size_match(employees: int | None, employee_range: str | None) -> float | None:
    if employees is None:
        return None
    lo, hi = parse_range(employee_range)
    if lo is None and hi is None:
        return None
    if (lo is None or employees >= lo) and (hi is None or employees <= hi):
        return 1.0
    # partial credit when within 2x of the range
    if lo is not None and employees >= lo / 2 and (hi is None or employees <= hi * 2):
        return 0.5
    if hi is not None and employees <= hi * 2 and (lo is None or employees >= lo / 2):
        return 0.5
    return 0.0


def fit_score(lead: dict, icp: dict) -> tuple[float, list[str]]:
    firmo = icp.get("firmographics") or {}
    persona_titles = [p.get("title", "") for p in icp.get("personas") or []]
    llm_value = LLM_FIT_VALUE.get(lead.get("llm_fit") or "medium", 0.6)
    components = {
        "industry": _overlap(
            " ".join(filter(None, [lead.get("industry"), lead.get("description")])) or None,
            firmo.get("industries") or [],
        ),
        "size": _size_match(lead.get("employees"), firmo.get("employee_range")),
        "geo": _overlap(lead.get("hq"), _expand_geo(firmo.get("geographies") or [])),
        "persona": _overlap(lead.get("contact_title"), persona_titles),
    }
    reasons, total = [], 0.0
    labels = {
        "industry": f"Industry '{lead.get('industry')}'",
        "size": f"{lead.get('employees')} employees",
        "geo": f"HQ {lead.get('hq')}",
        "persona": f"Contact '{lead.get('contact_title')}'",
    }
    for key, weight in FIT_WEIGHTS.items():
        val = components[key]
        if val is None:
            total += weight * llm_value
            continue
        total += weight * val
        verdict = "matches ICP" if val >= 1 else ("partially matches ICP" if val > 0 else "outside ICP")
        reasons.append(f"{labels[key]} {verdict}")
    if lead.get("llm_fit"):
        reasons.append(f"AI fit assessment: {lead['llm_fit']}")
    return round(total * 100, 1), reasons


def intent_score(signals: list[dict], now: datetime | None = None) -> tuple[float, list[str]]:
    """signals: [{weight, confidence, published_at(datetime|None), type, name}]"""
    now = now or datetime.now(timezone.utc)
    if not signals:
        return 0.0, []
    best, reasons = 0.0, []
    for s in signals:
        pub = s.get("published_at")
        days = max(0.0, (now - pub).total_seconds() / 86400) if pub else 14.0
        val = float(s.get("weight") or 0.5) * float(s.get("confidence") or 0.5) * math.exp(-days / 21)
        best = max(best, val)
    types = {s.get("type") for s in signals if s.get("type")}
    score = min(100.0, best * 100 + 10 * max(0, len(types) - 1))
    names = sorted({s.get("name") or s.get("type") or "signal" for s in signals})
    reasons.append(f"{len(signals)} signal hit(s): {', '.join(names)}")
    if len(types) > 1:
        reasons.append(f"+{10 * (len(types) - 1)} for {len(types)} distinct signal types")
    return round(score, 1), reasons


def total_score(fit: float, intent: float) -> float:
    return round(0.5 * fit + 0.5 * intent)

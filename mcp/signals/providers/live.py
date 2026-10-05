"""Live provider: best-effort calls to Tavily / Exa / X API v2 / Reddit / Hunter.

Every function returns the contract shape. Missing keys or provider errors yield empty results plus a
"warning" key; exceptions never escape.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx

log = logging.getLogger("selloeasy.signals.live")

TIMEOUT = httpx.Timeout(float(os.getenv("SIGNALS_HTTP_TIMEOUT_SECONDS", "20")))
UA = "SelloEasy-Signals/0.1"

SOCIAL_PREFIX = {
    "x": "site:x.com",
    "linkedin": "site:linkedin.com/posts",
    "reddit": "site:reddit.com",
    "facebook": "site:facebook.com",
}
JOBS_PREFIX = "site:greenhouse.io OR site:lever.co OR site:linkedin.com/jobs"


def _env(name: str) -> str:
    return os.getenv(name, "").strip()


def _iso(value) -> str | None:
    if not value:
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc).isoformat()
    s = str(value).strip()
    for fmt in (None, "%a, %d %b %Y %H:%M:%S %Z", "%a, %d %b %Y %H:%M:%S %z"):
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00")) if fmt is None else datetime.strptime(s, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc).isoformat()
        except Exception:
            continue
    return None


def _hit(source, url, title, snippet, author=None, published_at=None, company=None) -> dict:
    return {
        "source": source,
        "url": url or "",
        "title": (title or "").strip()[:300],
        "snippet": (snippet or "").strip()[:1200],
        "author": author,
        "published_at": _iso(published_at),
        "company": company,
    }


def _time_range(since_days: int) -> str:
    if since_days <= 1:
        return "day"
    if since_days <= 7:
        return "week"
    if since_days <= 31:
        return "month"
    return "year"


# --------------------------------------------------------------------------- generic search backends
async def _tavily(query: str, since_days: int, limit: int, topic: str = "general") -> list[dict]:
    key = _env("TAVILY_API_KEY")
    body = {
        "query": query[:400],
        "max_results": max(1, min(int(limit), 20)),
        "topic": topic,
        "search_depth": "basic",
        "api_key": key,
    }
    if topic == "news":
        body["days"] = int(since_days)
    else:
        body["time_range"] = _time_range(int(since_days))
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await c.post(
            "https://api.tavily.com/search", json=body, headers={"Authorization": f"Bearer {key}", "User-Agent": UA}
        )
        r.raise_for_status()
        data = r.json()
    return [
        {"url": x.get("url"), "title": x.get("title"), "snippet": x.get("content"), "published_at": x.get("published_date")}
        for x in data.get("results", [])
    ]


async def _exa(query: str, since_days: int, limit: int, category: str | None = None) -> list[dict]:
    key = _env("EXA_API_KEY")
    start = (datetime.now(timezone.utc) - timedelta(days=int(since_days))).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    body = {
        "query": query[:400],
        "numResults": max(1, min(int(limit), 25)),
        "startPublishedDate": start,
        "type": "auto",
        "contents": {"text": {"maxCharacters": 800}},
    }
    if category:
        body["category"] = category
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await c.post("https://api.exa.ai/search", json=body, headers={"x-api-key": key, "User-Agent": UA})
        r.raise_for_status()
        data = r.json()
    return [
        {
            "url": x.get("url"),
            "title": x.get("title"),
            "snippet": x.get("text") or x.get("summary") or "",
            "author": x.get("author"),
            "published_at": x.get("publishedDate"),
        }
        for x in data.get("results", [])
    ]


async def _search(query: str, since_days: int, limit: int, source: str, news: bool = False) -> dict:
    """Route to Tavily, else Exa. Return {"hits": [...]} (+ warning)."""
    try:
        if _env("TAVILY_API_KEY"):
            rows = await _tavily(query, since_days, limit, "news" if news else "general")
        elif _env("EXA_API_KEY"):
            rows = await _exa(query, since_days, limit, "news" if news else None)
        else:
            return {"hits": [], "warning": "no search provider key set (TAVILY_API_KEY or EXA_API_KEY)"}
    except Exception as e:
        log.warning("search failed: %s", e)
        return {"hits": [], "warning": f"search provider error: {e}"}
    hits = [
        _hit(source, r.get("url"), r.get("title"), r.get("snippet"), r.get("author"), r.get("published_at"))
        for r in rows
        if r.get("url")
    ]
    return {"hits": hits[: int(limit)]}


# --------------------------------------------------------------------------- native social APIs
async def _x_search(query: str, since_days: int, limit: int) -> dict:
    token = _env("X_BEARER_TOKEN")
    q = query.replace("site:x.com", "").replace("site:twitter.com", "").strip()
    q = f"({q}) -is:retweet lang:en" if q else "-is:retweet"
    start = datetime.now(timezone.utc) - timedelta(days=min(int(since_days), 7)) + timedelta(minutes=1)
    params = {
        "query": q[:512],
        "max_results": max(10, min(int(limit), 100)),
        "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "tweet.fields": "created_at,author_id",
        "expansions": "author_id",
        "user.fields": "username,name",
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await c.get(
            "https://api.twitter.com/2/tweets/search/recent",
            params=params,
            headers={"Authorization": f"Bearer {token}", "User-Agent": UA},
        )
        r.raise_for_status()
        data = r.json()
    users = {u["id"]: u for u in data.get("includes", {}).get("users", [])}
    hits = []
    for t in data.get("data", [])[: int(limit)]:
        u = users.get(t.get("author_id"), {})
        handle = u.get("username") or "i"
        text = t.get("text", "")
        hits.append(
            _hit("x", f"https://x.com/{handle}/status/{t['id']}", text[:120], text, u.get("name") or handle, t.get("created_at"))
        )
    return {"hits": hits}


async def _reddit_search(query: str, since_days: int, limit: int) -> dict:
    cid, secret = _env("REDDIT_CLIENT_ID"), _env("REDDIT_CLIENT_SECRET")
    ua = _env("REDDIT_USER_AGENT") or "selloeasy:signals:0.1 (by /u/selloeasy)"
    q = query.replace("site:reddit.com", "").strip()
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        tr = await c.post(
            "https://www.reddit.com/api/v1/access_token",
            data={"grant_type": "client_credentials"},
            auth=(cid, secret),
            headers={"User-Agent": ua},
        )
        tr.raise_for_status()
        token = tr.json().get("access_token")
        r = await c.get(
            "https://oauth.reddit.com/search",
            params={"q": q, "sort": "new", "t": _time_range(int(since_days)), "limit": max(1, min(int(limit), 100)), "type": "link"},
            headers={"Authorization": f"Bearer {token}", "User-Agent": ua},
        )
        r.raise_for_status()
        data = r.json()
    cutoff = datetime.now(timezone.utc) - timedelta(days=int(since_days))
    hits = []
    for ch in data.get("data", {}).get("children", []):
        d = ch.get("data", {})
        created = d.get("created_utc")
        if created and datetime.fromtimestamp(created, tz=timezone.utc) < cutoff:
            continue
        hits.append(
            _hit(
                "reddit",
                "https://www.reddit.com" + d.get("permalink", ""),
                d.get("title"),
                (d.get("selftext") or "")[:1200] or d.get("title"),
                d.get("author"),
                created,
            )
        )
    return {"hits": hits[: int(limit)]}


# --------------------------------------------------------------------------- provider API
async def search_web(query: str, since_days: int = 30, limit: int = 10) -> dict:
    return await _search(query, since_days, limit, "web")


async def search_news(query: str, since_days: int = 30, limit: int = 10) -> dict:
    return await _search(query, since_days, limit, "news", news=True)


async def search_social(platform: str, query: str, since_days: int = 30, limit: int = 10) -> dict:
    p = (platform or "").lower().strip()
    p = {"twitter": "x"}.get(p, p)
    if p not in SOCIAL_PREFIX:
        return {"hits": [], "warning": f"unsupported platform '{platform}'"}
    try:
        if p == "x" and _env("X_BEARER_TOKEN"):
            return await _x_search(query, since_days, limit)
        if p == "reddit" and _env("REDDIT_CLIENT_ID") and _env("REDDIT_CLIENT_SECRET"):
            return await _reddit_search(query, since_days, limit)
    except Exception as e:
        log.warning("native %s search failed, falling back to web search: %s", p, e)
    q = query if "site:" in query else f"{SOCIAL_PREFIX[p]} {query}"
    return await _search(q, since_days, limit, p)


async def search_jobs(query: str, location: str | None = None, since_days: int = 30, limit: int = 10) -> dict:
    q = query if "site:" in query else f"({JOBS_PREFIX}) {query}"
    if location:
        q += f" {location}"
    res = await _search(q, since_days, limit, "jobs")
    for h in res.get("hits", []):
        h["company"] = h.get("company") or _company_from_job_url(h["url"])
    return res


def _company_from_job_url(url: str) -> str | None:
    """greenhouse.io/<company>/jobs/..., jobs.lever.co/<company>/..."""
    try:
        p = urlparse(url)
        host, parts = p.netloc.lower(), [x for x in p.path.split("/") if x]
        if ("greenhouse.io" in host or "lever.co" in host) and parts:
            return parts[0].replace("-", " ").title()
    except Exception:
        pass
    return None


async def enrich_company(name: str | None = None, domain: str | None = None) -> dict:
    key = _env("HUNTER_API_KEY")
    if not key:
        return {"company": None, "warning": "HUNTER_API_KEY not set"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            if not domain and name:
                r = await c.get("https://api.hunter.io/v2/domain-search", params={"company": name, "limit": 1, "api_key": key})
                if r.status_code == 200:
                    domain = (r.json().get("data") or {}).get("domain")
            if not domain:
                return {"company": None, "warning": "could not resolve domain"}
            r = await c.get("https://api.hunter.io/v2/companies/find", params={"domain": domain, "api_key": key})
            r.raise_for_status()
            d = r.json().get("data") or {}
    except Exception as e:
        return {"company": None, "warning": f"hunter error: {e}"}
    geo = d.get("geo") or {}
    metrics = d.get("metrics") or {}
    emp = metrics.get("employees")
    if isinstance(emp, str):
        digits = [int(x) for x in emp.replace(",", "").replace("+", "").split("-") if x.strip().isdigit()]
        emp = digits[-1] if digits else None
    li = (d.get("linkedin") or {}).get("handle")
    return {
        "company": {
            "name": d.get("name") or name,
            "domain": d.get("domain") or domain,
            "industry": (d.get("category") or {}).get("industry"),
            "employees": emp,
            "hq": ", ".join(x for x in (geo.get("city"), geo.get("country")) if x) or None,
            "linkedin_url": f"https://www.linkedin.com/{li}" if li else None,
            "description": d.get("description"),
        }
    }


async def find_contacts(company: str | None = None, domain: str | None = None, titles: list[str] | None = None) -> dict:
    key = _env("HUNTER_API_KEY")
    if not key:
        return {"contacts": [], "warning": "HUNTER_API_KEY not set"}
    params = {"api_key": key, "limit": 25, "type": "personal"}
    if domain:
        params["domain"] = domain
    elif company:
        params["company"] = company
    else:
        return {"contacts": [], "warning": "company or domain required"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get("https://api.hunter.io/v2/domain-search", params=params)
            r.raise_for_status()
            emails = (r.json().get("data") or {}).get("emails") or []
    except Exception as e:
        return {"contacts": [], "warning": f"hunter error: {e}"}
    contacts = [
        {
            "name": " ".join(x for x in (e.get("first_name"), e.get("last_name")) if x) or None,
            "title": e.get("position"),
            "email": e.get("value"),
            "phone": e.get("phone_number"),
            "linkedin_url": e.get("linkedin"),
        }
        for e in emails
    ]
    if titles:
        wanted = {w for t in titles for w in t.lower().split() if len(w) > 1}
        contacts.sort(key=lambda p: -len(wanted & set((p.get("title") or "").lower().split())))
    return {"contacts": contacts}

"""Fixture provider: deterministic, offline search over fixtures/*.json using a lenient BM25 scorer."""
from __future__ import annotations

import difflib
import glob
import json
import math
import os
import re
from collections import Counter
from datetime import datetime, timedelta, timezone
from functools import lru_cache

FIXTURES_DIR = os.getenv(
    "FIXTURES_DIR", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures")
)

STOPWORDS = set(
    """a an and are as at be been but by can could did do does for from had has have how i if in into is it its
    me my of on or our out so than that the their them then there these they this those to too us was we were
    what when where which who whom why will with would you your not no yes any all some more most very just
    about over under after before during new recent recently latest company companies looking need needs want
    wants site via per vs etc also near using use used like""".split()
)
# Common LLM query vocabulary that is too generic to be a useful match signal.
WEAK_WORDS = ("announce", "announcement", "post", "news", "job", "role", "position", "hire", "hiring", "team")

SYNONYMS = {
    "wi-fi": "wifi", "wireless lan": "wifi", "wlan": "wifi",
    "e-mail": "email", "accounts payable": "ap accounts payable",
    "5 g": "5g", "industry 4.0": "industry40 industry 4.0", "i4.0": "industry40",
    "chief information officer": "cio chief information officer",
    "chief digital officer": "cdo chief digital officer",
    "chief financial officer": "cfo chief financial officer",
    "operational technology": "ot operational technology",
    "month-end": "month end", "3-way": "three way", "three-way": "three way",
}

WEAK = set()  # filled below (needs _stem)

CHANNEL_ALIASES = {"twitter": "x", "x.com": "x", "fb": "facebook", "li": "linkedin"}


def _stem(tok: str) -> str:
    s = _stem_suffix(tok)
    if len(s) >= 4 and s.endswith("e") and not s.endswith("ee"):
        s = s[:-1]  # hire/hiring/hired -> hir
    return s


def _stem_suffix(tok: str) -> str:
    if tok.isdigit() or len(tok) <= 3:
        return tok
    for suf, minlen in (("ings", 6), ("ing", 6), ("ies", 5), ("ers", 6), ("ed", 5), ("es", 5), ("s", 4)):
        if tok.endswith(suf) and len(tok) >= minlen:
            if suf == "ies":
                return tok[:-3] + "y"
            if suf == "s" and tok.endswith("ss"):
                return tok
            if suf == "es" and not tok.endswith(("ses", "xes", "ches", "shes", "zes")):
                return tok[:-1]
            if suf == "ers":
                return tok[:-1]
            return tok[: -len(suf)]
    return tok


WEAK.update(_stem(w) for w in WEAK_WORDS)


def _prep(text: str) -> str:
    t = (text or "").lower()
    for k, v in SYNONYMS.items():
        t = t.replace(k, v)
    return t


def tokenize(text: str, is_query: bool = False) -> list[str]:
    t = _prep(text)
    if is_query:
        t = re.sub(r"\bsite:\S+", " ", t)  # ignore search operators
        t = re.sub(r"\b(or|and|not)\b", " ", t)
        t = re.sub(r"(^|\s)-\S+", " ", t)  # exclusions: -foo
    toks = re.findall(r"[a-z0-9]+", t)
    out = []
    for tok in toks:
        if tok in STOPWORDS:
            continue
        if len(tok) == 1 and not tok.isdigit():
            continue
        out.append(_stem(tok))
    return out


def _norm_company(name: str) -> str:
    n = (name or "").lower()
    n = re.sub(r"&", " and ", n)
    n = re.sub(r"[^a-z0-9 ]+", " ", n)
    n = re.sub(r"\b(inc|llc|ltd|limited|gmbh|bv|nv|sa|ag|plc|corp|corporation|co|company|the|group)\b", " ", n)
    return " ".join(n.split())


def _norm_domain(d: str) -> str:
    d = (d or "").lower().strip()
    d = re.sub(r"^[a-z]+://", "", d)
    d = d.split("/")[0]
    return d[4:] if d.startswith("www.") else d


class Corpus:
    def __init__(self, fixtures_dir: str = FIXTURES_DIR):
        self.items: list[dict] = []
        self.companies: list[dict] = []
        for path in sorted(glob.glob(os.path.join(fixtures_dir, "*.json"))):
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            self.items.extend(data.get("items", []))
            self.companies.extend(data.get("companies", []))
        self.docs: list[Counter] = []
        for it in self.items:
            toks = tokenize(it.get("title", "")) + tokenize(it.get("snippet", ""))
            toks += tokenize(it.get("company") or "")
            for tag in it.get("tags", []):
                toks += tokenize(tag) * 2  # tags weigh double
            self.docs.append(Counter(toks))
        self.doc_len = [sum(c.values()) for c in self.docs]
        self.avgdl = (sum(self.doc_len) / len(self.doc_len)) if self.doc_len else 1.0
        df: Counter = Counter()
        for c in self.docs:
            df.update(set(c))
        n = len(self.docs) or 1
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}

    # ------------------------------------------------------------------ search
    def search(self, query: str, sources: set[str], since_days: int, limit: int, boost: str = "") -> list[dict]:
        q = tokenize(query, is_query=True)
        qset = list(dict.fromkeys(q))
        boost_toks = set(tokenize(boost, is_query=True)) if boost else set()
        k1, b = 1.2, 0.75
        scored = []
        for i, it in enumerate(self.items):
            if it.get("source") not in sources:
                continue
            if since_days is not None and int(it.get("published_days_ago", 0)) > int(since_days):
                continue
            tf = self.docs[i]
            dl = self.doc_len[i] or 1
            score, matched = 0.0, 0
            for t in qset:
                f = tf.get(t, 0)
                if not f:
                    continue
                w = 0.3 if t in WEAK else 1.0
                matched += 1 if t not in WEAK else 0
                score += w * self.idf.get(t, 0.0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * dl / self.avgdl))
            if score <= 0:
                continue
            if matched >= 2:  # reward docs that match several distinct meaningful terms
                score *= 1 + 0.15 * (matched - 1)
            if boost_toks and boost_toks & set(tf):
                score *= 1.2
            scored.append((score, i))
        scored.sort(key=lambda x: (-x[0], x[1]))
        now = datetime.now(timezone.utc).replace(microsecond=0)
        hits = []
        for score, i in scored[: max(0, int(limit))]:
            it = self.items[i]
            hits.append(
                {
                    "source": it["source"],
                    "url": it["url"],
                    "title": it["title"],
                    "snippet": it["snippet"],
                    "author": it.get("author"),
                    "published_at": (now - timedelta(days=int(it.get("published_days_ago", 0)))).isoformat(),
                    "company": it.get("company"),
                }
            )
        return hits

    # ------------------------------------------------------------------ companies
    def match_company(self, name: str | None = None, domain: str | None = None) -> dict | None:
        if domain:
            d = _norm_domain(domain)
            for c in self.companies:
                cd = _norm_domain(c.get("domain", ""))
                if d and (d == cd or d.endswith("." + cd) or cd.endswith("." + d)):
                    return c
        if name:
            n = _norm_company(name)
            if not n:
                return None
            best, best_score = None, 0.0
            ntoks = set(n.split())
            for c in self.companies:
                cn = _norm_company(c.get("name", ""))
                ratio = difflib.SequenceMatcher(None, n, cn).ratio()
                ctoks = set(cn.split())
                overlap = len(ntoks & ctoks) / max(1, min(len(ntoks), len(ctoks)))
                s = max(ratio, overlap * 0.95)
                if n in cn or cn in n:
                    s = max(s, 0.9)
                # name might also be a domain
                if _norm_domain(name) == _norm_domain(c.get("domain", "")):
                    s = 1.0
                if s > best_score:
                    best, best_score = c, s
            if best_score >= 0.6:
                return best
        return None


@lru_cache(maxsize=1)
def corpus() -> Corpus:
    return Corpus()


# ---------------------------------------------------------------------- provider API
async def search_web(query: str, since_days: int = 30, limit: int = 10) -> dict:
    return {"hits": corpus().search(query, {"web"}, since_days, limit)}


async def search_news(query: str, since_days: int = 30, limit: int = 10) -> dict:
    return {"hits": corpus().search(query, {"news"}, since_days, limit)}


async def search_social(platform: str, query: str, since_days: int = 30, limit: int = 10) -> dict:
    p = (platform or "").lower().strip()
    p = CHANNEL_ALIASES.get(p, p)
    if p not in ("x", "linkedin", "reddit", "facebook"):
        return {"hits": [], "warning": f"unsupported platform '{platform}'"}
    return {"hits": corpus().search(query, {p}, since_days, limit)}


async def search_jobs(query: str, location: str | None = None, since_days: int = 30, limit: int = 10) -> dict:
    return {"hits": corpus().search(query, {"jobs"}, since_days, limit, boost=location or "")}


COMPANY_KEYS = ("name", "domain", "industry", "employees", "hq", "linkedin_url", "description")


async def enrich_company(name: str | None = None, domain: str | None = None) -> dict:
    c = corpus().match_company(name, domain)
    if not c:
        return {"company": None}
    out = {k: c.get(k) for k in COMPANY_KEYS}
    out["employees"] = int(out["employees"]) if out.get("employees") is not None else None
    return {"company": out}


TITLE_EXPAND = {
    "cfo": "chief financial officer", "cio": "chief information officer", "cdo": "chief digital officer",
    "coo": "chief operating officer", "cto": "chief technology officer", "ceo": "chief executive officer",
    "vp": "vice president", "svp": "senior vice president", "ot": "operational technology",
    "ap": "accounts payable", "head": "director",
}


def _title_tokens(title: str) -> set[str]:
    raw = re.findall(r"[a-z0-9]+", (title or "").lower())
    toks = set()
    for t in raw:
        toks.add(t)
        if t in TITLE_EXPAND:
            toks.update(TITLE_EXPAND[t].split())
    rev = {v: k for k, v in TITLE_EXPAND.items()}
    low = " ".join(raw)
    for phrase, abbr in rev.items():
        if phrase in low:
            toks.add(abbr)
    return {_stem(t) for t in toks if t not in STOPWORDS and t not in {"of", "and"}}


async def find_contacts(company: str | None = None, domain: str | None = None, titles: list[str] | None = None) -> dict:
    c = corpus().match_company(company, domain)
    if not c:
        return {"contacts": []}
    contacts = [
        {k: p.get(k) for k in ("name", "title", "email", "phone", "linkedin_url")} for p in c.get("contacts", [])
    ]
    wanted = [_title_tokens(t) for t in (titles or []) if t]
    generic = {"vice", "president", "director", "head", "chief", "officer", "senior", "manager", "global"}

    def rank(p):
        pt = _title_tokens(p["title"])
        best = 0.0
        for w in wanted:
            core = w - generic
            ov = len(pt & w) + 2 * len(pt & core)
            best = max(best, ov)
        return -best

    if wanted:
        contacts.sort(key=rank)  # stable sort keeps fixture order among ties
    return {"contacts": contacts}

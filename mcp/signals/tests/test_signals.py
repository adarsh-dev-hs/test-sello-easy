import os
from datetime import datetime, timedelta, timezone

import pytest
from fastmcp import Client

os.environ.setdefault("PROVIDER_MODE", "fixture")

from server import mcp  # noqa: E402

HIT_KEYS = {"source", "url", "title", "snippet", "author", "published_at", "company"}


async def call(tool, **args):
    async with Client(mcp) as c:
        res = await c.call_tool(tool, args)
    return res.data


def companies(hits):
    return {h["company"] for h in hits}


@pytest.fixture(autouse=True)
def fixture_mode(monkeypatch):
    monkeypatch.setenv("PROVIDER_MODE", "fixture")


async def test_tools_listed():
    async with Client(mcp) as c:
        names = {t.name for t in await c.list_tools()}
    assert names == {"search_web", "search_news", "search_social", "search_jobs", "enrich_company", "find_contacts"}


async def test_hit_shape_and_freshness():
    d = await call("search_jobs", query="OT network engineer private 5G")
    assert d["hits"]
    for h in d["hits"]:
        assert set(h) == HIT_KEYS
        assert h["source"] == "jobs"
        age = datetime.now(timezone.utc) - datetime.fromisoformat(h["published_at"])
        assert age < timedelta(days=31)


# ---------------------------------------------------------------- NordWave signals
async def test_nordwave_jobs():
    d = await call("search_jobs", query='"OT network engineer" OR "Industry 4.0" hiring site:linkedin.com/jobs', limit=10)
    got = companies(d["hits"])
    assert {"Harborline Ports", "Northpeak Mining", "Vectra Auto Components", "Tri-County Water Utility", "Lakeside Paper Mill"} <= got


async def test_nordwave_news_expansion():
    d = await call("search_news", query="new terminal or plant expansion announced manufacturing port", limit=10)
    got = companies(d["hits"])
    assert {"Harborline Ports", "Kestrel Chemicals"} <= got


async def test_nordwave_spectrum():
    d = await call("search_news", query="private spectrum license granted for industrial campus network", limit=5)
    got = companies(d["hits"])
    assert {"Ostrava Steelworks", "Tri-County Water Utility"} <= got


async def test_nordwave_reddit_wifi_pain():
    d = await call("search_social", platform="reddit", query="unreliable wifi on factory floor AGV robots dropping connection", limit=10)
    got = companies(d["hits"])
    assert {"Ostrava Steelworks", "Vectra Auto Components", "Meridian Logistics Hub"} <= got
    assert all(h["source"] == "reddit" for h in d["hits"])


async def test_nordwave_x_and_linkedin():
    d = await call("search_social", platform="x", query="wifi dead zones robots warehouse private 5G")
    assert "Meridian Logistics Hub" in companies(d["hits"])
    d = await call("search_social", platform="linkedin", query="appoints new CIO OR CDO digital transformation")
    assert {"Harborline Ports", "Vectra Auto Components", "Tri-County Water Utility"} <= companies(d["hits"])


async def test_search_web_only_web():
    d = await call("search_web", query="digital plant roadmap private wireless pilot")
    assert d["hits"] and all(h["source"] == "web" for h in d["hits"])
    assert d["hits"][0]["company"] == "Kestrel Chemicals"


# ---------------------------------------------------------------- LedgerLeaf signals
async def test_ledgerleaf_jobs():
    d = await call("search_jobs", query="accounts payable specialist AP clerk hiring", limit=10)
    got = companies(d["hits"])
    assert {"Brightwater Distributors", "Cobalt Health Partners", "Summit Dental Group", "Granite Building Supply"} <= got


async def test_ledgerleaf_erp_migration():
    d = await call("search_news", query="ERP migration to NetSuite or Microsoft Dynamics", limit=10)
    got = companies(d["hits"])
    assert {"Arcadia Freight", "Granite Building Supply", "Copperline Manufacturing"} <= got


async def test_ledgerleaf_reddit_pain():
    d = await call("search_social", platform="reddit", query="r/Accounting manual invoice processing month-end close pain", limit=10)
    got = companies(d["hits"])
    assert {"Brightwater Distributors", "Arcadia Freight", "Granite Building Supply", "Copperline Manufacturing"} <= got


async def test_ledgerleaf_funding_and_acquisitions():
    d = await call("search_news", query="Series B funding round raised", limit=10)
    assert {"Cobalt Health Partners", "Harbor & Hale Retail"} <= companies(d["hits"])
    d = await call("search_news", query="acquires multi-entity expansion acquisition", limit=10)
    assert {"Brightwater Distributors", "Summit Dental Group"} <= companies(d["hits"])


async def test_ledgerleaf_new_cfo():
    d = await call("search_social", platform="linkedin", query="new CFO or controller appointed")
    assert {"Cobalt Health Partners", "Arcadia Freight", "Harbor & Hale Retail"} <= companies(d["hits"])


# ---------------------------------------------------------------- filters
async def test_since_days_and_limit():
    d = await call("search_social", platform="x", query="wifi robots", since_days=2)
    assert all(h["published_at"] for h in d["hits"])
    assert "Northpeak Mining" not in companies(d["hits"])  # 3 days old
    d = await call("search_news", query="expansion", limit=2)
    assert len(d["hits"]) <= 2


async def test_no_match_and_bad_platform():
    d = await call("search_news", query="zzzz qqqq")
    assert d == {"hits": []}
    d = await call("search_social", platform="myspace", query="wifi")
    assert d["hits"] == [] and "warning" in d


# ---------------------------------------------------------------- enrich & contacts
async def test_enrich_company():
    d = await call("enrich_company", name="Harborline Ports B.V.")
    assert d["company"]["domain"] == "harborline-ports.example"
    assert set(d["company"]) == {"name", "domain", "industry", "employees", "hq", "linkedin_url", "description"}
    assert isinstance(d["company"]["employees"], int)
    d = await call("enrich_company", domain="https://www.copperline-mfg.example/about")
    assert d["company"]["name"] == "Copperline Manufacturing"
    d = await call("enrich_company", name="harbor and hale")
    assert d["company"]["name"] == "Harbor & Hale Retail"
    d = await call("enrich_company", name="Totally Unknown Widgets")
    assert d["company"] is None


async def test_find_contacts():
    d = await call("find_contacts", company="Harborline Ports", titles=["Head of OT"])
    assert d["contacts"][0]["name"] == "Sanne Visser"
    assert set(d["contacts"][0]) == {"name", "title", "email", "phone", "linkedin_url"}
    d = await call("find_contacts", domain="arcadia-freight.example", titles=["Chief Financial Officer"])
    assert d["contacts"][0]["title"] == "CFO"
    d = await call("find_contacts", company="Copperline", titles=["AP Manager"])
    assert d["contacts"][0]["title"] == "Accounts Payable Manager"
    d = await call("find_contacts", company="Nobody Inc")
    assert d == {"contacts": []}


# ---------------------------------------------------------------- live mode without keys
async def test_live_mode_without_keys(monkeypatch):
    monkeypatch.setenv("PROVIDER_MODE", "live")
    for k in ("TAVILY_API_KEY", "EXA_API_KEY", "X_BEARER_TOKEN", "REDDIT_CLIENT_ID", "HUNTER_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    d = await call("search_news", query="private 5G")
    assert d["hits"] == [] and "warning" in d
    d = await call("search_social", platform="x", query="private 5G")
    assert d["hits"] == [] and "warning" in d
    d = await call("enrich_company", name="Nokia")
    assert d["company"] is None
    d = await call("find_contacts", domain="nokia.com", titles=["CIO"])
    assert d["contacts"] == []

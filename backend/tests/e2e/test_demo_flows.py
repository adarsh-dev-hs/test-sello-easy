"""End-to-end acceptance checks for the two seeded demo flows (plan.md §9).

Run against the live stack:  make test-e2e   (inside the backend container)
"""

import os
import time

import httpx
import pytest

API = os.environ.get("E2E_API", "http://localhost:8000/api/v1")
MAILPIT = os.environ.get("E2E_MAILPIT", "http://mailpit:8025")
EMAIL = os.environ.get("DEMO_USER_EMAIL", "demo@selloq.local")
PASSWORD = os.environ.get("DEMO_USER_PASSWORD", "demo1234")
TIMEOUT_S = int(os.environ.get("E2E_TIMEOUT", "600"))
DEMOS = ["NordWave Networks", "LedgerLeaf"]


@pytest.fixture(scope="module")
def client():
    try:
        httpx.get(API.rsplit("/api", 1)[0] + "/health", timeout=5).raise_for_status()
    except Exception:
        pytest.skip("stack is not running")
    c = httpx.Client(base_url=API, timeout=120)
    tok = c.post("/auth/login", json={"email": EMAIL, "password": PASSWORD}).json()["access_token"]
    c.headers["Authorization"] = f"Bearer {tok}"
    return c


@pytest.fixture(scope="module")
def companies(client):
    deadline = time.time() + TIMEOUT_S
    while True:
        ws = {w["name"]: w for w in client.get("/workspaces").json()}
        comps = {name: (ws.get(name) or {}).get("company") for name in DEMOS}
        states = {n: c and c["status"] for n, c in comps.items()}
        if all(s in ("leads_ready", "failed") for s in states.values()):
            break
        if time.time() > deadline:
            pytest.fail(f"timed out waiting for demo pipelines: {states}")
        time.sleep(5)
    for name, c in comps.items():
        if c["status"] == "failed":
            st = client.get(f"/companies/{c['id']}/status").json()
            pytest.fail(f"{name} pipeline failed: {st.get('error')}")
    return comps


@pytest.mark.parametrize("name", DEMOS)
def test_profile(client, companies, name):
    cid = companies[name]["id"]
    p = client.get(f"/companies/{cid}/profile").json()
    assert len(p["products"]) >= 3
    assert len(p["value_propositions"]) >= 3
    srcs = {s["id"]: s for s in client.get(f"/companies/{cid}/sources").json()}
    kinds = {srcs[c["source_id"]]["kind"] for c in p["source_citations"] if c["source_id"] in srcs}
    assert len(kinds) >= 2, f"citations only from {kinds}"


@pytest.mark.parametrize("name", DEMOS)
def test_icp_and_signals(client, companies, name):
    cid = companies[name]["id"]
    icp = client.get(f"/companies/{cid}/icp").json()["data"]
    assert len(icp["personas"]) >= 3
    assert len(icp["firmographics"]["industries"]) >= 3
    assert len(icp["keywords"]) >= 5
    sigs = [s for s in client.get(f"/companies/{cid}/signals").json() if s["is_active"]]
    assert len(sigs) >= 5
    assert len({c for s in sigs for c in s["channels"]}) >= 3


@pytest.mark.parametrize("name", DEMOS)
def test_leads_with_evidence(client, companies, name):
    cid = companies[name]["id"]
    page = client.get(f"/companies/{cid}/leads", params={"page_size": 100}).json()
    assert page["total"] >= 6, f"only {page['total']} leads"
    for lead in page["items"]:
        assert lead["signals"], f"{lead['org_name']} has no evidence"
        assert 0 <= lead["score"] <= 100


def test_email_action_reaches_mailpit(client, companies):
    cid = companies[DEMOS[0]]["id"]
    lead = client.get(f"/companies/{cid}/leads", params={"page_size": 1}).json()["items"][0]
    subject = f"e2e check {int(time.time())}"
    r = client.post(
        f"/leads/{lead['id']}/actions/email",
        json={"to": lead.get("email") or "prospect@example.com", "subject": subject, "body": "Hello from e2e"},
    )
    assert r.status_code == 200, r.text
    msgs = httpx.get(f"{MAILPIT}/api/v1/messages", timeout=10).json()["messages"]
    assert any(m["Subject"] == subject for m in msgs)
    detail = client.get(f"/leads/{lead['id']}").json()
    assert any(a["channel"] == "email" for a in detail["activities"])


def test_all_mcp_servers_healthy(client):
    servers = client.get("/mcp/servers").json()
    assert {s["name"] for s in servers if s["healthy"]} >= {"webscraper", "docparser", "signals"}

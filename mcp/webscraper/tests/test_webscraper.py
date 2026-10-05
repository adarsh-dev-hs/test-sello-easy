import functools
import http.server
import threading

import pytest
from fastmcp import Client
from starlette.testclient import TestClient

import server
from server import mcp

PAGES = {
    "site/index.html": """<html><head><title>Acme Home</title></head><body>
        <h1>Acme Networks</h1><p>We build industrial connectivity for factories and ports worldwide.</p>
        <a href="products.html">Products</a> <a href="index.html">Home</a> <a href="about.html">About</a> <a href="blog.html">Blog</a>
        <a href="brochure.pdf">Brochure</a> <a href="style.css">css</a> <a href="https://other.example/">x</a>
        <a href="/outside.html">outside sub-path</a></body></html>""",
    "site/products.html": """<html><head><title>Products</title></head><body><h1>Products</h1>
        <p>Private 5G core and small cells for heavy industry with deterministic latency.</p>
        <a href="index.html">Home</a> <a href="customers.html">Customers</a></body></html>""",
    "site/about.html": "<html><head><title>About</title></head><body><p>Founded in 2015 in Oslo, Acme Networks now serves 120 industrial sites across Europe and North America.</p></body></html>",
    "site/customers.html": "<html><head><title>Customers</title></head><body><p>Customer stories: how Harbor Logistics cut downtime by 40% and how Acme Steel connected 2,000 sensors across three plants.</p></body></html>",
    "site/blog.html": "<html><head><title>Blog</title></head><body><p>Blog post: five lessons from rolling out private wireless at a container terminal, from spectrum to handover tuning.</p></body></html>",
    "outside.html": "<html><head><title>Outside</title></head><body><p>not part of site</p></body></html>",
}


@pytest.fixture(scope="module")
def base_url(tmp_path_factory):
    root = tmp_path_factory.mktemp("www")
    (root / "site").mkdir()
    for rel, html in PAGES.items():
        (root / rel).write_text(html)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a, **k: None
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


async def test_tools_listed():
    async with Client(mcp) as c:
        names = {t.name for t in await c.list_tools()}
    assert {"scrape_url", "crawl_site"} <= names


async def test_scrape_url(base_url):
    async with Client(mcp) as c:
        res = await c.call_tool("scrape_url", {"url": f"{base_url}/site/"})
    d = res.data
    assert d["title"] == "Acme Home"
    assert "industrial connectivity" in d["markdown"]
    assert f"{base_url}/site/products.html" in d["links"]


async def test_crawl_site(base_url):
    async with Client(mcp) as c:
        res = await c.call_tool("crawl_site", {"url": f"{base_url}/site/", "max_pages": 10})
    pages = res.data["pages"]
    urls = [p["url"] for p in pages]
    assert f"{base_url}/site/products.html" in urls
    assert f"{base_url}/site/customers.html" in urls
    assert not any(u.endswith((".pdf", ".css")) for u in urls)
    assert not any("other.example" in u or "outside" in u for u in urls)
    assert len(urls) == len(set(urls)) and not any(u.endswith("index.html") for u in urls)
    # priority pages come before non-priority ones at the same depth
    assert urls.index(f"{base_url}/site/products.html") < urls.index(f"{base_url}/site/blog.html")


async def test_crawl_max_pages(base_url):
    async with Client(mcp) as c:
        res = await c.call_tool("crawl_site", {"url": f"{base_url}/site/", "max_pages": 2})
    assert len(res.data["pages"]) == 2


def test_health_and_auth(monkeypatch):
    app = server.mcp.http_app(path="/mcp", middleware=[server.Middleware(server.BearerAuthMiddleware, token="s3cret")])
    with TestClient(app) as tc:
        assert tc.get("/health").json() == {"ok": True}
        assert tc.post("/mcp", json={}).status_code == 401
        r = tc.post("/mcp", json={}, headers={"Authorization": "Bearer s3cret"})
        assert r.status_code != 401


def test_low_value_pages_are_filtered():
    import server

    for path in ["/privacy-policy", "/terms", "/legal/", "/gdpr-compliance", "/login", "/blog/tag/ai", "/cookie-policy",
                 "/platform-privacy-policy/", "/website-terms/", "/newsletter/"]:
        assert server.LOW_VALUE.search(path), path
    for path in ["/", "/platform", "/products/abm", "/customers", "/pricing", "/about-us", "/solutions/linkedin-ads",
                 "/linkedin-abm-campaigns/", "/terminal-automation"]:
        assert not server.LOW_VALUE.search(path), path

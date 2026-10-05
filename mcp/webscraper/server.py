"""SelloQ webscraper MCP server (FastMCP 2.x, streamable HTTP at /mcp, port 9001).

Tools (see docs/CONTRACTS.md §2):
  scrape_url(url)                                   -> {"url","title","markdown","links":[str]}
  crawl_site(url, max_pages=15, same_domain=True)   -> {"pages":[{"url","title","markdown"}]}
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
from urllib.parse import urldefrag, urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

try:
    import trafilatura
except Exception:  # pragma: no cover
    trafilatura = None

log = logging.getLogger("selloq.webscraper")

mcp = FastMCP("selloq-webscraper")

USER_AGENT = os.getenv(
    "SCRAPER_USER_AGENT",
    "Mozilla/5.0 (compatible; SelloQBot/0.1; +https://selloq.local/bot)",
)
PAGE_TIMEOUT = float(os.getenv("SCRAPER_TIMEOUT_SECONDS", "15"))
CONCURRENCY = int(os.getenv("SCRAPER_CONCURRENCY", "4"))
MAX_PAGES_HARD_CAP = int(os.getenv("SCRAPER_MAX_PAGES_CAP", "50"))
MAX_MARKDOWN_CHARS = int(os.getenv("SCRAPER_MAX_MARKDOWN_CHARS", "60000"))

ASSET_EXT = re.compile(
    r"\.(pdf|jpe?g|png|gif|svg|webp|ico|bmp|tiff?|css|js|mjs|map|json|xml|rss|atom|zip|gz|tgz|rar|7z|"
    r"mp3|mp4|m4a|wav|ogg|webm|mov|avi|woff2?|ttf|eot|otf|docx?|xlsx?|pptx?|csv|exe|dmg|apk)$",
    re.I,
)
PRIORITY_WORDS = (
    "about", "product", "solution", "customer", "industr", "pricing", "platform", "service",
    "use-case", "usecase", "feature", "integration", "how-it-works", "why",
)
CONTENT_MARKETING_WORDS = ("blog", "playbook", "news", "press", "resource", "article", "event", "webinar", "podcast")
MIN_PAGE_CHARS = int(os.getenv("SCRAPER_MIN_PAGE_CHARS", "80"))  # drops empty JS shells/stubs


# --------------------------------------------------------------------------- helpers
def _normalize(url: str) -> str:
    url, _ = urldefrag(url)
    p = urlparse(url)
    path = p.path or "/"
    # /dir/index.html and /dir/ are the same page on static sites
    path = re.sub(r"/index\.(html?|php)$", "/", path, flags=re.I)
    return p._replace(path=path, fragment="").geturl()


def _host(url: str) -> str:
    h = (urlparse(url).hostname or "").lower()
    return h[4:] if h.startswith("www.") else h


# Pages that say little about what a company sells (legal, auth, listing pages) — never crawled.
LOW_VALUE = re.compile(
    r"(^|[/_-])(privacy|terms|cookies?|legal|gdpr|dpa|security-policy|imprint|impressum|disclaimer|acceptable-use|"
    r"login|log-in|signin|sign-in|signup|sign-up|register|cart|checkout|account|wp-admin|wp-login|"
    r"feed|tag|tags|category|author|newsletter)([/_.-]|$)|/page/\d+",
    re.I,
)
SITEMAP_LOC = re.compile(r"<loc>\s*([^<\s]+)\s*</loc>", re.I)


async def _sitemap_urls(client: httpx.AsyncClient, start: str, limit: int = 300) -> list[str]:
    """URLs listed in /sitemap.xml (one level of sitemap indexes). Helps JS-rendered sites."""
    p = urlparse(start)
    queue = [f"{p.scheme}://{p.netloc}/sitemap.xml", f"{p.scheme}://{p.netloc}/sitemap_index.xml"]
    urls: list[str] = []
    for depth in range(2):
        nested: list[str] = []
        for sm in queue:
            try:
                r = await client.get(sm)
            except Exception:  # noqa: BLE001
                continue
            if r.status_code >= 400 or "<loc>" not in r.text:
                continue
            for loc in SITEMAP_LOC.findall(r.text):
                (nested if loc.lower().endswith(".xml") else urls).append(loc)
        queue = nested[:10]
        if not queue or len(urls) >= limit:
            break
    return urls[:limit]


def _priority(url: str) -> int:
    path = urlparse(url).path.lower()
    if path in ("", "/"):
        return 0
    if any(w in path for w in CONTENT_MARKETING_WORDS):
        return 2
    return 0 if any(w in path for w in PRIORITY_WORDS) else 1


def _extract(html: str, url: str) -> tuple[str, str, list[str]]:
    """Return (title, markdown, links)."""
    soup = BeautifulSoup(html, "html.parser")
    title = ""
    if soup.title and soup.title.string:
        title = soup.title.string.strip()
    if not title:
        h1 = soup.find("h1")
        title = h1.get_text(" ", strip=True) if h1 else ""

    links: list[str] = []
    seen: set[str] = set()
    for a in soup.find_all("a", href=True):
        href = a["href"].strip()
        if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
            continue
        absu = _normalize(urljoin(url, href))
        if urlparse(absu).scheme not in ("http", "https"):
            continue
        if absu not in seen:
            seen.add(absu)
            links.append(absu)

    markdown = ""
    if trafilatura is not None:
        try:
            markdown = trafilatura.extract(
                html,
                url=url,
                output_format="markdown",
                include_links=False,
                include_tables=True,
                include_comments=False,
                favor_recall=True,
            ) or ""
        except Exception as e:  # pragma: no cover
            log.warning("trafilatura failed for %s: %s", url, e)
    if len(markdown.strip()) < 200:
        # Fallback: plain text of the body (keeps headings as markdown-ish lines).
        for t in soup(["script", "style", "noscript", "svg"]):
            t.decompose()
        lines = []
        body = soup.body or soup
        for el in body.find_all(["h1", "h2", "h3", "h4", "p", "li", "td", "th", "blockquote"]):
            txt = el.get_text(" ", strip=True)
            if not txt:
                continue
            if el.name in ("h1", "h2", "h3", "h4"):
                lines.append("#" * int(el.name[1]) + " " + txt)
            elif el.name == "li":
                lines.append("- " + txt)
            else:
                lines.append(txt)
        fallback = "\n\n".join(lines) or body.get_text("\n", strip=True)
        if len(fallback) > len(markdown):
            markdown = fallback
    return title, markdown[:MAX_MARKDOWN_CHARS], links


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        follow_redirects=True,
        timeout=httpx.Timeout(PAGE_TIMEOUT),
        headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,*/*;q=0.8"},
    )


async def _fetch(client: httpx.AsyncClient, url: str) -> tuple[str, str] | None:
    """Fetch url; return (final_url, html) or None if not HTML / failed."""
    try:
        r = await client.get(url)
    except Exception as e:
        log.info("fetch failed %s: %s", url, e)
        return None
    if r.status_code >= 400:
        return None
    ctype = r.headers.get("content-type", "").lower()
    if ctype and "html" not in ctype and "xml" not in ctype and "text/plain" not in ctype:
        return None
    return _normalize(str(r.url)), r.text


# --------------------------------------------------------------------------- tools
@mcp.tool
async def scrape_url(url: str) -> dict:
    """Fetch a single web page and return its title, main content as markdown, and outgoing links."""
    async with _client() as client:
        res = await _fetch(client, url)
    if res is None:
        return {"url": url, "title": "", "markdown": "", "links": [], "error": "fetch failed or not HTML"}
    final_url, html = res
    title, md, links = _extract(html, final_url)
    return {"url": final_url, "title": title, "markdown": md, "links": links}


@mcp.tool
async def crawl_site(url: str, max_pages: int = 15, same_domain: bool = True) -> dict:
    """Breadth-first crawl starting at `url`, prioritising about/product/solution/customer/industry/
    pricing/platform/service pages. Returns markdown for up to `max_pages` HTML pages."""
    max_pages = max(1, min(int(max_pages or 15), MAX_PAGES_HARD_CAP))
    start = _normalize(url)
    root_host = _host(start)
    # Restrict to the start path's "directory" when the site lives in a sub-path (e.g. /nordwave/).
    start_path = urlparse(start).path
    base_dir = start_path if start_path.endswith("/") else start_path.rsplit("/", 1)[0] + "/"

    def allowed(u: str) -> bool:
        p = urlparse(u)
        if p.scheme not in ("http", "https"):
            return False
        if ASSET_EXT.search(p.path or ""):
            return False
        if LOW_VALUE.search(p.path or "/"):
            return False
        if same_domain:
            if _host(u) != root_host:
                return False
            if base_dir != "/" and not (p.path or "/").startswith(base_dir):
                return False
        return True

    seen: set[str] = {start}
    frontier: list[str] = [start]
    pages: list[dict] = []
    content_hashes: set[str] = set()
    sem = asyncio.Semaphore(CONCURRENCY)

    async with _client() as client:
        for su in await _sitemap_urls(client, start):
            su = _normalize(su)
            if su not in seen and allowed(su):
                seen.add(su)
                frontier.append(su)

        async def work(u: str):
            async with sem:
                return u, await _fetch(client, u)

        while frontier and len(pages) < max_pages:
            frontier.sort(key=_priority)  # stable: keeps BFS order within a priority class
            batch = frontier[: max(CONCURRENCY, max_pages - len(pages))]
            frontier = frontier[len(batch):]
            results = await asyncio.gather(*(work(u) for u in batch))
            next_links: list[str] = []
            for _u, res in results:
                if res is None:
                    continue
                final_url, html = res
                if any(p["url"] == final_url for p in pages):
                    continue
                title, md, links = _extract(html, final_url)
                digest = hashlib.sha1(md.strip().encode()).hexdigest()
                if md.strip() and digest in content_hashes:
                    continue  # same content under another URL
                content_hashes.add(digest)
                if len(md.strip()) >= MIN_PAGE_CHARS and len(pages) < max_pages:
                    pages.append({"url": final_url, "title": title, "markdown": md})
                seen.add(final_url)
                for link in links:
                    if link not in seen and allowed(link):
                        seen.add(link)
                        next_links.append(link)
            frontier.extend(next_links)

    return {"pages": pages}


# --------------------------------------------------------------------------- http app
@mcp.custom_route("/health", methods=["GET"])
async def health(_: Request) -> JSONResponse:
    return JSONResponse({"ok": True})


class BearerAuthMiddleware:
    """Pure ASGI middleware: require `Authorization: Bearer $MCP_SHARED_TOKEN` (if set), except GET /health."""

    def __init__(self, app, token: str | None = None):
        self.app = app
        self.token = token if token is not None else os.getenv("MCP_SHARED_TOKEN", "")

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not self.token:
            return await self.app(scope, receive, send)
        if scope.get("path", "").rstrip("/") == "/health":
            return await self.app(scope, receive, send)
        auth = ""
        for k, v in scope.get("headers", []):
            if k == b"authorization":
                auth = v.decode("latin-1")
                break
        if auth != f"Bearer {self.token}":
            resp = JSONResponse({"error": "unauthorized"}, status_code=401)
            return await resp(scope, receive, send)
        return await self.app(scope, receive, send)


app = mcp.http_app(path="/mcp", middleware=[Middleware(BearerAuthMiddleware)])

if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "9001")))

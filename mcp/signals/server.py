"""SelloQ signals MCP server (FastMCP 2.x, streamable HTTP at /mcp, port 9003).

PROVIDER_MODE=fixture (default) serves fixtures/*.json; PROVIDER_MODE=live calls Tavily/Exa/X/Reddit/Hunter.
Tool contracts: docs/CONTRACTS.md §2.
"""
from __future__ import annotations

import logging
import os

from fastmcp import FastMCP
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from providers import fixture, live

log = logging.getLogger("selloq.signals")

mcp = FastMCP("selloq-signals")


def _provider():
    mode = os.getenv("PROVIDER_MODE", "fixture").strip().lower()
    return live if mode == "live" else fixture


def _clamp(limit: int, since_days: int) -> tuple[int, int]:
    return max(1, min(int(limit or 10), 50)), max(1, int(since_days or 30))


async def _safe(coro, empty: dict) -> dict:
    try:
        return await coro
    except Exception as e:  # never leak exceptions to the client
        log.exception("provider error")
        return {**empty, "warning": f"provider error: {e}"}


@mcp.tool
async def search_web(query: str, since_days: int = 30, limit: int = 10) -> dict:
    """Search the open web. Returns {"hits": [Hit]} where Hit = {source, url, title, snippet, author,
    published_at, company}."""
    limit, since_days = _clamp(limit, since_days)
    return await _safe(_provider().search_web(query, since_days, limit), {"hits": []})


@mcp.tool
async def search_news(query: str, since_days: int = 30, limit: int = 10) -> dict:
    """Search recent news articles. Returns {"hits": [Hit]}."""
    limit, since_days = _clamp(limit, since_days)
    return await _safe(_provider().search_news(query, since_days, limit), {"hits": []})


@mcp.tool
async def search_social(platform: str, query: str, since_days: int = 30, limit: int = 10) -> dict:
    """Search social posts on one platform: x | linkedin | reddit | facebook. Returns {"hits": [Hit]}."""
    limit, since_days = _clamp(limit, since_days)
    return await _safe(_provider().search_social(platform, query, since_days, limit), {"hits": []})


@mcp.tool
async def search_jobs(query: str, location: str | None = None, since_days: int = 30, limit: int = 10) -> dict:
    """Search job postings (optionally near `location`). Returns {"hits": [Hit]} with `company` set."""
    limit, since_days = _clamp(limit, since_days)
    return await _safe(_provider().search_jobs(query, location, since_days, limit), {"hits": []})


@mcp.tool
async def enrich_company(name: str | None = None, domain: str | None = None) -> dict:
    """Look up firmographics by company name or domain. Returns {"company": {name, domain, industry,
    employees, hq, linkedin_url, description} | null}."""
    if not name and not domain:
        return {"company": None, "warning": "name or domain required"}
    return await _safe(_provider().enrich_company(name, domain), {"company": None})


@mcp.tool
async def find_contacts(company: str | None = None, domain: str | None = None, titles: list[str] = []) -> dict:  # noqa: B006
    """Find people at a company; contacts whose title matches any of `titles` come first.
    Returns {"contacts": [{name, title, email, phone, linkedin_url}]}."""
    return await _safe(_provider().find_contacts(company, domain, list(titles or [])), {"contacts": []})


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
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "9003")))

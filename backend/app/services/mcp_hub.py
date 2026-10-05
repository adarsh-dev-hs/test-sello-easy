"""MCP Hub: routes capability calls to configured FastMCP servers and logs every call."""

import asyncio
import json
import logging
import os
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

import yaml
from fastmcp import Client

from app.config import settings
from app.db import SessionLocal
from app.models import MCPCallLog

log = logging.getLogger(__name__)
_ENV_RE = re.compile(r"\$\{([A-Z0-9_]+)\}")


class MCPError(RuntimeError):
    pass


@dataclass
class ServerConfig:
    name: str
    url: str
    capabilities: list[str]
    token: str | None = None
    enabled: bool = True
    tools: list[str] = field(default_factory=list)


def _expand(value: str) -> str:
    return _ENV_RE.sub(lambda m: os.environ.get(m.group(1), ""), value)


def load_servers(path: str | None = None) -> list[ServerConfig]:
    with open(path or settings.mcp_config_path) as f:
        raw = yaml.safe_load(f) or {}
    if not raw.get("servers"):
        raise MCPError(f"MCP registry {path or settings.mcp_config_path} defines no servers")
    servers = []
    for name, cfg in (raw.get("servers") or {}).items():
        enabled = cfg.get("enabled", True)
        if (gate := cfg.get("enabled_if_env")) and not os.environ.get(gate):
            enabled = False
        url = _expand(cfg.get("url", ""))
        if not url:
            enabled = False
        token_env = cfg.get("auth_token_env")
        servers.append(
            ServerConfig(
                name=name,
                url=url,
                capabilities=list(cfg.get("capabilities") or []),
                token=os.environ.get(token_env) if token_env else None,
                enabled=enabled,
            )
        )
    return servers


def _extract(result: Any) -> Any:
    """Turn a FastMCP CallToolResult into plain JSON-able data."""
    sc = getattr(result, "structured_content", None)
    if isinstance(sc, dict):
        # FastMCP wraps non-object returns as {"result": ...}
        if set(sc.keys()) == {"result"}:
            return sc["result"]
        return sc
    for block in getattr(result, "content", None) or []:
        text = getattr(block, "text", None)
        if text:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return {"text": text}
    return getattr(result, "data", None)


class MCPHub:
    def __init__(self, servers: list[ServerConfig] | None = None):
        self.servers = servers if servers is not None else load_servers()

    def server_for(self, capability: str) -> ServerConfig:
        for s in self.servers:
            if s.enabled and capability in s.capabilities:
                return s
        raise MCPError(f"No enabled MCP server provides capability '{capability}'")

    def _client(self, server: ServerConfig) -> Client:
        return Client(server.url, auth=server.token or None, timeout=settings.mcp_call_timeout_seconds)

    async def call(
        self,
        capability: str,
        tool: str,
        args: dict,
        *,
        company_id: uuid.UUID | None = None,
        run_id: uuid.UUID | None = None,
    ) -> Any:
        server = self.server_for(capability)
        started = time.monotonic()
        ok, error, data = True, None, None
        try:
            async with self._client(server) as c:
                result = await c.call_tool(tool, args, timeout=settings.mcp_call_timeout_seconds)
            data = _extract(result)
            return data
        except Exception as e:  # noqa: BLE001 — isolate MCP failures
            ok, error = False, f"{type(e).__name__}: {e}"
            raise MCPError(f"{server.name}.{tool} failed: {error}") from e
        finally:
            await self._log(server.name, tool, args, started, ok, error, data, company_id, run_id)

    async def fan_out(self, calls: list[tuple[str, str, dict]], concurrency: int = 5, **kw) -> list[Any]:
        """Run many (capability, tool, args) calls; failures come back as MCPError instances."""
        sem = asyncio.Semaphore(concurrency)

        async def one(cap: str, tool: str, args: dict) -> Any:
            async with sem:
                try:
                    return await self.call(cap, tool, args, **kw)
                except MCPError as e:
                    log.warning("%s", e)
                    return e

        return await asyncio.gather(*(one(*c) for c in calls))

    async def describe(self) -> list[dict]:
        async def one(s: ServerConfig) -> dict:
            info = {
                "name": s.name,
                "url": re.sub(r"(api[Kk]ey=)[^&]+", r"\1***", s.url),
                "capabilities": s.capabilities,
                "enabled": s.enabled,
                "healthy": False,
                "tools": [],
                "error": None,
            }
            if not s.enabled:
                return info
            try:
                async with asyncio.timeout(10):
                    async with self._client(s) as c:
                        tools = await c.list_tools()
                info["tools"] = [t.name for t in tools]
                info["healthy"] = True
            except Exception as e:  # noqa: BLE001
                info["error"] = f"{type(e).__name__}: {e}"[:300]
            return info

        return await asyncio.gather(*(one(s) for s in self.servers))

    @staticmethod
    async def _log(server, tool, args, started, ok, error, data, company_id, run_id) -> None:
        try:
            preview = json.dumps(data, default=str)[:1000] if data is not None else None
            async with SessionLocal() as s:
                s.add(
                    MCPCallLog(
                        company_id=company_id,
                        run_id=run_id,
                        server=server,
                        tool=tool,
                        args={k: (v if len(str(v)) < 500 else str(v)[:500]) for k, v in args.items()},
                        latency_ms=int((time.monotonic() - started) * 1000),
                        ok=ok,
                        error=error,
                        result_preview=preview,
                    )
                )
                await s.commit()
        except Exception:  # noqa: BLE001 — logging must never break a pipeline
            log.exception("failed to write mcp_call_log")


_hub: MCPHub | None = None


def get_hub() -> MCPHub:
    global _hub
    if _hub is None:
        _hub = MCPHub()
    return _hub

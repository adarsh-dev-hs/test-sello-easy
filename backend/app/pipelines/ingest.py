"""Step 1: website + uploaded documents → extracted text (via MCP webscraper/docparser)."""

import logging
import uuid

from sqlalchemy import delete, select

from app.config import settings
from app.db import SessionLocal
from app.models import Company, Source
from app.pipelines.common import PipelineError, update_status
from app.security import sign_file_token
from app.services.mcp_hub import MCPError, get_hub

log = logging.getLogger(__name__)
MAX_PAGES = 15


async def run_ingest(company_id: uuid.UUID) -> None:
    hub = get_hub()
    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        website = company.website_url

    crawl_error = None
    if website:
        await update_status(company_id, message=f"Crawling {website}", progress=5)
        try:
            data = await hub.call(
                "scrape", "crawl_site", {"url": website, "max_pages": MAX_PAGES}, company_id=company_id
            )
            pages = (data or {}).get("pages") or []
        except MCPError as e:
            pages, crawl_error = [], str(e)
            log.warning("crawl failed: %s", e)
        async with SessionLocal() as s:
            await s.execute(delete(Source).where(Source.company_id == company_id, Source.kind == "website"))
            for p in pages:
                text = (p.get("markdown") or "").strip()
                if not text:
                    continue
                s.add(
                    Source(
                        company_id=company_id,
                        kind="website",
                        uri=p.get("url") or website,
                        filename=p.get("title"),
                        mime="text/html",
                        status="parsed",
                        extracted_text=text[:60_000],
                        meta={"title": p.get("title")},
                    )
                )
            await s.commit()

    async with SessionLocal() as s:
        files = (
            await s.scalars(
                select(Source).where(Source.company_id == company_id, Source.storage_path.is_not(None))
            )
        ).all()
        file_specs = [(f.id, f.mime or "", f.filename or "") for f in files]

    if file_specs:
        await update_status(company_id, message=f"Parsing {len(file_specs)} document(s)", progress=40)
        calls = [
            (
                "doc_parse",
                "parse_document",
                {
                    "file_url": f"{settings.public_backend_url}/api/v1/files/{fid}?token={sign_file_token(fid)}",
                    "mime_type": mime,
                    "filename": name,
                },
            )
            for fid, mime, name in file_specs
        ]
        results = await hub.fan_out(calls, concurrency=3, company_id=company_id)
        async with SessionLocal() as s:
            for (fid, _, _), res in zip(file_specs, results):
                src = await s.get(Source, fid)
                if isinstance(res, Exception):
                    src.status, src.error = "failed", str(res)[:2000]
                    continue
                res = res or {}
                text = (res.get("text") or "").strip()
                tables = res.get("tables") or []
                if tables and not any(t[:200] in text for t in tables if t):
                    text = (text + "\n\n" + "\n\n".join(tables)).strip()
                src.extracted_text = text[:100_000]
                src.meta = {"pages": res.get("pages"), **(res.get("meta") or {})}
                src.status = "parsed" if text else "failed"
                src.error = None if text else (res.get("meta") or {}).get("warning") or "No text extracted"
            await s.commit()

    async with SessionLocal() as s:
        parsed = (
            await s.scalars(
                select(Source.id).where(
                    Source.company_id == company_id, Source.status == "parsed", Source.extracted_text.is_not(None)
                )
            )
        ).all()
    if not parsed:
        raise PipelineError(
            "No content could be extracted from the website or documents"
            + (f" (crawl error: {crawl_error})" if crawl_error else "")
        )
    await update_status(company_id, message=f"Extracted text from {len(parsed)} source(s)", progress=100)

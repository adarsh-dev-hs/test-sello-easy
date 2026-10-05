"""Idempotent demo seeding: demo user + 2 workspaces (NordWave, LedgerLeaf) + their docs, then runs the
real pipeline (MCP crawl/parse → LLM profile → ICP → signals → MCP lead search) for each."""

import asyncio
import logging
from pathlib import Path

from sqlalchemy import func, select

from app.config import settings
from app.db import SessionLocal
from app.models import Company, Source, User, Workspace
from app.security import hash_password
from app.services import storage
from app.services.queue import get_pool

log = logging.getLogger("seed")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

DEMOS = [
    {"workspace": "NordWave Networks", "company": "NordWave Networks", "site": "nordwave", "docs": "nordwave"},
    {"workspace": "LedgerLeaf", "company": "LedgerLeaf", "site": "ledgerleaf", "docs": "ledgerleaf"},
]


async def seed() -> None:
    if not settings.seed_demo:
        log.info("SEED_DEMO=false — skipping demo seed")
        return
    to_run = []
    async with SessionLocal() as s:
        email = settings.demo_user_email.lower()
        user = await s.scalar(select(User).where(func.lower(User.email) == email))
        if user is None:
            user = User(email=email, name="Demo Admin", password_hash=hash_password(settings.demo_user_password))
            s.add(user)
            await s.flush()
            log.info("created demo user %s", email)

        for demo in DEMOS:
            exists = await s.scalar(
                select(Workspace).where(Workspace.owner_id == user.id, Workspace.name == demo["workspace"])
            )
            if exists:
                company = await s.scalar(select(Company).where(Company.workspace_id == exists.id))
                # Resume demo flows that never finished (e.g. first boot happened without OPENAI_API_KEY).
                if company and company.status in ("draft", "failed") and settings.openai_api_key:
                    to_run.append(company.id)
                    log.info("demo workspace %s exists but is %s — re-running pipeline", demo["workspace"], company.status)
                else:
                    log.info("demo workspace %s already exists — skipping", demo["workspace"])
                continue
            ws = Workspace(owner_id=user.id, name=demo["workspace"])
            s.add(ws)
            await s.flush()
            company = Company(
                workspace_id=ws.id,
                name=demo["company"],
                website_url=f"{settings.demo_sites_base_url}/{demo['site']}/",
                status="draft",
                status_detail={},
            )
            s.add(company)
            await s.flush()
            docs_dir = Path(settings.demo_assets_dir) / demo["docs"]
            files = sorted(p for p in docs_dir.glob("*") if p.is_file()) if docs_dir.exists() else []
            if not files:
                log.warning("no demo docs found in %s", docs_dir)
            for p in files:
                path = storage.save_bytes(company.id, p.name, p.read_bytes())
                s.add(
                    Source(
                        company_id=company.id,
                        kind=storage.kind_for(p.name),
                        uri=f"upload://{p.name}",
                        filename=p.name,
                        mime=storage.mime_for(p.name),
                        storage_path=path,
                        status="pending",
                        meta={"size": p.stat().st_size, "demo": True},
                    )
                )
            to_run.append(company.id)
            log.info("seeded %s with %d docs", demo["company"], len(files))
        await s.commit()

    if to_run:
        pool = await get_pool()
        for cid in to_run:
            await pool.enqueue_job("pipeline_job", str(cid), "ingest", False, _job_id=f"pipeline:{cid}")
            log.info("enqueued pipeline for %s", cid)
        if not settings.openai_api_key:
            log.warning("OPENAI_API_KEY is empty — demo pipelines will stop at the profile step")


if __name__ == "__main__":
    asyncio.run(seed())

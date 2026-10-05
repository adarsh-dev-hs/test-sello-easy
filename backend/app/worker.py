import logging
import uuid

from arq import cron
from arq.connections import RedisSettings
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import Company
from app.pipelines.runner import run_pipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worker")


async def pipeline_job(ctx, company_id: str, from_step: str = "ingest", only: bool = False) -> None:
    log.info("pipeline %s from=%s only=%s", company_id, from_step, only)
    await run_pipeline(uuid.UUID(company_id), from_step, only)


async def scheduled_signal_runs(ctx) -> None:
    async with SessionLocal() as s:
        ids = (await s.scalars(select(Company.id).where(Company.status == "leads_ready"))).all()
    for cid in ids:
        await ctx["redis"].enqueue_job(
            "pipeline_job", str(cid), "leads", True, _job_id=f"pipeline:{cid}"
        )


def _cron_jobs():
    hours = settings.signal_run_interval_hours
    if hours <= 0:
        return []
    return [cron(scheduled_signal_runs, hour=set(range(0, 24, hours)), minute=0)]


class WorkerSettings:
    functions = [pipeline_job]
    cron_jobs = _cron_jobs()
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    job_timeout = 1800
    max_jobs = 4
    keep_result = 5

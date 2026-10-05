import uuid

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings
from fastapi import HTTPException

from app.config import settings

_pool: ArqRedis | None = None


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    return _pool


async def enqueue_pipeline(company_id: uuid.UUID, from_step: str = "ingest", only: bool = False) -> str:
    """One pipeline per company at a time (arq dedupes by job id)."""
    pool = await get_pool()
    job = await pool.enqueue_job(
        "pipeline_job", str(company_id), from_step, only, _job_id=f"pipeline:{company_id}"
    )
    if job is None:
        raise HTTPException(409, "A pipeline is already running for this company")
    return job.job_id

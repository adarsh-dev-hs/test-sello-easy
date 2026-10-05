import logging
import uuid

from app.pipelines.common import STEP_KEYS, STEPS, PipelineError, update_status
from app.pipelines.icp import run_icp
from app.pipelines.ingest import run_ingest
from app.pipelines.leads import run_leads
from app.pipelines.profile import run_profile
from app.pipelines.signals import run_signals
from app.db import SessionLocal
from app.models import Company

log = logging.getLogger(__name__)

STEP_FUNCS = {
    "ingest": run_ingest,
    "profile": run_profile,
    "icp": run_icp,
    "signals": run_signals,
    "leads": run_leads,
}
RUNNING_STATUS = {key: status for key, _, status in STEPS}


async def run_pipeline(company_id: uuid.UUID, from_step: str = "ingest", only: bool = False) -> None:
    if from_step not in STEP_KEYS:
        raise ValueError(f"unknown step {from_step}")
    start = STEP_KEYS.index(from_step)
    steps = [from_step] if only else STEP_KEYS[start:]

    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        completed = [k for k in (company.status_detail or {}).get("completed_steps", []) if k not in steps]

    for i, step in enumerate(steps):
        await update_status(
            company_id,
            status=RUNNING_STATUS[step],
            step=step,
            progress=0,
            message=f"Starting {step}",
            error=None,
            failed_step=None,
            completed_steps=completed,
        )
        try:
            await STEP_FUNCS[step](company_id)
        except Exception as e:  # noqa: BLE001
            msg = str(e) if isinstance(e, PipelineError) else f"{type(e).__name__}: {e}"
            log.exception("pipeline step %s failed for %s", step, company_id)
            await update_status(
                company_id, status="failed", failed_step=step, error=msg[:2000], message=f"{step} failed"
            )
            return
        completed.append(step)

    final = "leads_ready" if "leads" in completed else "draft"
    await update_status(
        company_id, status=final, step=None, progress=100, message="Done", completed_steps=completed, error=None
    )

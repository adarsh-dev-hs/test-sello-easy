import uuid

from app.db import SessionLocal
from app.models import Company

STEPS: list[tuple[str, str, str]] = [
    # key, label, company.status while running
    ("ingest", "Reading website & documents", "ingesting"),
    ("profile", "Building company profile", "profiling"),
    ("icp", "Generating ICP", "generating_icp"),
    ("signals", "Creating signals", "generating_signals"),
    ("leads", "Finding leads", "finding_leads"),
]
STEP_KEYS = [s[0] for s in STEPS]


class PipelineError(RuntimeError):
    """Expected, user-facing pipeline failure."""


async def update_status(company_id: uuid.UUID, **detail) -> None:
    """Merge `detail` into company.status_detail; `status` key (if given) sets company.status."""
    async with SessionLocal() as s:
        company = await s.get(Company, company_id)
        if company is None:
            return
        status = detail.pop("status", None)
        if status:
            company.status = status
        company.status_detail = {**(company.status_detail or {}), **detail}
        await s.commit()


def status_view(company: Company) -> dict:
    d = company.status_detail or {}
    completed = set(d.get("completed_steps") or [])
    current = d.get("step") if company.status not in ("leads_ready", "failed", "draft") else None
    failed = d.get("failed_step") if company.status == "failed" else None
    steps = []
    for key, label, _ in STEPS:
        state = "pending"
        if key == failed:
            state = "failed"
        elif key == current:
            state = "running"
        elif key in completed:
            state = "done"
        steps.append({"key": key, "label": label, "state": state})
    return {
        "status": company.status,
        "step": d.get("step"),
        "progress": d.get("progress", 0),
        "message": d.get("message"),
        "error": d.get("error"),
        "steps": steps,
    }

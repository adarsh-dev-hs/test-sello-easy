import asyncio
import logging
from typing import TypeVar

from openai import AsyncOpenAI
from pydantic import BaseModel

from app.config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMError(RuntimeError):
    pass


_client: AsyncOpenAI | None = None
_sem = asyncio.Semaphore(settings.llm_max_concurrency)


def client() -> AsyncOpenAI:
    global _client
    if not settings.openai_api_key:
        raise LLMError("OPENAI_API_KEY is not set — add it to .env and restart (docker compose up -d)")
    if _client is None:
        _client = AsyncOpenAI(api_key=settings.openai_api_key, max_retries=3, timeout=180)
    return _client


async def structured(
    system: str, user: str, schema: type[T], *, cheap: bool = False, model: str | None = None
) -> T:
    """Call the LLM and parse the answer into `schema` via Structured Outputs."""
    model = model or (settings.openai_model_cheap if cheap else settings.openai_model)
    async with _sem:
        resp = await client().chat.completions.parse(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            response_format=schema,
        )
    msg = resp.choices[0].message
    if msg.parsed is None:
        raise LLMError(f"LLM returned no parsable output (refusal={msg.refusal!r})")
    return msg.parsed

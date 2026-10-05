# Build context: repository root (needs backend/, demo/, mcp_servers.yaml)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
COPY demo/requirements.txt /tmp/demo-requirements.txt
RUN pip install -r /app/requirements.txt -r /tmp/demo-requirements.txt

# Demo assets (PDF/XLSX/PNG/DOCX) are generated at build time → /demo/docs
COPY demo /demo
RUN python /demo/generate_assets.py /demo/docs

COPY mcp_servers.yaml /app/mcp_servers.yaml
COPY backend /app

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && python -m scripts.seed_demo && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

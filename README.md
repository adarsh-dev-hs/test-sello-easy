# SelloQ

Marketing & sales intelligence MVP. Add your company website and documents. SelloQ then:

1. **Builds a company profile.** MCP servers crawl the site and parse PDF, DOCX, XLSX, images (OCR) and audio/video. The LLM writes a profile with source citations.
2. **Derives an ICP** (ideal customer profile), which you can edit and which is versioned.
3. **Generates buying signals**: hiring, expansion, leadership changes, pain posts, funding and so on, across web, news, jobs, X, LinkedIn, Reddit and Facebook.
4. **Finds leads.** Signals run through MCP search tools, the LLM qualifies each hit against the ICP, and leads are deduped, enriched and scored with the evidence attached.
5. **Lets you act.** From the Signal Feed you can send email (an AI draft, sent via SMTP), log a call, or open WhatsApp with an AI-drafted message.

See [plan.md](plan.md) for the design and [docs/CONTRACTS.md](docs/CONTRACTS.md) for the API and MCP contracts.

## Quick start

```bash
cp .env.example .env        # then set OPENAI_API_KEY=sk-...
docker compose up --build   # starts the whole `test-selloq` stack
```

| URL | What |
|---|---|
| http://localhost:5173 | App. Log in with **demo@selloq.local / demo1234** |
| http://localhost:8000/docs | API (Swagger) |
| http://localhost:8025 | Mailpit (captures every email the app sends) |
| http://localhost:8080 | Demo company websites |

On first start the backend seeds two demo workspaces, **NordWave Networks** (private 5G) and **LedgerLeaf** (AP automation), and runs the full pipeline for each. This takes about 2–5 minutes, and progress is shown live in the UI.

`make` shortcuts: `make up`, `make logs`, `make test`, `make test-e2e`, `make reset` (wipes data and reseeds).

## Services (docker compose project `test-selloq`)

| Container | Role |
|---|---|
| `test-selloq-frontend` | React + Vite SPA served by nginx; proxies `/api` to the backend |
| `test-selloq-backend` | FastAPI REST API. Runs migrations and the demo seed on start |
| `test-selloq-worker` | arq worker that runs the pipelines (ingest → profile → ICP → signals → leads) |
| `test-selloq-postgres` / `-redis` | Storage and job queue |
| `test-selloq-mcp-webscraper` | FastMCP server: `scrape_url`, `crawl_site` |
| `test-selloq-mcp-docparser` | FastMCP server: `parse_document` (PDF, DOCX, XLSX, CSV, OCR, transcription) |
| `test-selloq-mcp-signals` | FastMCP server: `search_web/news/social/jobs`, `enrich_company`, `find_contacts` |
| `test-selloq-demo-sites` | Static websites of the two fictional demo companies |
| `test-selloq-mailpit` | Local SMTP sink |

## Demo data vs live data

- `PROVIDER_MODE=fixture` (the default): `mcp-signals` answers from deterministic fixtures. The fixtures contain fictional prospects plus noise posts, which the AI qualification should reject. Only an OpenAI key is needed.
- `PROVIDER_MODE=live`: set `TAVILY_API_KEY` or `EXA_API_KEY`, and optionally `X_BEARER_TOKEN`, the Reddit keys and `HUNTER_API_KEY`. Then add any real company, e.g. `https://www.nokia.com`, from the UI.

## Adding MCP servers

Edit [mcp_servers.yaml](mcp_servers.yaml). Pipelines ask for a **capability** (`scrape`, `doc_parse`, `web_search`, `news_search`, `social_search`, `job_search`, `enrich`), and the first enabled server that provides it handles the call. Every call is logged to the `mcp_call_logs` table. To run the custom servers on **FastMCP Cloud**, deploy each `mcp/<name>/server.py`, then point `MCP_*_URL` and `MCP_SHARED_TOKEN` at the cloud deployment. `PUBLIC_BACKEND_URL` must also be reachable from there, because the docparser downloads uploads through signed URLs.

## Deploying the frontend to Vercel

The frontend can run in two modes, chosen at build time with `VITE_DEMO_MODE` (see [frontend/.env.example](frontend/.env.example)):

| `VITE_DEMO_MODE` | What you get |
|---|---|
| `true` | **Frontend only, no backend needed.** An in-browser mock API serves a snapshot of real pipeline runs for NordWave and LedgerLeaf. New workspaces run a simulated pipeline and are filled with clearly labelled sample data. Email, call and WhatsApp actions are logged, but no email is actually sent. State lives in each visitor's browser, and the banner has a "Reset demo data" link. No AI or MCP calls happen. |
| `false` (default) | The real app. Requires the backend stack hosted somewhere. Set `VITE_API_BASE=https://<backend>/api/v1` and add the Vercel URL to the backend's `CORS_ORIGINS`. |

Vercel setup: **Add New Project**, import the GitHub repo, and set **Root Directory** to `frontend`. The framework, build command and output directory are already set in `frontend/vercel.json`, which also adds the SPA fallback for deep links. Under **Environment Variables**, add `VITE_DEMO_MODE=true`, then deploy. If you change the variable later, redeploy, because Vite bakes it in at build time.

To refresh the demo snapshot after a newer local run, run `python3 scripts/export_demo_snapshot.py` while the stack is up, then commit `frontend/src/demo/snapshot.json`.

## Development

- Backend unit tests: `make test`. End-to-end acceptance for both demo flows (stack must be up): `make test-e2e`
- Frontend dev server: `cd frontend && npm install && npm run dev`, which proxies `/api` to `localhost:8000`

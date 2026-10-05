# SelloEasy

Marketing & sales intelligence MVP. Add your company website and documents. SelloEasy then:

1. **Builds a company profile.** MCP servers crawl the site and parse PDF, DOCX, XLSX, images (OCR) and audio/video. The LLM writes a profile with source citations.
2. **Derives an ICP** (ideal customer profile), which you can edit and which is versioned.
3. **Generates buying signals**: hiring, expansion, leadership changes, pain posts, funding and so on, across web, news, jobs, X, LinkedIn, Reddit and Facebook.
4. **Finds leads.** Signals run through MCP search tools, the LLM qualifies each hit against the ICP, and leads are deduped, enriched and scored with the evidence attached.
5. **Lets you act.** From the Signal Feed you can send email (an AI draft, sent via SMTP), log a call, or open WhatsApp with an AI-drafted message.

See [plan.md](plan.md) for the design and [docs/CONTRACTS.md](docs/CONTRACTS.md) for the API and MCP contracts.

## Quick start

```bash
cp .env.example .env        # then set OPENAI_API_KEY=sk-...
docker compose up --build   # starts the whole `test-selloeasy` stack
```

| URL | What |
|---|---|
| http://localhost:5173 | App. Log in with **demo@selloeasy.local / demo1234** |
| http://localhost:8000/docs | API (Swagger) |
| http://localhost:8025 | Mailpit (captures every email the app sends) |
| http://localhost:8080 | Demo company websites |

On first start the backend seeds two demo workspaces, **NordWave Networks** (private 5G) and **LedgerLeaf** (AP automation), and runs the full pipeline for each. This takes about 2–5 minutes, and progress is shown live in the UI.

`make` shortcuts: `make up`, `make logs`, `make test`, `make test-e2e`, `make reset` (wipes data and reseeds).

## Services (docker compose project `test-selloeasy`)

| Container | Role |
|---|---|
| `test-selloeasy-frontend` | React + Vite SPA served by nginx; proxies `/api` to the backend |
| `test-selloeasy-backend` | FastAPI REST API. Runs migrations and the demo seed on start |
| `test-selloeasy-worker` | arq worker that runs the pipelines (ingest → profile → ICP → signals → leads) |
| `test-selloeasy-postgres` / `-redis` | Storage and job queue |
| `test-selloeasy-mcp-webscraper` | FastMCP server: `scrape_url`, `crawl_site` |
| `test-selloeasy-mcp-docparser` | FastMCP server: `parse_document` (PDF, DOCX, XLSX, CSV, OCR, transcription) |
| `test-selloeasy-mcp-signals` | FastMCP server: `search_web/news/social/jobs`, `enrich_company`, `find_contacts` |
| `test-selloeasy-demo-sites` | Static websites of the two fictional demo companies |
| `test-selloeasy-mailpit` | Local SMTP sink |

## Demo data vs live data

- `PROVIDER_MODE=fixture` (the default): `mcp-signals` answers from deterministic fixtures. The fixtures contain fictional prospects plus noise posts, which the AI qualification should reject. Only an OpenAI key is needed.
- `PROVIDER_MODE=live`: set `TAVILY_API_KEY` or `EXA_API_KEY`, and optionally `X_BEARER_TOKEN`, the Reddit keys and `HUNTER_API_KEY`. Then add any real company, e.g. `https://www.nokia.com`, from the UI.

## Adding MCP servers

Edit [mcp_servers.yaml](mcp_servers.yaml). Pipelines ask for a **capability** (`scrape`, `doc_parse`, `web_search`, `news_search`, `social_search`, `job_search`, `enrich`), and the first enabled server that provides it handles the call. Every call is logged to the `mcp_call_logs` table. To run the custom servers on **FastMCP Cloud**, deploy each `mcp/<name>/server.py`, then point `MCP_*_URL` and `MCP_SHARED_TOKEN` at the cloud deployment. `PUBLIC_BACKEND_URL` must also be reachable from there, because the docparser downloads uploads through signed URLs.

## Development

- Backend unit tests: `make test`. End-to-end acceptance for both demo flows (stack must be up): `make test-e2e`
- Frontend dev server: `cd frontend && npm install && npm run dev`, which proxies `/api` to `localhost:8000`

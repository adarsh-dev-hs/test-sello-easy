# SelloEasy — Shared Contracts

Source of truth for interfaces between backend, MCP servers and frontend. All IDs are UUID strings, all datetimes ISO-8601 UTC.

## 1. Ports & service names (docker compose network)

| Service | Internal URL | Host port |
|---|---|---|
| postgres | postgres:5432 | 5433 |
| redis | redis:6379 | — |
| backend | http://backend:8000 (API prefix `/api/v1`) | 8000 |
| frontend (nginx) | http://frontend:80, proxies `/api/` → backend:8000 | 5173 |
| mcp-webscraper | http://mcp-webscraper:9001/mcp | — |
| mcp-docparser | http://mcp-docparser:9002/mcp | — |
| mcp-signals | http://mcp-signals:9003/mcp | — |
| demo-sites (nginx) | http://demo-sites/ (`/nordwave/`, `/ledgerleaf/`) | 8080 |
| mailpit | smtp mailpit:1025, UI :8025 | 8025 |

## 2. MCP servers (FastMCP 2.x, streamable HTTP at path `/mcp`)

- Auth: every request must carry `Authorization: Bearer $MCP_SHARED_TOKEN` (if env `MCP_SHARED_TOKEN` is empty, auth is disabled). A `GET /health` route returns `{"ok": true}` without auth.
- Every tool returns a **dict** with the top-level key shown (never a bare list).

### mcp-webscraper (port 9001)
| Tool | Args | Returns |
|---|---|---|
| `scrape_url` | `url: str` | `{"url","title","markdown","links":[str]}` |
| `crawl_site` | `url: str, max_pages: int = 15, same_domain: bool = True` | `{"pages":[{"url","title","markdown"}]}` |

### mcp-docparser (port 9002)
| Tool | Args | Returns |
|---|---|---|
| `parse_document` | `file_url: str, mime_type: str = "", filename: str = ""` | `{"text": str, "tables": [str(markdown)], "pages": int, "meta": {...}}` |

Supports pdf, docx, xlsx/xls/csv, txt/md/html, images (tesseract OCR; OpenAI vision fallback if OCR text < 40 chars and `OPENAI_API_KEY` set), audio/video (ffmpeg → OpenAI transcription `OPENAI_TRANSCRIBE_MODEL`).

### mcp-signals (port 9003)
`Hit = {"source": "web|news|x|linkedin|reddit|facebook|jobs", "url", "title", "snippet", "author": str|null, "published_at": ISO|null, "company": str|null}`

| Tool | Args | Returns |
|---|---|---|
| `search_web` | `query, since_days=30, limit=10` | `{"hits":[Hit]}` |
| `search_news` | `query, since_days=30, limit=10` | `{"hits":[Hit]}` |
| `search_social` | `platform: x\|linkedin\|reddit\|facebook, query, since_days=30, limit=10` | `{"hits":[Hit]}` |
| `search_jobs` | `query, location: str\|None=None, since_days=30, limit=10` | `{"hits":[Hit]}` |
| `enrich_company` | `name: str\|None=None, domain: str\|None=None` | `{"company": {"name","domain","industry","employees":int,"hq","linkedin_url","description"} \| null}` |
| `find_contacts` | `company: str\|None=None, domain: str\|None=None, titles: list[str]=[]` | `{"contacts":[{"name","title","email","phone","linkedin_url"}]}` |

`PROVIDER_MODE=fixture` → served from `mcp/signals/fixtures/*.json`; `live` → Tavily/Exa/X/Reddit/Hunter when keys exist (empty hits otherwise).

## 3. REST API (`/api/v1`, JWT bearer except auth + health)

Errors: `{"detail": str}` with 4xx/5xx.

### Auth
- `POST /auth/register` `{email, password, name}` → `Token`
- `POST /auth/login` `{email, password}` → `Token`
- `GET /auth/me` → `User`
- `Token = {access_token, token_type: "bearer", user: User}`; `User = {id, email, name}`

### Workspaces & company
- `GET /workspaces` → `[Workspace]`; `Workspace = {id, name, created_at, company: CompanySummary|null}`
- `POST /workspaces` `{name}` → `Workspace`
- `CompanySummary = {id, name, website_url, status, lead_count, signal_count, updated_at}`
- `POST /workspaces/{wid}/company` `{name, website_url}` → `Company` (does NOT start pipeline)
- `GET /companies/{cid}` → `Company = {id, workspace_id, name, website_url, status, status_detail: {step, progress, message, error}, profile: CompanyProfile|null, profile_edited, updated_at}`
- `status` ∈ `draft | ingesting | profiling | generating_icp | generating_signals | finding_leads | leads_ready | failed`
- `GET /companies/{cid}/status` → `{status, step, progress (0-100), message, error, steps: [{key, label, state: "pending|running|done|failed"}]}` with step keys `ingest, profile, icp, signals, leads`
- `POST /companies/{cid}/pipeline` `{from_step: "ingest"|"profile"|"icp"|"signals"|"leads", only?: bool=false}` → `{job_id}` (runs from_step to end unless `only`)

### Sources
- `POST /companies/{cid}/sources` multipart field `files` (multiple) → `[Source]`
- `GET /companies/{cid}/sources` → `[Source]`
- `Source = {id, kind: website|pdf|docx|xlsx|csv|image|video|audio|text|other, uri, filename, mime, status: pending|parsed|failed, error, chars, created_at}`

### Profile / ICP / Signals
- `GET /companies/{cid}/profile` → `CompanyProfile`; `PUT` same body → `CompanyProfile` (sets profile_edited=true)
- `CompanyProfile = {name, one_liner, description, industry, sub_industries[], products: [{name, description, category, key_features[]}], value_propositions[], differentiators[], target_markets[], geographies[], customer_examples[], competitors[], pricing_model: str|null, company_size_hint: str|null, source_citations: [{source_id, claim, quote}]}`
- `GET /companies/{cid}/icp` → `ICPRecord` (404 if none); `GET /companies/{cid}/icp/versions` → `[ICPRecord]`; `PUT /companies/{cid}/icp` `{data: ICP}` → `ICPRecord` (new version, origin=user)
- `POST /companies/{cid}/icp/regenerate` → `{job_id}`
- `ICPRecord = {id, version, is_active, origin: ai|user, data: ICP, created_at}`
- `ICP = {summary, firmographics: {industries[], employee_range, revenue_range, geographies[], tech_stack[]}, personas: [{title, seniority, department, goals[], pains[]}], pain_points[], buying_triggers[], keywords[], negative_keywords[], exclusions[], disqualifiers[]}`
- `GET /companies/{cid}/signals` → `[Signal]`; `POST /companies/{cid}/signals/regenerate` → `{job_id}`
- `PATCH /signals/{sid}` partial `{name, description, channels, queries, weight, lookback_days, is_active}` → `Signal`
- `Signal = {id, name, type, description, channels: [web|news|x|linkedin|reddit|facebook|jobs], queries: [str], weight: 0..1, lookback_days, is_active, created_at}`
- signal `type` ∈ `hiring, funding, expansion, leadership_change, tech_adoption, pain_post, rfp_tender, competitor_mention, event_participation`

### Runs & leads
- `POST /companies/{cid}/runs` → `{job_id}`; `GET /companies/{cid}/runs` → `[Run]`; `Run = {id, status: running|completed|failed, started_at, finished_at, stats: {queries, mcp_calls, hits, new_hits, relevant, new_leads, updated_leads}, error}`
- `GET /companies/{cid}/leads?status=&signal_type=&channel=&min_score=&q=&page=1&page_size=20` → `{items: [Lead], total, page, page_size}` sorted by score desc, last_signal_at desc
- `Lead = {id, org_name, domain, industry, employees, hq, description, contact_name, contact_title, email, phone, linkedin_url, fit_score, intent_score, score, score_breakdown: {fit_reasons[], intent_reasons[]}, status: new|contacted|qualified|disqualified, first_seen_at, last_signal_at, signals: [LeadSignal]}`
- `LeadSignal = {id, signal_id, signal_name, signal_type, source, url, title, snippet, published_at, confidence, explanation}`
- `GET /leads/{lid}` → `Lead & {activities: [Activity]}`; `PATCH /leads/{lid}` `{status}` → `Lead`
- `POST /leads/{lid}/draft` `{channel: email|whatsapp}` → `{subject: str|null, body}`
- `POST /leads/{lid}/actions/email` `{to, subject, body}` → `Activity`
- `POST /leads/{lid}/actions/call` `{outcome: connected|voicemail|no_answer|wrong_number, notes}` → `Activity`
- `POST /leads/{lid}/actions/whatsapp` `{phone, message}` → `{activity: Activity, url}`
- `POST /leads/{lid}/notes` `{text}` → `Activity`
- `Activity = {id, channel: email|call|whatsapp|note|status, payload: {}, status, created_at, user_name}`

### Misc
- `GET /mcp/servers` → `[{name, url, capabilities[], enabled, healthy, tools[], error}]`
- `GET /health` → `{ok, db, redis}`

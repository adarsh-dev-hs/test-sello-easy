// In-browser implementation of the SelloQ REST API (docs/CONTRACTS.md §3), used when VITE_DEMO_MODE=true.
// Seeded with a snapshot of two real pipeline runs; pipelines/actions are simulated and state lives in
// this browser's localStorage only. No AI or MCP calls happen in demo mode.

import { ApiError } from "../api/client";
import type {
  Activity, Company, CompanyProfile, ICP, ICPRecord, Lead, LeadDetail, McpServer, PipelineStatus,
  Run, Signal, Source, SourceKind, StepKey, User, Workspace,
} from "../api/types";
import snapshotJson from "./snapshot.json";

type Query = Record<string, string | number | boolean | undefined | null>;
type Opts = { body?: unknown; query?: Query; form?: FormData };

interface Job { steps: StepKey[]; started: number; only: boolean }
interface WS {
  workspace: { id: string; name: string; created_at: string };
  company: Company | null;
  sources: Source[];
  icp_versions: ICPRecord[];
  signals: Signal[];
  runs: Run[];
  leads: LeadDetail[];
  completed: StepKey[];
  job: Job | null;
  template?: string;
}
interface DB { version: number; user: User; workspaces: WS[] }

const STORAGE_KEY = "selloq.demo.v1";
const STEP_MS = 2500;
const STEPS: { key: StepKey; label: string; status: Company["status"] }[] = [
  { key: "ingest", label: "Reading website & documents", status: "ingesting" },
  { key: "profile", label: "Building company profile", status: "profiling" },
  { key: "icp", label: "Generating ICP", status: "generating_icp" },
  { key: "signals", label: "Creating signals", status: "generating_signals" },
  { key: "leads", label: "Finding leads", status: "finding_leads" },
];
const STEP_KEYS = STEPS.map((s) => s.key);

const now = () => new Date().toISOString();
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));

// ---------------------------------------------------------------------------------------------- seed

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/** Shift every timestamp so the snapshot always looks fresh (signals "3 days ago", not "3 months ago"). */
function shiftDates<T>(value: T, offsetMs: number): T {
  if (typeof value === "string" && ISO_RE.test(value)) {
    const t = Date.parse(value);
    return (Number.isNaN(t) ? value : new Date(t + offsetMs).toISOString()) as T;
  }
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, offsetMs)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = shiftDates(v, offsetMs);
    return out as T;
  }
  return value;
}

function seed(): DB {
  const snap = clone(snapshotJson) as unknown as { workspaces: Omit<WS, "completed" | "job">[] };
  const latest = Math.max(
    ...snap.workspaces.flatMap((w) => w.runs.map((r) => Date.parse(r.finished_at || r.started_at))),
  );
  const offset = Number.isFinite(latest) ? Date.now() - latest - 60 * 60 * 1000 : 0;
  const workspaces = snap.workspaces.map((w) => ({
    ...shiftDates(w, offset),
    completed: [...STEP_KEYS],
    job: null,
  })) as WS[];
  return { version: 1, user: { id: "demo-user", email: "demo@selloq.local", name: "Demo Admin" }, workspaces };
}

let db: DB | null = null;

function load(): DB {
  if (db) return db;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DB;
      if (parsed?.version === 1 && Array.isArray(parsed.workspaces)) return (db = parsed);
    }
  } catch { /* storage unavailable or corrupt → reseed */ }
  return (db = seed());
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); } catch { /* ignore quota / private mode */ }
}

export function resetDemoData() {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  db = null;
}

// ------------------------------------------------------------------------------------- simulation

function templateFor(ws: WS): WS {
  const all = load().workspaces;
  const finance = /financ|invoice|account|ledger|payable|erp|billing|pay|expense|procure|spend/i;
  const text = [ws.company?.name, ws.company?.website_url, ...ws.sources.map((s) => s.filename)].join(" ");
  const name = finance.test(text) ? "LedgerLeaf" : "NordWave Networks";
  return all.find((w) => w.workspace.name === name && w.company?.profile) || all.find((w) => w.company?.profile)!;
}

/** Fill a brand-new company from a sample workspace, clearly labelled as sample data. */
function populateFromTemplate(ws: WS) {
  const t = templateFor(ws);
  const c = ws.company!;
  ws.template = t.workspace.name;
  const p = clone(t.company!.profile!) as CompanyProfile;
  p.name = c.name;
  p.one_liner = `Demo-mode sample profile for ${c.name}`;
  p.description =
    `This is sample data copied from the "${t.workspace.name}" demo workspace, because demo mode runs ` +
    `without the SelloQ backend. Connect the backend (VITE_DEMO_MODE=false) to have ${c.website_url || "your website"} ` +
    `and documents analysed by the real AI + MCP pipeline.\n\n${p.description}`;
  p.source_citations = [];
  c.profile = p;
  ws.icp_versions = t.icp_versions.filter((r) => r.is_active).map((r) => ({ ...clone(r), id: uid(), version: 1, created_at: now() }));
  const sigMap = new Map<string, string>();
  ws.signals = t.signals.map((s) => {
    const id = uid();
    sigMap.set(s.id, id);
    return { ...clone(s), id, created_at: now() };
  });
  ws.leads = t.leads.map((l) => ({
    ...clone(l),
    id: uid(),
    status: "new" as const,
    activities: [],
    signals: l.signals.map((ls) => ({ ...clone(ls), id: uid(), signal_id: ls.signal_id ? sigMap.get(ls.signal_id) ?? null : null })),
  }));
}

function finishStep(ws: WS, step: StepKey) {
  const c = ws.company!;
  if (step === "ingest") {
    if (c.website_url && !ws.sources.some((s) => s.kind === "website")) {
      ws.sources.unshift(mkSource("website", c.website_url, c.website_url, "text/html", 2400));
    }
    ws.sources.forEach((s) => { if (s.status === "pending") { s.status = "parsed"; s.chars = s.chars || 1800; } });
  }
  if (step === "profile" && !c.profile) populateFromTemplate(ws);
  if (step === "icp" && ws.icp_versions.length) {
    const active = ws.icp_versions.find((r) => r.is_active) || ws.icp_versions[0];
    ws.icp_versions.forEach((r) => (r.is_active = false));
    const version = Math.max(...ws.icp_versions.map((r) => r.version)) + 1;
    ws.icp_versions.unshift({ ...clone(active), id: uid(), version, is_active: true, origin: "ai", created_at: now() });
  }
  if (step === "leads") {
    const active = ws.signals.filter((s) => s.is_active);
    const queries = active.reduce((n, s) => n + s.queries.length, 0);
    const calls = active.reduce((n, s) => n + s.queries.length * s.channels.length, 0);
    const first = !ws.runs.length;
    ws.runs.unshift({
      id: uid(),
      status: "completed",
      started_at: new Date(Date.now() - STEP_MS).toISOString(),
      finished_at: now(),
      stats: {
        queries, mcp_calls: calls, hits: calls * 4, new_hits: first ? ws.leads.length * 3 : 0,
        relevant: first ? ws.leads.length * 2 : 0, new_leads: first ? ws.leads.length : 0, updated_leads: 0,
      },
      error: null,
    });
  }
  c.updated_at = now();
}

/** Advance simulated jobs based on wall-clock time. */
function tick() {
  const d = load();
  let changed = false;
  for (const ws of d.workspaces) {
    const job = ws.job;
    if (!job || !ws.company) continue;
    const doneCount = Math.min(job.steps.length, Math.floor((Date.now() - job.started) / STEP_MS));
    for (const step of job.steps.slice(0, doneCount)) {
      if (!ws.completed.includes(step)) {
        finishStep(ws, step);
        ws.completed.push(step);
        changed = true;
      }
    }
    if (doneCount >= job.steps.length) {
      ws.job = null;
      ws.company.status = ws.completed.includes("leads") ? "leads_ready" : "draft";
      ws.company.status_detail = { step: null, progress: 100, message: "Done (simulated in demo mode)", error: null };
      changed = true;
    } else {
      const step = job.steps[doneCount];
      const meta = STEPS.find((s) => s.key === step)!;
      const progress = Math.round((((Date.now() - job.started) % STEP_MS) / STEP_MS) * 100);
      ws.company.status = meta.status;
      ws.company.status_detail = { step, progress, message: `${meta.label} (simulated)`, error: null };
    }
  }
  if (changed) save();
}

function startJob(ws: WS, from: StepKey, only: boolean) {
  if (ws.job) throw new ApiError(409, "A pipeline is already running for this company");
  const start = STEP_KEYS.indexOf(from);
  const steps = only ? [from] : STEP_KEYS.slice(start);
  ws.completed = ws.completed.filter((k) => !steps.includes(k));
  ws.job = { steps, started: Date.now(), only };
  tick();
  save();
  return { job_id: `demo:${ws.company!.id}:${Date.now()}` };
}

// ------------------------------------------------------------------------------------ serializers

function mkSource(kind: SourceKind, uri: string, filename: string, mime: string, chars: number | null): Source {
  return { id: uid(), kind, uri, filename, mime, status: "pending", error: null, chars, created_at: now() };
}

function kindFor(name: string): SourceKind {
  const ext = name.toLowerCase().split(".").pop() || "";
  const map: Record<string, SourceKind> = {
    pdf: "pdf", docx: "docx", doc: "docx", xlsx: "xlsx", xls: "xlsx", csv: "csv", png: "image", jpg: "image",
    jpeg: "image", webp: "image", gif: "image", mp4: "video", mov: "video", webm: "video", mp3: "audio",
    wav: "audio", m4a: "audio", txt: "text", md: "text", html: "text",
  };
  return map[ext] || "other";
}

function workspaceOut(ws: WS): Workspace {
  const c = ws.company;
  return {
    ...ws.workspace,
    company: c && {
      id: c.id, name: c.name, website_url: c.website_url, status: c.status,
      lead_count: ws.leads.length, signal_count: ws.signals.length, updated_at: c.updated_at,
    },
  };
}

function statusOut(ws: WS): PipelineStatus {
  const c = ws.company!;
  const d = c.status_detail || { step: null, progress: 0, message: null, error: null };
  const running = ws.job ? d.step : null;
  return {
    status: c.status, step: d.step, progress: d.progress ?? 0, message: d.message, error: d.error,
    steps: STEPS.map((s) => ({
      key: s.key, label: s.label,
      state: s.key === running ? "running" : ws.completed.includes(s.key) ? "done" : "pending",
    })),
  };
}

function leadOut(l: LeadDetail): Lead {
  const { activities: _a, ...lead } = l;
  return lead;
}

// ---------------------------------------------------------------------------------------- lookups

function wsByCompany(cid: string): WS {
  const ws = load().workspaces.find((w) => w.company?.id === cid);
  if (!ws) throw new ApiError(404, "Company not found");
  return ws;
}
function wsById(wid: string): WS {
  const ws = load().workspaces.find((w) => w.workspace.id === wid);
  if (!ws) throw new ApiError(404, "Workspace not found");
  return ws;
}
function findLead(lid: string): [WS, LeadDetail] {
  for (const ws of load().workspaces) {
    const l = ws.leads.find((x) => x.id === lid);
    if (l) return [ws, l];
  }
  throw new ApiError(404, "Lead not found");
}
function findSignal(sid: string): Signal {
  for (const ws of load().workspaces) {
    const s = ws.signals.find((x) => x.id === sid);
    if (s) return s;
  }
  throw new ApiError(404, "Signal not found");
}

function logActivity(l: LeadDetail, channel: Activity["channel"], payload: Record<string, unknown>): Activity {
  const act: Activity = { id: uid(), channel, payload, status: "done", created_at: now(), user_name: load().user.name };
  l.activities.unshift(act);
  if (["email", "call", "whatsapp"].includes(channel) && l.status === "new") l.status = "contacted";
  save();
  return act;
}

function drafts(ws: WS, l: LeadDetail, channel: "email" | "whatsapp") {
  const p = ws.company?.profile;
  const seller = p?.name || ws.company?.name || "our team";
  const first = l.contact_name?.split(" ")[0];
  const ev = l.signals[0];
  const opener: Record<string, string> = {
    pain_post: "I came across a recent post from your team",
    hiring: `I noticed ${l.org_name} is hiring`,
    leadership_change: `I saw the recent leadership news at ${l.org_name}`,
    expansion: `I saw ${l.org_name}'s expansion news`,
  };
  const lead = (ev?.signal_type && opener[ev.signal_type]) || `I came across ${l.org_name}'s recent news`;
  const evidence = ev?.title ? `${lead} ("${ev.title}")` : lead;
  const product = p?.products?.[0]?.name;
  if (channel === "whatsapp") {
    return {
      subject: null,
      body: `Hi ${first || "there"}, ${evidence}. At ${seller} we help teams like yours${product ? ` with ${product}` : ""}. Open to a quick 15-min chat this week?`,
    };
  }
  const pain = ws.icp_versions.find((r) => r.is_active)?.data.pain_points?.[0];
  return {
    subject: `${l.org_name} × ${seller}`.slice(0, 60),
    body:
      `Hi ${first || "there"},\n\n${evidence}.\n\n` +
      `${pain ? `Teams in a similar position often tell us about ${pain.charAt(0).toLowerCase()}${pain.slice(1)}. ` : ""}` +
      `${p?.one_liner || seller}${product ? ` — ${product} is usually where we start` : ""}.\n\n` +
      `Would a 20-minute call next week be useful to compare notes?\n\nBest,\n${seller}\n\n` +
      `(Draft generated from a template — demo mode has no AI backend.)`,
  };
}

const MCP_SERVERS: McpServer[] = [
  { name: "webscraper", url: "demo (simulated)", capabilities: ["scrape"], enabled: true, healthy: true, tools: ["scrape_url", "crawl_site"], error: null },
  { name: "docparser", url: "demo (simulated)", capabilities: ["doc_parse"], enabled: true, healthy: true, tools: ["parse_document"], error: null },
  {
    name: "signals", url: "demo (simulated)", capabilities: ["web_search", "news_search", "social_search", "job_search", "enrich"],
    enabled: true, healthy: true, tools: ["search_web", "search_news", "search_social", "search_jobs", "enrich_company", "find_contacts"], error: null,
  },
];

// ------------------------------------------------------------------------------------------ router

type Handler = (m: RegExpMatchArray, o: Opts) => unknown;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, pattern: string, h: Handler) =>
  routes.push([method, new RegExp(`^${pattern.replace(/:[a-z]+/g, "([^/]+)")}$`), h]);
const body = <T,>(o: Opts) => (o.body || {}) as T;

const token = () => ({ access_token: "demo-token", token_type: "bearer" as const, user: load().user });
on("POST", "/auth/login", (_m, o) => {
  const { email } = body<{ email?: string }>(o);
  if (email) load().user.email = email;
  save();
  return token();
});
on("POST", "/auth/register", (_m, o) => {
  const { email, name } = body<{ email?: string; name?: string }>(o);
  const u = load().user;
  if (email) u.email = email;
  if (name) u.name = name;
  save();
  return token();
});
on("GET", "/auth/me", () => load().user);

on("GET", "/workspaces", () => load().workspaces.map(workspaceOut));
on("POST", "/workspaces", (_m, o) => {
  const ws: WS = {
    workspace: { id: uid(), name: body<{ name?: string }>(o).name?.trim() || "Workspace", created_at: now() },
    company: null, sources: [], icp_versions: [], signals: [], runs: [], leads: [], completed: [], job: null,
  };
  load().workspaces.push(ws);
  save();
  return workspaceOut(ws);
});
on("POST", "/workspaces/:wid/company", (m, o) => {
  const ws = wsById(m[1]);
  if (ws.company) throw new ApiError(409, "This workspace already has a company");
  const b = body<{ name: string; website_url?: string }>(o);
  let url = (b.website_url || "").trim() || null;
  if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
  ws.company = {
    id: uid(), workspace_id: ws.workspace.id, name: b.name.trim(), website_url: url, status: "draft",
    status_detail: { step: null, progress: 0, message: null, error: null }, profile: null, profile_edited: false, updated_at: now(),
  };
  save();
  return ws.company;
});
on("GET", "/companies/:cid", (m) => wsByCompany(m[1]).company);
on("GET", "/companies/:cid/status", (m) => statusOut(wsByCompany(m[1])));
on("POST", "/companies/:cid/pipeline", (m, o) => {
  const b = body<{ from_step?: StepKey; only?: boolean }>(o);
  return startJob(wsByCompany(m[1]), b.from_step || "ingest", !!b.only);
});

on("GET", "/companies/:cid/sources", (m) => wsByCompany(m[1]).sources);
on("POST", "/companies/:cid/sources", (m, o) => {
  const ws = wsByCompany(m[1]);
  const files = (o.form?.getAll("files") || []).filter((f): f is File => f instanceof File);
  const created = files.map((f) => mkSource(kindFor(f.name), `upload://${f.name}`, f.name, f.type || "application/octet-stream", null));
  ws.sources.push(...created);
  save();
  return created;
});

on("GET", "/companies/:cid/profile", (m) => {
  const p = wsByCompany(m[1]).company?.profile;
  if (!p) throw new ApiError(404, "Profile not built yet");
  return p;
});
on("PUT", "/companies/:cid/profile", (m, o) => {
  const c = wsByCompany(m[1]).company!;
  c.profile = body<CompanyProfile>(o);
  c.profile_edited = true;
  save();
  return c.profile;
});

on("GET", "/companies/:cid/icp", (m) => {
  const rec = wsByCompany(m[1]).icp_versions.find((r) => r.is_active);
  if (!rec) throw new ApiError(404, "ICP not generated yet");
  return rec;
});
on("GET", "/companies/:cid/icp/versions", (m) => [...wsByCompany(m[1]).icp_versions].sort((a, b) => b.version - a.version));
on("PUT", "/companies/:cid/icp", (m, o) => {
  const ws = wsByCompany(m[1]);
  const version = Math.max(0, ...ws.icp_versions.map((r) => r.version)) + 1;
  ws.icp_versions.forEach((r) => (r.is_active = false));
  const rec: ICPRecord = { id: uid(), version, is_active: true, origin: "user", data: body<{ data: ICP }>(o).data, created_at: now() };
  ws.icp_versions.unshift(rec);
  save();
  return rec;
});
on("POST", "/companies/:cid/icp/regenerate", (m) => startJob(wsByCompany(m[1]), "icp", true));

on("GET", "/companies/:cid/signals", (m) => [...wsByCompany(m[1]).signals].sort((a, b) => b.weight - a.weight));
on("POST", "/companies/:cid/signals/regenerate", (m) => startJob(wsByCompany(m[1]), "signals", true));
on("PATCH", "/signals/:sid", (_m, o) => {
  const s = findSignal(_m[1]);
  const patch = body<Partial<Signal>>(o);
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && v !== null) (s as unknown as Record<string, unknown>)[k] = v;
  if (patch.queries) s.queries = patch.queries.map((q) => q.trim()).filter(Boolean);
  save();
  return s;
});

on("POST", "/companies/:cid/runs", (m) => startJob(wsByCompany(m[1]), "leads", true));
on("GET", "/companies/:cid/runs", (m) => wsByCompany(m[1]).runs);

on("GET", "/companies/:cid/leads", (m, o) => {
  const q = o.query || {};
  const ws = wsByCompany(m[1]);
  const text = String(q.q || "").toLowerCase();
  const items = ws.leads
    .filter((l) => !q.status || l.status === q.status)
    .filter((l) => q.min_score == null || q.min_score === "" || (l.score ?? 0) >= Number(q.min_score))
    .filter((l) => !q.signal_type || l.signals.some((s) => s.signal_type === q.signal_type))
    .filter((l) => !q.channel || l.signals.some((s) => s.source === q.channel))
    .filter((l) => !text || [l.org_name, l.contact_name, l.domain, l.industry].some((v) => v?.toLowerCase().includes(text)))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || String(b.last_signal_at).localeCompare(String(a.last_signal_at)));
  const page = Math.max(1, Number(q.page) || 1);
  const size = Math.min(100, Math.max(1, Number(q.page_size) || 20));
  return { items: items.slice((page - 1) * size, page * size).map(leadOut), total: items.length, page, page_size: size };
});
on("GET", "/leads/:lid", (m) => findLead(m[1])[1]);
on("PATCH", "/leads/:lid", (m, o) => {
  const [, l] = findLead(m[1]);
  const status = body<{ status: Lead["status"] }>(o).status;
  const from = l.status;
  l.status = status;
  logActivity(l, "status", { from, to: status });
  return leadOut(l);
});
on("POST", "/leads/:lid/draft", (m, o) => {
  const [ws, l] = findLead(m[1]);
  return drafts(ws, l, body<{ channel: "email" | "whatsapp" }>(o).channel);
});
on("POST", "/leads/:lid/actions/email", (m, o) => {
  const [, l] = findLead(m[1]);
  return logActivity(l, "email", { ...body<Record<string, unknown>>(o), note: "demo mode — not actually sent" });
});
on("POST", "/leads/:lid/actions/call", (m, o) => {
  const [, l] = findLead(m[1]);
  return logActivity(l, "call", { ...body<Record<string, unknown>>(o), phone: l.phone });
});
on("POST", "/leads/:lid/actions/whatsapp", (m, o) => {
  const [, l] = findLead(m[1]);
  const b = body<{ phone: string; message: string }>(o);
  const digits = (b.phone || "").replace(/\D/g, "");
  if (digits.length < 7) throw new ApiError(422, "Invalid phone number");
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(b.message || "")}`;
  return { activity: logActivity(l, "whatsapp", { ...b, url }), url };
});
on("POST", "/leads/:lid/notes", (m, o) => {
  const [, l] = findLead(m[1]);
  return logActivity(l, "note", { text: body<{ text: string }>(o).text });
});

on("GET", "/mcp/servers", () => MCP_SERVERS);
on("GET", "/health", () => ({ ok: true, db: true, redis: true }));

export async function mockRequest<T>(method: string, path: string, opts: Opts = {}): Promise<T> {
  await delay();
  tick();
  const clean = path.split("?")[0];
  for (const [m, re, h] of routes) {
    if (m !== method.toUpperCase()) continue;
    const match = clean.match(re);
    if (match) return clone(h(match, opts)) as T;
  }
  throw new ApiError(404, `Demo mode: ${method} ${clean} is not available`);
}

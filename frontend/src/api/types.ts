// Types mirror docs/CONTRACTS.md §3 (REST API). AI-generated fields may be null/empty at runtime.

export type ID = string;
export type ISODate = string;

export interface User { id: ID; email: string; name: string }
export interface Token { access_token: string; token_type: "bearer"; user: User }

export type CompanyStatus =
  | "draft" | "ingesting" | "profiling" | "generating_icp" | "generating_signals"
  | "finding_leads" | "leads_ready" | "failed";

export interface CompanySummary {
  id: ID; name: string; website_url: string | null; status: CompanyStatus;
  lead_count: number; signal_count: number; updated_at: ISODate;
}
export interface Workspace { id: ID; name: string; created_at: ISODate; company: CompanySummary | null }

export interface StatusDetail { step: string | null; progress: number | null; message: string | null; error: string | null }

export interface Product { name: string; description: string; category: string; key_features: string[] }
export interface Citation { source_id: string; claim: string; quote: string }
export interface CompanyProfile {
  name: string; one_liner: string; description: string; industry: string;
  sub_industries: string[]; products: Product[];
  value_propositions: string[]; differentiators: string[]; target_markets: string[];
  geographies: string[]; customer_examples: string[]; competitors: string[];
  pricing_model: string | null; company_size_hint: string | null;
  source_citations: Citation[];
}

export interface Company {
  id: ID; workspace_id: ID; name: string; website_url: string | null; status: CompanyStatus;
  status_detail: StatusDetail | null; profile: CompanyProfile | null; profile_edited: boolean; updated_at: ISODate;
}

export type StepKey = "ingest" | "profile" | "icp" | "signals" | "leads";
export type StepState = "pending" | "running" | "done" | "failed";
export interface PipelineStatus {
  status: CompanyStatus; step: string | null; progress: number; message: string | null; error: string | null;
  steps: { key: StepKey; label: string; state: StepState }[];
}

export type SourceKind = "website" | "pdf" | "docx" | "xlsx" | "csv" | "image" | "video" | "audio" | "text" | "other";
export interface Source {
  id: ID; kind: SourceKind; uri: string | null; filename: string | null; mime: string | null;
  status: "pending" | "parsed" | "failed"; error: string | null; chars: number | null; created_at: ISODate;
}

export interface Firmographics {
  industries: string[]; employee_range: string; revenue_range: string; geographies: string[]; tech_stack: string[];
}
export interface Persona { title: string; seniority: string; department: string; goals: string[]; pains: string[] }
export interface ICP {
  summary: string; firmographics: Firmographics; personas: Persona[];
  pain_points: string[]; buying_triggers: string[]; keywords: string[];
  negative_keywords: string[]; exclusions: string[]; disqualifiers: string[];
}
export interface ICPRecord { id: ID; version: number; is_active: boolean; origin: "ai" | "user"; data: ICP; created_at: ISODate }

export type Channel = "web" | "news" | "x" | "linkedin" | "reddit" | "facebook" | "jobs";
export const CHANNELS: Channel[] = ["web", "news", "x", "linkedin", "reddit", "facebook", "jobs"];
export type SignalType =
  | "hiring" | "funding" | "expansion" | "leadership_change" | "tech_adoption"
  | "pain_post" | "rfp_tender" | "competitor_mention" | "event_participation";
export const SIGNAL_TYPES: SignalType[] = [
  "hiring", "funding", "expansion", "leadership_change", "tech_adoption",
  "pain_post", "rfp_tender", "competitor_mention", "event_participation",
];

export interface Signal {
  id: ID; name: string; type: SignalType; description: string; channels: Channel[]; queries: string[];
  weight: number; lookback_days: number; is_active: boolean; created_at: ISODate;
}
export type SignalPatch = Partial<Pick<Signal, "name" | "description" | "channels" | "queries" | "weight" | "lookback_days" | "is_active">>;

export interface RunStats {
  queries?: number; mcp_calls?: number; hits?: number; new_hits?: number; relevant?: number;
  new_leads?: number; updated_leads?: number;
}
export interface Run {
  id: ID; status: "running" | "completed" | "failed"; started_at: ISODate; finished_at: ISODate | null;
  stats: RunStats | null; error: string | null;
}

export type LeadStatus = "new" | "contacted" | "qualified" | "disqualified";
export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "disqualified"];

export interface LeadSignal {
  id: ID; signal_id: ID | null; signal_name: string | null; signal_type: string | null; source: string | null;
  url: string | null; title: string | null; snippet: string | null; published_at: ISODate | null;
  confidence: number | null; explanation: string | null;
}
export interface Lead {
  id: ID; org_name: string; domain: string | null; industry: string | null; employees: number | null;
  hq: string | null; description: string | null; contact_name: string | null; contact_title: string | null;
  email: string | null; phone: string | null; linkedin_url: string | null;
  fit_score: number | null; intent_score: number | null; score: number | null;
  score_breakdown: { fit_reasons?: string[]; intent_reasons?: string[] } | null;
  status: LeadStatus; first_seen_at: ISODate | null; last_signal_at: ISODate | null; signals: LeadSignal[];
}
export type ActivityChannel = "email" | "call" | "whatsapp" | "note" | "status";
export interface Activity {
  id: ID; channel: ActivityChannel; payload: Record<string, unknown> | null; status: string | null;
  created_at: ISODate; user_name: string | null;
}
export interface LeadDetail extends Lead { activities: Activity[] }
export interface Page<T> { items: T[]; total: number; page: number; page_size: number }

export interface LeadFilters {
  status?: string; signal_type?: string; channel?: string; min_score?: number; q?: string; page?: number; page_size?: number;
}

export type CallOutcome = "connected" | "voicemail" | "no_answer" | "wrong_number";

export interface McpServer {
  name: string; url: string; capabilities: string[]; enabled: boolean; healthy: boolean | null;
  tools: (string | { name: string; description?: string })[]; error: string | null;
}

export interface JobRef { job_id: string }

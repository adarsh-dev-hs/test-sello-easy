import { http, request } from "./client";
import type {
  Activity, CallOutcome, Company, CompanyProfile, ICP, ICPRecord, JobRef, Lead, LeadDetail, LeadFilters,
  LeadStatus, McpServer, Page, PipelineStatus, Run, Signal, SignalPatch, Source, StepKey, Token, User, Workspace,
} from "./types";

export * from "./types";
export { ApiError, errorMessage, tokenStore, API_BASE, DEMO_MODE } from "./client";

export const api = {
  // auth
  login: (email: string, password: string) => request<Token>("POST", "/auth/login", { body: { email, password }, auth: false }),
  register: (email: string, password: string, name: string) =>
    request<Token>("POST", "/auth/register", { body: { email, password, name }, auth: false }),
  me: () => http.get<User>("/auth/me"),

  // workspaces & company
  workspaces: () => http.get<Workspace[]>("/workspaces"),
  createWorkspace: (name: string) => http.post<Workspace>("/workspaces", { name }),
  createCompany: (wid: string, name: string, website_url: string) =>
    http.post<Company>(`/workspaces/${wid}/company`, { name, website_url }),
  company: (cid: string) => http.get<Company>(`/companies/${cid}`),
  status: (cid: string) => http.get<PipelineStatus>(`/companies/${cid}/status`),
  runPipeline: (cid: string, from_step: StepKey, only = false) =>
    http.post<JobRef>(`/companies/${cid}/pipeline`, { from_step, only }),

  // sources
  sources: (cid: string) => http.get<Source[]>(`/companies/${cid}/sources`),
  uploadSources: (cid: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    return http.upload<Source[]>(`/companies/${cid}/sources`, fd);
  },

  // profile
  profile: (cid: string) => http.get<CompanyProfile>(`/companies/${cid}/profile`),
  saveProfile: (cid: string, p: CompanyProfile) => http.put<CompanyProfile>(`/companies/${cid}/profile`, p),

  // icp
  icp: (cid: string) => http.get<ICPRecord>(`/companies/${cid}/icp`),
  icpVersions: (cid: string) => http.get<ICPRecord[]>(`/companies/${cid}/icp/versions`),
  saveIcp: (cid: string, data: ICP) => http.put<ICPRecord>(`/companies/${cid}/icp`, { data }),
  regenerateIcp: (cid: string) => http.post<JobRef>(`/companies/${cid}/icp/regenerate`),

  // signals
  signals: (cid: string) => http.get<Signal[]>(`/companies/${cid}/signals`),
  regenerateSignals: (cid: string) => http.post<JobRef>(`/companies/${cid}/signals/regenerate`),
  patchSignal: (sid: string, patch: SignalPatch) => http.patch<Signal>(`/signals/${sid}`, patch),

  // runs
  runs: (cid: string) => http.get<Run[]>(`/companies/${cid}/runs`),
  runNow: (cid: string) => http.post<JobRef>(`/companies/${cid}/runs`),

  // leads
  leads: (cid: string, f: LeadFilters) => http.get<Page<Lead>>(`/companies/${cid}/leads`, { ...f }),
  lead: (lid: string) => http.get<LeadDetail>(`/leads/${lid}`),
  setLeadStatus: (lid: string, status: LeadStatus) => http.patch<Lead>(`/leads/${lid}`, { status }),
  draft: (lid: string, channel: "email" | "whatsapp") =>
    http.post<{ subject: string | null; body: string }>(`/leads/${lid}/draft`, { channel }),
  sendEmail: (lid: string, body: { to: string; subject: string; body: string }) =>
    http.post<Activity>(`/leads/${lid}/actions/email`, body),
  logCall: (lid: string, body: { outcome: CallOutcome; notes: string }) =>
    http.post<Activity>(`/leads/${lid}/actions/call`, body),
  whatsapp: (lid: string, body: { phone: string; message: string }) =>
    http.post<{ activity: Activity; url: string }>(`/leads/${lid}/actions/whatsapp`, body),
  addNote: (lid: string, text: string) => http.post<Activity>(`/leads/${lid}/notes`, { text }),

  // misc
  mcpServers: () => http.get<McpServer[]>("/mcp/servers"),
};

import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useOutletContext, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ExternalLink, FileStack, History, Inbox, Radar, Target, UserSquare2 } from "lucide-react";
import type { Company, PipelineStatus } from "../../api";
import { qk, useCompany, useCompanyStatus, usePokeStatus } from "../../lib/hooks";
import { cn, hostOf, isRunningStatus } from "../../lib/utils";
import { ErrorState, LoadingBlock, ProgressBar } from "../../components/ui";
import { CompanyStatusBadge, InlineError, PipelineStepper } from "../../components/domain";

export interface CompanyCtx {
  cid: string;
  company: Company;
  status: PipelineStatus | undefined;
  running: boolean;
  poke: () => void;
}
export const useCompanyCtx = () => useOutletContext<CompanyCtx>();

const TABS = [
  { to: "", label: "Signal Feed", icon: Inbox, end: true },
  { to: "profile", label: "Profile", icon: UserSquare2 },
  { to: "icp", label: "ICP", icon: Target },
  { to: "signals", label: "Signals", icon: Radar },
  { to: "sources", label: "Sources", icon: FileStack },
  { to: "runs", label: "Runs", icon: History },
];

export default function CompanyLayout() {
  const { cid = "" } = useParams();
  const qc = useQueryClient();
  const companyQ = useCompany(cid);
  const statusQ = useCompanyStatus(cid);
  const poke = usePokeStatus(cid);
  const st = statusQ.data;
  const liveStatus = st?.status ?? companyQ.data?.status;
  const running = isRunningStatus(liveStatus);

  // When pipeline status changes, refresh everything derived from it.
  const prev = useRef<string | undefined>(undefined);
  const prevStep = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!st) return;
    const changed = prev.current !== undefined && (prev.current !== st.status || prevStep.current !== st.step);
    if (changed) {
      for (const k of [qk.company(cid), qk.profile(cid), qk.icp(cid), qk.icpVersions(cid), qk.signals(cid), qk.sources(cid), qk.runs(cid), qk.leads(cid), qk.workspaces]) {
        qc.invalidateQueries({ queryKey: k });
      }
      if (st.status === "leads_ready" && prev.current !== "leads_ready") toast.success("Pipeline finished — leads are ready");
      if (st.status === "failed" && prev.current !== "failed") toast.error(st.error || "Pipeline failed");
    }
    prev.current = st.status;
    prevStep.current = st.step;
  }, [st, cid, qc]);

  if (companyQ.isLoading) return <LoadingBlock label="Loading workspace…" />;
  if (companyQ.isError || !companyQ.data) return <ErrorState error={companyQ.error ?? "Company not found"} onRetry={() => companyQ.refetch()} />;
  const company = companyQ.data;
  const ctx: CompanyCtx = { cid, company, status: st, running, poke };

  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600"><ChevronLeft className="h-3.5 w-3.5" />All workspaces</Link>
      <div className="mb-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-violet-600 text-sm font-bold text-white">
              {(company.name || "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-semibold text-slate-900">{company.name}</h1>
              {company.website_url && (
                <a href={company.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-600">
                  {hostOf(company.website_url)}<ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
          <CompanyStatusBadge status={liveStatus} />
        </div>
        {running && (
          <div className="mt-4 space-y-3">
            <PipelineStepper status={st} compact />
            <ProgressBar value={st?.progress ?? 0} />
            <p className="text-xs text-slate-500">{st?.message || "Working…"} <span className="tabular-nums">· {Math.round(st?.progress ?? 0)}%</span></p>
          </div>
        )}
        {liveStatus === "failed" && (st?.error || company.status_detail?.error) && (
          <div className="mt-4"><InlineError>{st?.error || company.status_detail?.error}</InlineError></div>
        )}
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <nav className="-mx-4 flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-4 lg:mx-0 lg:w-48 lg:flex-col lg:overflow-visible lg:border-0 lg:px-0">
          {TABS.map((t) => (
            <NavLink
              key={t.label}
              to={t.to}
              end={t.end}
              className={({ isActive }) => cn(
                "flex items-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-medium transition-colors",
                "border-b-2 lg:rounded-lg lg:border-b-0",
                isActive ? "border-brand-600 text-brand-700 lg:bg-brand-50" : "border-transparent text-slate-600 hover:text-slate-900 lg:hover:bg-slate-100",
              )}
            >
              <t.icon className="h-4 w-4" />{t.label}
            </NavLink>
          ))}
        </nav>
        <section className="min-w-0 flex-1">
          <Outlet context={ctx} />
        </section>
      </div>
    </div>
  );
}

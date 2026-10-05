import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, ExternalLink, Plus, Radar, Users } from "lucide-react";
import { api, type Workspace } from "../api";
import { qk } from "../lib/hooks";
import { hostOf, isRunningStatus, timeAgo } from "../lib/utils";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "../components/ui";
import { CompanyStatusBadge } from "../components/domain";

function WorkspaceCard({ w }: { w: Workspace }) {
  const c = w.company;
  const to = c ? `/c/${c.id}` : `/onboarding?wid=${w.id}`;
  return (
    <Link to={to} className="group">
      <Card className="flex h-full flex-col p-5 transition-all group-hover:-translate-y-0.5 group-hover:border-brand-300 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-50 to-violet-100 text-sm font-semibold text-brand-700">
              {(c?.name || w.name || "?").slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-slate-900">{c?.name || w.name}</h3>
              <p className="truncate text-xs text-slate-500">{w.name}{c?.website_url ? ` · ${hostOf(c.website_url)}` : ""}</p>
            </div>
          </div>
          {c ? <CompanyStatusBadge status={c.status} /> : <span className="text-xs text-slate-400">Not set up</span>}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="flex items-center gap-1 text-xs text-slate-500"><Users className="h-3.5 w-3.5" />Leads</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">{c?.lead_count ?? 0}</p>
          </div>
          <div className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="flex items-center gap-1 text-xs text-slate-500"><Radar className="h-3.5 w-3.5" />Signals</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">{c?.signal_count ?? 0}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
          <span>{c ? `Updated ${timeAgo(c.updated_at)}` : "Finish onboarding →"}</span>
          {c && isRunningStatus(c.status) && <span className="text-brand-600">Pipeline running…</span>}
          {c?.website_url && (
            <span
              role="link"
              className="inline-flex items-center gap-1 hover:text-brand-600"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(c.website_url!, "_blank", "noopener"); }}
            >
              <ExternalLink className="h-3 w-3" />Site
            </span>
          )}
        </div>
      </Card>
    </Link>
  );
}

export default function WorkspacesPage() {
  const nav = useNavigate();
  const q = useQuery({
    queryKey: qk.workspaces,
    queryFn: api.workspaces,
    refetchInterval: (query) => (query.state.data?.some((w) => isRunningStatus(w.company?.status)) ? 4000 : false),
  });
  const list = Array.isArray(q.data) ? q.data : [];
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Workspaces</h1>
          <p className="mt-1 text-sm text-slate-500">Each workspace tracks one seller company and its signal-driven leads.</p>
        </div>
        <Button onClick={() => nav("/onboarding")}><Plus className="h-4 w-4" />New workspace</Button>
      </div>
      {q.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Building2 className="h-6 w-6" />}
          title="No workspaces yet"
          description="Create a workspace, add your company website and documents, and SelloQ will start finding leads."
          action={<Button onClick={() => nav("/onboarding")}><Plus className="h-4 w-4" />New workspace</Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((w) => <WorkspaceCard key={w.id} w={w} />)}
        </div>
      )}
    </div>
  );
}

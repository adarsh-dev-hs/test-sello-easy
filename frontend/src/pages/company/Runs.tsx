import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { History, Play } from "lucide-react";
import { api, errorMessage } from "../../api";
import { qk } from "../../lib/hooks";
import { arr, formatDate, timeAgo } from "../../lib/utils";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import { useCompanyCtx } from "./CompanyLayout";

function duration(a: string, b: string | null): string {
  if (!b) return "—";
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  if (!Number.isFinite(s)) return "—";
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const COLS = [
  ["queries", "Queries"], ["mcp_calls", "MCP calls"], ["hits", "Hits"], ["new_hits", "New hits"],
  ["relevant", "Relevant"], ["new_leads", "New leads"], ["updated_leads", "Updated"],
] as const;

export default function RunsPage() {
  const { cid, running, poke } = useCompanyCtx();
  const q = useQuery({
    queryKey: qk.runs(cid), queryFn: () => api.runs(cid),
    refetchInterval: (query) => (running || arr(query.state.data).some((r) => r.status === "running") ? 3000 : false),
  });
  const runNow = useMutation({ mutationFn: () => api.runNow(cid), onSuccess: () => { poke(); toast.success("Signal run started"); }, onError: (e) => toast.error(errorMessage(e)) });
  const runs = [...arr(q.data)].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Signal runs</h2>
          <p className="text-sm text-slate-500">Each run searches all active signals across MCP sources and qualifies hits into leads.</p>
        </div>
        <Button onClick={() => runNow.mutate()} loading={runNow.isPending} disabled={running}><Play className="h-4 w-4" />Run now</Button>
      </div>
      {q.isLoading ? <Skeleton className="h-64" /> : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : runs.length === 0 ? <EmptyState icon={<History className="h-6 w-6" />} title="No runs yet" description="Runs appear here after signals are executed." />
        : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Started</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Duration</th>
                  {COLS.map(([, l]) => <th key={l} className="px-3 py-2.5 text-right font-medium">{l}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-slate-50/60">
                    <td className="whitespace-nowrap px-5 py-3"><p className="text-slate-900">{formatDate(r.started_at)}</p><p className="text-xs text-slate-500">{timeAgo(r.started_at)}</p></td>
                    <td className="px-3 py-3">
                      <Badge tone={r.status === "completed" ? "green" : r.status === "failed" ? "red" : "amber"}>{r.status}</Badge>
                      {r.error && <p className="mt-1 max-w-[220px] text-xs text-rose-600">{r.error}</p>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums text-slate-600">{r.status === "running" ? "running…" : duration(r.started_at, r.finished_at)}</td>
                    {COLS.map(([k]) => <td key={k} className="px-3 py-3 text-right tabular-nums text-slate-700">{r.stats?.[k] ?? 0}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
    </div>
  );
}

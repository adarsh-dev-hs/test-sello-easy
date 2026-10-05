import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Activity, Play, Plus, Radar, RefreshCw, Save, Trash2 } from "lucide-react";
import { api, CHANNELS, errorMessage, type Channel, type Run, type Signal, type SignalPatch } from "../../api";
import { qk } from "../../lib/hooks";
import { arr, cn, timeAgo } from "../../lib/utils";
import { Badge, Button, Card, EmptyState, ErrorState, Input, Skeleton, Switch, Textarea } from "../../components/ui";
import { ChannelChip, SignalTypeBadge } from "../../components/domain";
import { useCompanyCtx } from "./CompanyLayout";

export function RunStatsStrip({ run }: { run: Run | undefined }) {
  if (!run) return null;
  const s = run.stats ?? {};
  const items: [string, number | undefined][] = [
    ["Queries", s.queries], ["MCP calls", s.mcp_calls], ["Hits", s.hits], ["New hits", s.new_hits],
    ["Relevant", s.relevant], ["New leads", s.new_leads], ["Updated leads", s.updated_leads],
  ];
  return (
    <Card className="p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <Activity className="h-4 w-4 text-brand-600" />
        <span className="font-medium text-slate-900">Latest run</span>
        <Badge tone={run.status === "completed" ? "green" : run.status === "failed" ? "red" : "amber"}>{run.status}</Badge>
        <span className="text-xs text-slate-500">{timeAgo(run.started_at)}</span>
        {run.error && <span className="truncate text-xs text-rose-600">{run.error}</span>}
      </div>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {items.map(([l, v]) => (
          <div key={l} className="rounded-lg bg-slate-50 px-3 py-2">
            <p className="text-[11px] text-slate-500">{l}</p>
            <p className="text-lg font-semibold tabular-nums text-slate-900">{v ?? 0}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

function SignalCard({ s, onPatch, saving }: { s: Signal; onPatch: (p: SignalPatch) => void; saving: boolean }) {
  const [queries, setQueries] = useState<string[]>(arr(s.queries));
  const [channels, setChannels] = useState<Channel[]>(arr(s.channels));
  const [weight, setWeight] = useState<number>(s.weight ?? 0.5);
  const [lookback, setLookback] = useState<number>(s.lookback_days ?? 30);
  const [description, setDescription] = useState(s.description ?? "");
  const reset = () => { setQueries(arr(s.queries)); setChannels(arr(s.channels)); setWeight(s.weight ?? 0.5); setLookback(s.lookback_days ?? 30); setDescription(s.description ?? ""); };
  useEffect(reset, [s]);
  const dirty =
    JSON.stringify(queries) !== JSON.stringify(arr(s.queries)) || JSON.stringify([...channels].sort()) !== JSON.stringify([...arr(s.channels)].sort()) ||
    weight !== s.weight || lookback !== s.lookback_days || description !== (s.description ?? "");

  return (
    <Card className={cn("p-5", !s.is_active && "bg-slate-50/70")}>
      <div className="flex items-start gap-3">
        <Switch checked={s.is_active} onChange={(v) => onPatch({ is_active: v })} label="Active" disabled={saving} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn("font-semibold", s.is_active ? "text-slate-900" : "text-slate-500")}>{s.name || "Untitled signal"}</h3>
            <SignalTypeBadge type={s.type} />
            {!s.is_active && <Badge tone="slate">Paused</Badge>}
          </div>
          <Textarea rows={2} className="mt-2 min-h-0 border-transparent bg-transparent px-0 shadow-none hover:border-slate-200 focus:px-3" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
        </div>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_260px]">
        <div>
          <p className="mb-1.5 text-xs font-medium text-slate-500">Search queries</p>
          <div className="space-y-1.5">
            {queries.map((q, i) => (
              <div key={i} className="flex gap-1.5">
                <Input value={q} onChange={(e) => setQueries(queries.map((x, j) => (j === i ? e.target.value : x)))} className="font-mono text-xs" />
                <Button size="icon" variant="ghost" className="h-9 w-9 text-slate-400 hover:text-rose-600" onClick={() => setQueries(queries.filter((_, j) => j !== i))} aria-label="Remove query"><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setQueries([...queries, ""])}><Plus className="h-3.5 w-3.5" />Add query</Button>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-slate-500">Channels</p>
            <div className="flex flex-wrap gap-1.5">
              {CHANNELS.map((c) => (
                <ChannelChip key={c} channel={c} active={channels.includes(c)} onClick={() => setChannels(channels.includes(c) ? channels.filter((x) => x !== c) : [...channels, c])} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-slate-500">Weight</span><span className="tabular-nums text-slate-700">{weight.toFixed(2)}</span></div>
            <input type="range" min={0} max={1} step={0.05} value={weight} onChange={(e) => setWeight(Number(e.target.value))} className="w-full" />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">Lookback (days)</span>
            <Input type="number" min={1} max={365} value={lookback} onChange={(e) => setLookback(Math.max(1, Number(e.target.value) || 1))} className="h-8 w-20 text-right" />
          </div>
        </div>
      </div>
      {dirty && (
        <div className="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-3">
          <Button size="sm" variant="ghost" onClick={reset}>Discard</Button>
          <Button size="sm" loading={saving} onClick={() => onPatch({ queries: queries.map((q) => q.trim()).filter(Boolean), channels, weight, lookback_days: lookback, description })}><Save className="h-3.5 w-3.5" />Save changes</Button>
        </div>
      )}
    </Card>
  );
}

export default function SignalsPage() {
  const { cid, running, poke } = useCompanyCtx();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.signals(cid), queryFn: () => api.signals(cid) });
  const runsQ = useQuery({
    queryKey: qk.runs(cid), queryFn: () => api.runs(cid),
    refetchInterval: (query) => (arr(query.state.data).some((r) => r.status === "running") ? 3000 : false),
  });
  const latest = [...arr(runsQ.data)].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];
  const [savingId, setSavingId] = useState<string | null>(null);

  const patch = useMutation({
    mutationFn: ({ id, p }: { id: string; p: SignalPatch }) => { setSavingId(id); return api.patchSignal(id, p); },
    onSuccess: (sig) => {
      qc.setQueryData<Signal[]>(qk.signals(cid), (old) => arr(old).map((x) => (x.id === sig.id ? sig : x)));
      toast.success("Signal updated");
    },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setSavingId(null),
  });
  const regen = useMutation({ mutationFn: () => api.regenerateSignals(cid), onSuccess: () => { poke(); toast.success("Regenerating signals from your ICP…"); }, onError: (e) => toast.error(errorMessage(e)) });
  const runNow = useMutation({ mutationFn: () => api.runNow(cid), onSuccess: () => { poke(); toast.success("Signal run started"); }, onError: (e) => toast.error(errorMessage(e)) });

  const list = arr(q.data);
  const activeCount = list.filter((s) => s.is_active).length;
  const runIsRunning = latest?.status === "running";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Signals</h2>
          <p className="text-sm text-slate-500">{list.length ? `${activeCount} of ${list.length} active — buying triggers SelloQ watches for` : "Buying triggers SelloQ watches for"}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => regen.mutate()} loading={regen.isPending} disabled={running}><RefreshCw className="h-4 w-4" />Regenerate</Button>
          <Button onClick={() => runNow.mutate()} loading={runNow.isPending || runIsRunning} disabled={running || !activeCount}><Play className="h-4 w-4" />Run now</Button>
        </div>
      </div>
      <RunStatsStrip run={latest} />
      {q.isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-56" />)}</div>
        : q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
        : list.length === 0 ? (
          <EmptyState icon={<Radar className="h-6 w-6" />} title={running ? "Signals are being generated…" : "No signals yet"}
            description="Signals are generated from your ICP: hiring, funding, expansion, pain posts and more."
            action={!running && <Button onClick={() => regen.mutate()} loading={regen.isPending}><RefreshCw className="h-4 w-4" />Generate signals</Button>} />
        ) : (
          <div className="space-y-3">
            {list.map((s) => <SignalCard key={s.id} s={s} saving={savingId === s.id && patch.isPending} onPatch={(p) => patch.mutate({ id: s.id, p })} />)}
          </div>
        )}
    </div>
  );
}

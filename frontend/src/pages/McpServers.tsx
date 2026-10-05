import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Server, Wrench } from "lucide-react";
import { api, type McpServer } from "../api";
import { qk } from "../lib/hooks";
import { cn } from "../lib/utils";
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Skeleton } from "../components/ui";

function toolName(t: McpServer["tools"][number]): string {
  return typeof t === "string" ? t : t?.name ?? "";
}

export default function McpServersPage() {
  const q = useQuery({ queryKey: qk.mcp, queryFn: api.mcpServers, refetchInterval: 30000 });
  const list = Array.isArray(q.data) ? q.data : [];
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Settings</p>
          <h1 className="text-2xl font-semibold text-slate-900">MCP servers</h1>
          <p className="mt-1 text-sm text-slate-500">Tool servers SelloQ uses for scraping, document parsing and signal search.</p>
        </div>
        <Button variant="outline" onClick={() => q.refetch()} loading={q.isFetching}><RefreshCw className="h-4 w-4" />Refresh</Button>
      </div>
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Server className="h-6 w-6" />} title="No MCP servers registered" description="Check mcp_servers.yaml on the backend." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {list.map((s) => {
            const healthy = s.healthy === true;
            const tools = Array.isArray(s.tools) ? s.tools : [];
            return (
              <Card key={s.name} className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="relative flex h-3 w-3">
                      {healthy && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />}
                      <span className={cn("relative inline-flex h-3 w-3 rounded-full", healthy ? "bg-emerald-500" : s.healthy === false ? "bg-rose-500" : "bg-slate-300")} />
                    </span>
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-slate-900">{s.name}</h3>
                      <p className="truncate font-mono text-xs text-slate-500">{s.url}</p>
                    </div>
                  </div>
                  <div className="flex gap-1.5">
                    {!s.enabled && <Badge tone="slate">Disabled</Badge>}
                    <Badge tone={healthy ? "green" : s.healthy === false ? "red" : "slate"}>{healthy ? "Healthy" : s.healthy === false ? "Unhealthy" : "Unknown"}</Badge>
                  </div>
                </div>
                <div className="mt-4">
                  <p className="mb-1.5 text-xs font-medium text-slate-500">Capabilities</p>
                  <div className="flex flex-wrap gap-1.5">
                    {(Array.isArray(s.capabilities) ? s.capabilities : []).map((c) => <Badge key={c} tone="brand">{c}</Badge>)}
                    {!s.capabilities?.length && <span className="text-xs text-slate-400">—</span>}
                  </div>
                </div>
                <div className="mt-3">
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-500"><Wrench className="h-3 w-3" />Tools</p>
                  <div className="flex flex-wrap gap-1.5">
                    {tools.map((t, i) => <Chip key={i} className="font-mono">{toolName(t)}</Chip>)}
                    {!tools.length && <span className="text-xs text-slate-400">No tools reported</span>}
                  </div>
                </div>
                {s.error && <p className="mt-3 rounded-md bg-rose-50 px-2 py-1.5 text-xs text-rose-700">{s.error}</p>}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

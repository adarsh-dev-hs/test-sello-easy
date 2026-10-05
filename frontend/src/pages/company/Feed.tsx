import { useState } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Inbox, Play, Search, SlidersHorizontal, X } from "lucide-react";
import { api, errorMessage, CHANNELS, LEAD_STATUSES, SIGNAL_TYPES, type Lead, type LeadStatus } from "../../api";
import { qk, useDebounced } from "../../lib/hooks";
import { humanize } from "../../lib/utils";
import { Button, EmptyState, ErrorState, Input, Select, Skeleton } from "../../components/ui";
import { channelLabel } from "../../components/domain";
import LeadCard, { type LeadAction } from "../../features/leads/LeadCard";
import LeadDrawer from "../../features/leads/LeadDrawer";
import { CallModal, EmailModal, WhatsAppModal } from "../../features/leads/ActionModals";
import { useCompanyCtx } from "./CompanyLayout";

const PAGE_SIZE = 20;

export default function FeedPage() {
  const { cid, running, poke, company } = useCompanyCtx();
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [signalType, setSignalType] = useState("");
  const [channel, setChannel] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search);
  const ms = useDebounced(minScore, 250);
  const filters = { status, signal_type: signalType, channel, min_score: ms || undefined, q: q.trim() || undefined, page, page_size: PAGE_SIZE };

  const leadsQ = useQuery({
    queryKey: [...qk.leads(cid), filters],
    queryFn: () => api.leads(cid, filters),
    placeholderData: keepPreviousData,
    refetchInterval: running ? 5000 : false,
  });

  const [openLead, setOpenLead] = useState<string | null>(null);
  const [action, setAction] = useState<{ lead: Lead; kind: LeadAction } | null>(null);
  const [busyLead, setBusyLead] = useState<string | null>(null);

  const setLeadStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: LeadStatus }) => { setBusyLead(id); return api.setLeadStatus(id, s); },
    onSuccess: (_d, v) => { toast.success(`Marked as ${v.s}`); qc.invalidateQueries({ queryKey: qk.leads(cid) }); qc.invalidateQueries({ queryKey: qk.lead(v.id) }); },
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: () => setBusyLead(null),
  });

  const runNow = useMutation({
    mutationFn: () => api.runNow(cid),
    onSuccess: () => { toast.success("Signal run started — new leads will appear shortly"); poke(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const data = leadsQ.data;
  const items = Array.isArray(data?.items) ? data!.items : [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.page_size || PAGE_SIZE)));
  const hasFilters = !!(status || signalType || channel || minScore || search);
  const reset = () => { setStatus(""); setSignalType(""); setChannel(""); setMinScore(0); setSearch(""); setPage(1); };
  const upd = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Signal Feed</h2>
          <p className="text-sm text-slate-500">{leadsQ.isLoading ? "Loading leads…" : `${total} lead${total === 1 ? "" : "s"}, ranked by score`}</p>
        </div>
        <Button onClick={() => runNow.mutate()} loading={runNow.isPending} disabled={running}><Play className="h-4 w-4" />Run signals now</Button>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input className="pl-9" placeholder="Search organisation, contact, evidence…" value={search} onChange={(e) => upd(setSearch)(e.target.value)} />
          </div>
          <Select value={status} onChange={(e) => upd(setStatus)(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select value={signalType} onChange={(e) => upd(setSignalType)(e.target.value)} aria-label="Signal type">
            <option value="">All signal types</option>
            {SIGNAL_TYPES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
          </Select>
          <Select value={channel} onChange={(e) => upd(setChannel)(e.target.value)} aria-label="Channel">
            <option value="">All channels</option>
            {CHANNELS.map((c) => <option key={c} value={c}>{channelLabel(c)}</option>)}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 px-1">
          <SlidersHorizontal className="h-4 w-4 text-slate-400" />
          <label className="text-xs text-slate-600" htmlFor="minscore">Min score</label>
          <input id="minscore" type="range" min={0} max={100} step={5} value={minScore} onChange={(e) => upd(setMinScore)(Number(e.target.value))} className="w-40 sm:w-56" />
          <span className="w-8 text-xs font-medium tabular-nums text-slate-700">{minScore}</span>
          {hasFilters && <Button size="sm" variant="ghost" onClick={reset} className="ml-auto"><X className="h-3.5 w-3.5" />Clear filters</Button>}
        </div>
      </div>

      {leadsQ.isLoading ? (
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-52" />)}</div>
      ) : leadsQ.isError ? (
        <ErrorState error={leadsQ.error} onRetry={() => leadsQ.refetch()} />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={<Search className="h-6 w-6" />} title="No leads match these filters" action={<Button variant="outline" onClick={reset}>Clear filters</Button>} />
        ) : running ? (
          <EmptyState icon={<Inbox className="h-6 w-6" />} title="Hunting for leads…" description="The pipeline is running. Leads will appear here as soon as signals are matched." />
        ) : (
          <EmptyState
            icon={<Inbox className="h-6 w-6" />}
            title="No leads yet"
            description={company.status === "draft" ? "The pipeline hasn’t been started for this company yet." : "Run your signals to search news, jobs, social and the web for companies showing buying intent."}
            action={<div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => runNow.mutate()} loading={runNow.isPending}><Play className="h-4 w-4" />Run signals now</Button>
              <Link to="signals"><Button variant="outline">Review signals</Button></Link>
            </div>}
          />
        )
      ) : (
        <>
          <div className={leadsQ.isFetching && leadsQ.isPlaceholderData ? "space-y-3 opacity-60" : "space-y-3"}>
            {items.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                onOpen={() => setOpenLead(l.id)}
                onAction={(kind) => setAction({ lead: l, kind })}
                onStatus={(s) => setLeadStatus.mutate({ id: l.id, s })}
                busy={busyLead === l.id}
              />
            ))}
          </div>
          {pages > 1 && (
            <div className="mt-5 flex items-center justify-between">
              <p className="text-xs text-slate-500">Page {page} of {pages} · {total} leads</p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" />Prev</Button>
                <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </>
      )}

      <LeadDrawer leadId={openLead} cid={cid} onClose={() => setOpenLead(null)} onAction={(lead, kind) => setAction({ lead, kind })} />
      {action && <EmailModal lead={action.lead} cid={cid} open={action.kind === "email"} onClose={() => setAction(null)} />}
      {action && <CallModal lead={action.lead} cid={cid} open={action.kind === "call"} onClose={() => setAction(null)} />}
      {action && <WhatsAppModal lead={action.lead} cid={cid} open={action.kind === "whatsapp"} onClose={() => setAction(null)} />}
    </div>
  );
}

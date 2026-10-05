import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, CircleDot, ExternalLink, Globe, Mail, MapPin, MessageCircle, NotebookPen, Phone, Sparkles, Users } from "lucide-react";
import { api, errorMessage, type Activity, type Lead, type LeadStatus } from "../../api";
import { qk } from "../../lib/hooks";
import { arr, externalUrl, formatDate, hostOf, humanize, str, timeAgo } from "../../lib/utils";
import { Button, ErrorState, LoadingBlock, Select, Textarea, Tooltip, Drawer } from "../../components/ui";
import { ChannelIcon, LeadStatusPill, ScoreRing, SignalTypeBadge, channelLabel } from "../../components/domain";
import { LeadActionsBar, ScoreTooltip, type LeadAction } from "./LeadCard";

function Section({ title, children, icon }: { title: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <section className="border-b border-slate-100 px-5 py-4">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{icon}{title}</h3>
      {children}
    </section>
  );
}
function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div><dt className="text-xs text-slate-500">{k}</dt><dd className="mt-0.5 break-words text-sm text-slate-900">{v || <span className="text-slate-400">—</span>}</dd></div>
  );
}

const ACT_ICON: Record<string, typeof Mail> = { email: Mail, call: Phone, whatsapp: MessageCircle, note: NotebookPen, status: CircleDot };

function activityText(a: Activity): { title: string; body?: string } {
  const p = (a.payload ?? {}) as Record<string, unknown>;
  switch (a.channel) {
    case "email": return { title: `Email sent${p.to ? ` to ${str(p.to)}` : ""}${p.subject ? ` — “${str(p.subject)}”` : ""}`, body: str(p.body) || undefined };
    case "call": return { title: `Call logged${p.outcome ? `: ${humanize(str(p.outcome))}` : ""}`, body: str(p.notes) || undefined };
    case "whatsapp": return { title: `WhatsApp message${p.phone ? ` to ${str(p.phone)}` : ""}`, body: str(p.message) || undefined };
    case "note": return { title: "Note", body: str(p.text) || undefined };
    case "status": return { title: `Status changed${p.from ? ` from ${humanize(str(p.from))}` : ""}${p.to || p.status ? ` to ${humanize(str(p.to ?? p.status))}` : ""}` };
    default: return { title: humanize(a.channel) };
  }
}

export default function LeadDrawer({ leadId, cid, onClose, onAction }: {
  leadId: string | null; cid: string; onClose: () => void; onAction: (lead: Lead, a: LeadAction) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.lead(leadId ?? ""), queryFn: () => api.lead(leadId!), enabled: !!leadId });
  const [note, setNote] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: qk.lead(leadId ?? "") }); qc.invalidateQueries({ queryKey: qk.leads(cid) }); };
  const status = useMutation({
    mutationFn: (s: LeadStatus) => api.setLeadStatus(leadId!, s),
    onSuccess: (_d, s) => { toast.success(`Marked as ${s}`); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const addNote = useMutation({
    mutationFn: () => api.addNote(leadId!, note.trim()),
    onSuccess: () => { setNote(""); toast.success("Note added"); refresh(); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const lead = q.data;
  const activities = [...arr(lead?.activities)].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <Drawer
      open={!!leadId}
      onClose={onClose}
      title={lead ? (
        <div className="flex items-center gap-3">
          <Tooltip content={<ScoreTooltip lead={lead} />}><ScoreRing score={lead.score} size={48} /></Tooltip>
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900">{lead.org_name}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <LeadStatusPill status={lead.status} />
              {lead.domain && <a className="hover:text-brand-600" href={externalUrl(lead.domain)} target="_blank" rel="noreferrer">{hostOf(lead.domain)}</a>}
            </div>
          </div>
        </div>
      ) : <span className="text-sm text-slate-500">Lead</span>}
      headerExtra={lead && (
        <Select className="h-8 w-36 text-xs" value={lead.status} onChange={(e) => status.mutate(e.target.value as LeadStatus)} disabled={status.isPending}>
          {(["new", "contacted", "qualified", "disqualified"] as LeadStatus[]).map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
        </Select>
      )}
    >
      {q.isLoading ? <LoadingBlock /> : q.isError ? <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div> : lead && (
        <>
          <div className="border-b border-slate-100 px-5 py-3">
            <LeadActionsBar lead={lead} onAction={(a) => onAction(lead, a)} onStatus={(s) => status.mutate(s)} busy={status.isPending} />
          </div>

          <Section title="Company" icon={<Building2 className="h-3.5 w-3.5" />}>
            {lead.description && <p className="mb-3 text-sm text-slate-700">{lead.description}</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <KV k="Industry" v={lead.industry} />
              <KV k="Employees" v={lead.employees != null ? Number(lead.employees).toLocaleString() : null} />
              <KV k="HQ" v={lead.hq && <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" />{lead.hq}</span>} />
              <KV k="Website" v={lead.domain && <a className="inline-flex items-center gap-1 text-brand-600 hover:underline" href={externalUrl(lead.domain)} target="_blank" rel="noreferrer"><Globe className="h-3 w-3" />{hostOf(lead.domain)}</a>} />
              <KV k="First seen" v={formatDate(lead.first_seen_at)} />
              <KV k="Last signal" v={lead.last_signal_at ? timeAgo(lead.last_signal_at) : null} />
            </dl>
          </Section>

          <Section title="Contact" icon={<Users className="h-3.5 w-3.5" />}>
            {lead.contact_name || lead.email || lead.phone ? (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="font-medium text-slate-900">{lead.contact_name || "Unknown contact"}</p>
                {lead.contact_title && <p className="text-sm text-slate-500">{lead.contact_title}</p>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {lead.email && <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline"><Mail className="h-3.5 w-3.5" />{lead.email}</a>}
                  {lead.phone && <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="inline-flex items-center gap-1 text-brand-600 hover:underline"><Phone className="h-3.5 w-3.5" />{lead.phone}</a>}
                  {lead.linkedin_url && <a href={externalUrl(lead.linkedin_url)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-600 hover:underline"><ExternalLink className="h-3.5 w-3.5" />LinkedIn</a>}
                </div>
              </div>
            ) : <p className="text-sm text-slate-400">No contact found yet.</p>}
          </Section>

          <Section title={`Signals & evidence (${arr(lead.signals).length})`} icon={<Sparkles className="h-3.5 w-3.5" />}>
            <div className="space-y-3">
              {arr(lead.signals).map((s) => (
                <div key={s.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <SignalTypeBadge type={s.signal_type} />
                    {s.signal_name && <span className="font-medium text-slate-700">{s.signal_name}</span>}
                    <span className="inline-flex items-center gap-1"><ChannelIcon channel={s.source} />{channelLabel(s.source)}</span>
                    {s.published_at && <span>· {timeAgo(s.published_at)}</span>}
                    {s.confidence != null && <span className="ml-auto tabular-nums">conf. {Math.round((s.confidence <= 1 ? s.confidence * 100 : s.confidence))}%</span>}
                  </div>
                  {s.title && (s.url
                    ? <a href={s.url} target="_blank" rel="noreferrer" className="mt-2 flex items-start gap-1 text-sm font-medium text-slate-900 hover:text-brand-700">{s.title}<ExternalLink className="mt-0.5 h-3 w-3 shrink-0" /></a>
                    : <p className="mt-2 text-sm font-medium text-slate-900">{s.title}</p>)}
                  {!s.title && s.url && <a href={s.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-sm text-brand-600 hover:underline">{s.url}</a>}
                  {s.snippet && <p className="mt-1 text-sm text-slate-600">“{s.snippet}”</p>}
                  {s.explanation && <p className="mt-2 rounded-md bg-violet-50 px-2 py-1.5 text-xs text-violet-800"><b>Why: </b>{s.explanation}</p>}
                </div>
              ))}
              {!arr(lead.signals).length && <p className="text-sm text-slate-400">No signals recorded.</p>}
            </div>
          </Section>

          <Section title="Activity" icon={<NotebookPen className="h-3.5 w-3.5" />}>
            <div className="mb-4 space-y-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note…" />
              <div className="flex justify-end"><Button size="sm" onClick={() => addNote.mutate()} disabled={!note.trim()} loading={addNote.isPending}>Add note</Button></div>
            </div>
            {activities.length === 0 ? <p className="text-sm text-slate-400">No activity yet.</p> : (
              <ol className="relative space-y-4 border-l border-slate-200 pl-5">
                {activities.map((a) => {
                  const I = ACT_ICON[a.channel] ?? CircleDot;
                  const t = activityText(a);
                  return (
                    <li key={a.id} className="relative">
                      <span className="absolute -left-[29px] flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500"><I className="h-3 w-3" /></span>
                      <p className="text-sm text-slate-800">{t.title}</p>
                      <p className="text-xs text-slate-400">{[a.user_name, timeAgo(a.created_at), a.status && a.status !== "ok" ? a.status : null].filter(Boolean).join(" · ")}</p>
                      {t.body && <p className="mt-1 line-clamp-3 whitespace-pre-line rounded-md bg-slate-50 px-2 py-1.5 text-xs text-slate-600">{t.body}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        </>
      )}
    </Drawer>
  );
}

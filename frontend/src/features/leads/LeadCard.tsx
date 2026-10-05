import { Briefcase, Check, ExternalLink, Mail, MessageCircle, Phone, Sparkles, X } from "lucide-react";
import type { Lead, LeadSignal } from "../../api";
import { arr, cn, externalUrl, hostOf, timeAgo } from "../../lib/utils";
import { Button, Card, Tooltip } from "../../components/ui";
import { ChannelIcon, LeadStatusPill, ScoreRing, SignalTypeBadge, channelLabel } from "../../components/domain";

export type LeadAction = "email" | "call" | "whatsapp";

export function primarySignal(lead: Lead): LeadSignal | undefined {
  const s = arr(lead.signals);
  return [...s].sort((a, b) => {
    const ta = a.published_at ? new Date(a.published_at).getTime() : 0;
    const tb = b.published_at ? new Date(b.published_at).getTime() : 0;
    return (b.confidence ?? 0) - (a.confidence ?? 0) || tb - ta;
  })[0];
}

export function ScoreTooltip({ lead }: { lead: Lead }) {
  const fit = arr(lead.score_breakdown?.fit_reasons);
  const intent = arr(lead.score_breakdown?.intent_reasons);
  return (
    <div className="space-y-2">
      <div className="flex justify-between font-medium">
        <span>Fit <span className="tabular-nums">{Math.round(lead.fit_score ?? 0)}</span></span>
        <span>Intent <span className="tabular-nums">{Math.round(lead.intent_score ?? 0)}</span></span>
      </div>
      <p className="text-[11px] text-slate-400">Score = 50% fit + 50% intent</p>
      {fit.length > 0 && (
        <div><p className="mb-0.5 text-[11px] uppercase tracking-wide text-slate-400">Fit</p>
          <ul className="list-disc space-y-0.5 pl-4">{fit.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
      )}
      {intent.length > 0 && (
        <div><p className="mb-0.5 text-[11px] uppercase tracking-wide text-slate-400">Intent</p>
          <ul className="list-disc space-y-0.5 pl-4">{intent.map((r, i) => <li key={i}>{r}</li>)}</ul></div>
      )}
      {!fit.length && !intent.length && <p className="text-slate-400">No breakdown available.</p>}
    </div>
  );
}

export function LeadActionsBar({ lead, onAction, onStatus, busy, size = "sm" }: {
  lead: Lead; onAction: (a: LeadAction) => void; onStatus: (s: "qualified" | "disqualified") => void; busy?: boolean; size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <Button size={size} variant="outline" onClick={() => onAction("email")}><Mail className="h-3.5 w-3.5" />Email</Button>
      <Button size={size} variant="outline" onClick={() => onAction("call")}><Phone className="h-3.5 w-3.5" />Call</Button>
      <Button size={size} variant="outline" onClick={() => onAction("whatsapp")}><MessageCircle className="h-3.5 w-3.5" />WhatsApp</Button>
      <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
      <Button size={size} variant={lead.status === "qualified" ? "success" : "ghost"} className={cn(lead.status !== "qualified" && "text-emerald-700 hover:bg-emerald-50")} disabled={busy || lead.status === "qualified"} onClick={() => onStatus("qualified")}>
        <Check className="h-3.5 w-3.5" />Qualify
      </Button>
      <Button size={size} variant="ghost" className="text-rose-600 hover:bg-rose-50" disabled={busy || lead.status === "disqualified"} onClick={() => onStatus("disqualified")}>
        <X className="h-3.5 w-3.5" />Disqualify
      </Button>
    </div>
  );
}

export default function LeadCard({ lead, onOpen, onAction, onStatus, busy }: {
  lead: Lead; onOpen: () => void; onAction: (a: LeadAction) => void; onStatus: (s: "qualified" | "disqualified") => void; busy?: boolean;
}) {
  const ps = primarySignal(lead);
  const signals = arr(lead.signals);
  const types = Array.from(new Map(signals.map((s) => [`${s.signal_type}|${s.source}`, s])).values());
  return (
    <Card className={cn("cursor-pointer p-5 transition-shadow hover:border-brand-200 hover:shadow-md", lead.status === "disqualified" && "opacity-60")}>
      <div onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}>
        <div className="flex items-start gap-4">
          <Tooltip content={<ScoreTooltip lead={lead} />}>
            <ScoreRing score={lead.score} />
          </Tooltip>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-slate-900">{lead.org_name || "Unknown organisation"}</h3>
              <LeadStatusPill status={lead.status} />
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
              {lead.domain && (
                <a href={externalUrl(lead.domain)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="hover:text-brand-600">{hostOf(lead.domain)}</a>
              )}
              {lead.industry && <span>{lead.industry}</span>}
              {lead.hq && <span>{lead.hq}</span>}
              {(lead.contact_name || lead.contact_title) && (
                <span className="inline-flex items-center gap-1 text-slate-700"><Briefcase className="h-3 w-3" />{[lead.contact_name, lead.contact_title].filter(Boolean).join(" · ")}</span>
              )}
            </div>
            {types.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {types.slice(0, 5).map((s) => (
                  <SignalTypeBadge key={s.id} type={s.signal_type || "signal"} icon={<ChannelIcon channel={s.source} className="h-3 w-3" />} />
                ))}
                {types.length > 5 && <span className="text-xs text-slate-400">+{types.length - 5}</span>}
              </div>
            )}
          </div>
          <span className="hidden shrink-0 text-xs text-slate-400 sm:block">{timeAgo(lead.last_signal_at)}</span>
        </div>

        {ps && (
          <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <ChannelIcon channel={ps.source} />
              <span className="font-medium text-slate-600">{channelLabel(ps.source)}</span>
              {ps.published_at && <span>· {timeAgo(ps.published_at)}</span>}
              {ps.url && (
                <a href={ps.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ml-auto inline-flex min-w-0 items-center gap-1 truncate text-brand-600 hover:underline">
                  <span className="truncate">{hostOf(ps.url)}</span><ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              )}
            </div>
            {ps.title && <p className="mt-1.5 text-sm font-medium text-slate-800">{ps.title}</p>}
            {ps.snippet && <p className="mt-1 line-clamp-2 text-sm text-slate-600">“{ps.snippet}”</p>}
          </div>
        )}
        {ps?.explanation && (
          <p className="mt-3 flex items-start gap-2 text-sm text-slate-700">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-violet-500" />
            <span><span className="font-medium text-violet-700">Why this lead: </span>{ps.explanation}</span>
          </p>
        )}
      </div>
      <div className="mt-4 border-t border-slate-100 pt-3">
        <LeadActionsBar lead={lead} onAction={onAction} onStatus={onStatus} busy={busy} />
      </div>
    </Card>
  );
}

import { useRef, useState, type ReactNode } from "react";
import {
  AtSign, Briefcase, Check, CircleAlert, File, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Globe,
  Loader2, MessagesSquare, Newspaper, ThumbsUp, UploadCloud, Users, X,
} from "lucide-react";
import type { CompanyStatus, LeadStatus, PipelineStatus, SourceKind, StepKey, StepState } from "../api/types";
import { cn, humanize } from "../lib/utils";
import { Badge, type Tone } from "./ui";

/* ---------- Company status ---------- */
const STATUS_META: Record<CompanyStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "slate" },
  ingesting: { label: "Ingesting", tone: "blue" },
  profiling: { label: "Profiling", tone: "blue" },
  generating_icp: { label: "Generating ICP", tone: "violet" },
  generating_signals: { label: "Generating signals", tone: "violet" },
  finding_leads: { label: "Finding leads", tone: "amber" },
  leads_ready: { label: "Leads ready", tone: "green" },
  failed: { label: "Failed", tone: "red" },
};
export function CompanyStatusBadge({ status }: { status: CompanyStatus | null | undefined }) {
  const m = (status && STATUS_META[status]) || { label: humanize(status) || "Unknown", tone: "slate" as Tone };
  const running = status && !["draft", "leads_ready", "failed"].includes(status);
  return <Badge tone={m.tone} icon={running ? <Loader2 className="h-3 w-3 animate-spin" /> : undefined}>{m.label}</Badge>;
}

/* ---------- Lead status ---------- */
const LEAD_TONE: Record<LeadStatus, Tone> = { new: "brand", contacted: "sky", qualified: "green", disqualified: "slate" };
export function LeadStatusPill({ status }: { status: LeadStatus | string | null | undefined }) {
  const s = (status || "new") as LeadStatus;
  return <Badge tone={LEAD_TONE[s] ?? "slate"}>{humanize(s)}</Badge>;
}

/* ---------- Signal types ---------- */
const TYPE_TONE: Record<string, Tone> = {
  hiring: "blue", funding: "green", expansion: "teal", leadership_change: "violet", tech_adoption: "sky",
  pain_post: "red", rfp_tender: "orange", competitor_mention: "pink", event_participation: "amber",
};
export function SignalTypeBadge({ type, icon }: { type: string | null | undefined; icon?: ReactNode }) {
  if (!type) return null;
  return <Badge tone={TYPE_TONE[type] ?? "slate"} icon={icon}>{humanize(type)}</Badge>;
}

/* ---------- Channels / sources ---------- */
const CHANNEL_ICON: Record<string, typeof Globe> = {
  web: Globe, news: Newspaper, x: AtSign, linkedin: Users, reddit: MessagesSquare, facebook: ThumbsUp, jobs: Briefcase,
};
const CHANNEL_LABEL: Record<string, string> = {
  web: "Web", news: "News", x: "X", linkedin: "LinkedIn", reddit: "Reddit", facebook: "Facebook", jobs: "Jobs",
};
export const channelLabel = (c: string | null | undefined) => (c ? CHANNEL_LABEL[c] ?? humanize(c) : "Unknown");
export function ChannelIcon({ channel, className }: { channel: string | null | undefined; className?: string }) {
  const I = (channel && CHANNEL_ICON[channel]) || Globe;
  return <I className={cn("h-3.5 w-3.5", className)} />;
}
export function ChannelChip({ channel, active = true, onClick }: { channel: string; active?: boolean; onClick?: () => void }) {
  const cls = cn(
    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors",
    active ? "bg-slate-800 text-white ring-slate-800" : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50",
  );
  const inner = <><ChannelIcon channel={channel} className="h-3 w-3" />{channelLabel(channel)}</>;
  return onClick ? <button type="button" className={cls} onClick={onClick}>{inner}</button> : <span className={cls}>{inner}</span>;
}

const KIND_ICON: Record<string, typeof File> = {
  website: Globe, pdf: FileText, docx: FileText, text: FileText, xlsx: FileSpreadsheet, csv: FileSpreadsheet,
  image: FileImage, video: FileVideo, audio: FileAudio, other: File,
};
export function SourceKindIcon({ kind, className }: { kind: SourceKind | string | null | undefined; className?: string }) {
  const I = (kind && KIND_ICON[kind]) || File;
  return <I className={cn("h-4 w-4", className)} />;
}
export function guessKind(name: string): SourceKind {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx"].includes(ext)) return "docx";
  if (["xls", "xlsx"].includes(ext)) return "xlsx";
  if (ext === "csv") return "csv";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "tif", "tiff"].includes(ext)) return "image";
  if (["mp4", "mov", "webm", "mkv", "avi"].includes(ext)) return "video";
  if (["mp3", "wav", "m4a", "ogg", "flac", "aac"].includes(ext)) return "audio";
  if (["txt", "md", "html", "htm"].includes(ext)) return "text";
  return "other";
}

/* ---------- Score ring ---------- */
export function scoreColor(score: number): string {
  if (score >= 75) return "#059669";
  if (score >= 50) return "#4f46e5";
  if (score >= 30) return "#d97706";
  return "#94a3b8";
}
export function ScoreRing({ score, size = 52, stroke = 5 }: { score: number | null | undefined; size?: number; stroke?: number }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={scoreColor(v)} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: "stroke-dashoffset .5s" }} />
      </svg>
      <span className="absolute text-sm font-semibold tabular-nums text-slate-900">{v}</span>
    </div>
  );
}

/* ---------- Pipeline stepper ---------- */
export const DEFAULT_STEPS: { key: StepKey; label: string }[] = [
  { key: "ingest", label: "Ingest sources" },
  { key: "profile", label: "Build profile" },
  { key: "icp", label: "Generate ICP" },
  { key: "signals", label: "Generate signals" },
  { key: "leads", label: "Find leads" },
];
export function PipelineStepper({ status, compact }: { status: PipelineStatus | null | undefined; compact?: boolean }) {
  const steps = (Array.isArray(status?.steps) && status!.steps.length ? status!.steps : DEFAULT_STEPS.map((s) => ({ ...s, state: "pending" as StepState })));
  return (
    <ol className={cn("flex w-full", compact ? "gap-1" : "flex-col gap-0 sm:flex-row sm:gap-2")}>
      {steps.map((s, i) => {
        const st = s.state;
        return (
          <li key={s.key} className={cn("flex flex-1 items-center gap-3", !compact && "py-2 sm:flex-col sm:gap-2 sm:py-0 sm:text-center")}>
            <div className={cn("relative flex w-full items-center", !compact && "sm:justify-center")}>
              <span
                className={cn(
                  "z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold",
                  st === "done" && "border-emerald-500 bg-emerald-500 text-white",
                  st === "running" && "border-brand-600 bg-brand-50 text-brand-700",
                  st === "failed" && "border-rose-500 bg-rose-500 text-white",
                  st === "pending" && "border-slate-300 bg-white text-slate-400",
                )}
              >
                {st === "done" ? <Check className="h-4 w-4" /> : st === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : st === "failed" ? <X className="h-4 w-4" /> : i + 1}
              </span>
              {!compact && <span className="ml-3 text-sm font-medium text-slate-700 sm:hidden">{s.label}</span>}
              {i < steps.length - 1 && (
                <span className={cn("absolute left-1/2 top-1/2 hidden h-0.5 w-full -translate-y-1/2 sm:block", st === "done" ? "bg-emerald-400" : "bg-slate-200")} style={{ marginLeft: 16 }} />
              )}
            </div>
            {!compact && <span className={cn("hidden text-xs font-medium sm:block", st === "running" ? "text-brand-700" : st === "failed" ? "text-rose-600" : "text-slate-600")}>{s.label}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- File dropzone ---------- */
export const ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.md,.html,.png,.jpg,.jpeg,.gif,.webp,.tif,.tiff,.mp4,.mov,.webm,.mp3,.wav,.m4a,.ogg";
export function FileDropzone({ files, onChange, disabled }: { files: File[]; onChange: (f: File[]) => void; disabled?: boolean }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f);
    onChange(next);
  };
  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) addFiles(e.dataTransfer.files); }}
        onClick={() => !disabled && ref.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") ref.current?.click(); }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
          over ? "border-brand-500 bg-brand-50" : "border-slate-300 bg-slate-50 hover:border-brand-400 hover:bg-brand-50/40",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <UploadCloud className="mb-2 h-8 w-8 text-brand-500" />
        <p className="text-sm font-medium text-slate-800">Drag & drop files here, or <span className="text-brand-600">browse</span></p>
        <p className="mt-1 text-xs text-slate-500">PDF, DOCX, XLSX, CSV, images, video and audio — up to 200 MB total</p>
        <input ref={ref} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
      </div>
      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <SourceKindIcon kind={guessKind(f.name)} className="text-slate-500" />
              <span className="min-w-0 flex-1 truncate text-slate-800">{f.name}</span>
              <span className="text-xs text-slate-400">{formatBytes(f.size)}</span>
              {!disabled && (
                <button type="button" className="text-slate-400 hover:text-rose-600" onClick={() => onChange(files.filter((_, j) => j !== i))} aria-label="Remove file">
                  <X className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  );
}

import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Building2, Check, FileUp, Rocket } from "lucide-react";
import { api, errorMessage } from "../api";
import { qk, useCompanyStatus, usePokeStatus } from "../lib/hooks";
import { cn } from "../lib/utils";
import { Button, Card, Field, Input, ProgressBar } from "../components/ui";
import { FileDropzone, InlineError, PipelineStepper } from "../components/domain";

const STEPS = [
  { n: 1, label: "Company", icon: Building2 },
  { n: 2, label: "Documents", icon: FileUp },
  { n: 3, label: "Launch", icon: Rocket },
];

function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return t;
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export default function OnboardingPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [wid, setWid] = useState<string | null>(params.get("wid"));
  const [cid, setCid] = useState<string | null>(null);
  const [wsName, setWsName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

  const statusQ = useCompanyStatus(started ? cid ?? undefined : undefined, true);
  const poke = usePokeStatus(cid ?? undefined);
  const st = statusQ.data;
  const done = st?.status === "leads_ready";
  const failed = st?.status === "failed";

  const submitCompany = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      let w = wid;
      if (!w) {
        const ws = await api.createWorkspace(wsName.trim() || companyName.trim());
        w = ws.id; setWid(w);
      }
      if (!cid) {
        const c = await api.createCompany(w, companyName.trim(), normalizeUrl(website));
        setCid(c.id);
      }
      qc.invalidateQueries({ queryKey: qk.workspaces });
      setStep(2);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  const submitFiles = async () => {
    if (!cid) return;
    if (!files.length) { setStep(3); return; }
    setBusy(true); setErr(null);
    try {
      const res = await api.uploadSources(cid, files);
      setUploadedCount((n) => n + (Array.isArray(res) ? res.length : files.length));
      setFiles([]);
      toast.success(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}`);
      setStep(3);
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  const start = async () => {
    if (!cid) return;
    setBusy(true); setErr(null);
    try {
      await api.runPipeline(cid, "ingest");
      setStarted(true);
      poke();
      qc.invalidateQueries({ queryKey: qk.workspaces });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Set up a new workspace</h1>
        <p className="mt-1 text-sm text-slate-500">Tell us about the company you sell for. We’ll build its profile, ICP and buying signals automatically.</p>
      </div>

      <ol className="mb-6 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <li key={s.n} className="flex flex-1 items-center gap-2">
            <span className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              step > s.n ? "bg-emerald-500 text-white" : step === s.n ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500",
            )}>{step > s.n ? <Check className="h-4 w-4" /> : s.n}</span>
            <span className={cn("hidden text-sm font-medium sm:block", step >= s.n ? "text-slate-900" : "text-slate-400")}>{s.label}</span>
            {i < STEPS.length - 1 && <span className={cn("h-0.5 flex-1 rounded", step > s.n ? "bg-emerald-400" : "bg-slate-200")} />}
          </li>
        ))}
      </ol>

      <Card className="p-6">
        {step === 1 && (
          <form onSubmit={submitCompany} className="space-y-4">
            {!wid && (
              <Field label="Workspace name" hint="Optional — defaults to the company name">
                <Input value={wsName} onChange={(e) => setWsName(e.target.value)} placeholder="e.g. NordWave – EMEA team" />
              </Field>
            )}
            <Field label="Company name">
              <Input required value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. NordWave Networks" />
            </Field>
            <Field label="Website URL" hint="We’ll crawl up to ~15 pages from this site">
              <Input required value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" />
            </Field>
            {err && <InlineError>{err}</InlineError>}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => nav("/")}>Cancel</Button>
              <Button type="submit" loading={busy}>Continue<ArrowRight className="h-4 w-4" /></Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="font-semibold text-slate-900">Add documents</h2>
              <p className="text-sm text-slate-500">Brochures, pricing sheets, case studies, product screenshots, webinar recordings… Anything that describes what you sell.</p>
            </div>
            <FileDropzone files={files} onChange={setFiles} disabled={busy} />
            {err && <InlineError>{err}</InlineError>}
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setStep(1)} disabled={busy || !!cid}><ArrowLeft className="h-4 w-4" />Back</Button>
              <div className="flex gap-2">
                {files.length === 0 && <Button variant="outline" onClick={() => setStep(3)}>Skip</Button>}
                {files.length > 0 && <Button onClick={submitFiles} loading={busy}>Upload {files.length} file{files.length > 1 ? "s" : ""} & continue<ArrowRight className="h-4 w-4" /></Button>}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div>
              <h2 className="font-semibold text-slate-900">{started ? "Building your intelligence…" : "Ready to launch"}</h2>
              <p className="text-sm text-slate-500">
                {started
                  ? "This typically takes a few minutes. You can leave this page — the pipeline keeps running in the background."
                  : `We’ll crawl ${website ? normalizeUrl(website) : "your website"}${uploadedCount ? ` and parse ${uploadedCount} document${uploadedCount > 1 ? "s" : ""}` : ""}, then generate your profile, ICP, signals and leads.`}
              </p>
            </div>
            <PipelineStepper status={st} />
            {started && (
              <div>
                <ProgressBar value={st?.progress ?? 0} />
                <div className="mt-2 flex justify-between text-xs text-slate-500">
                  <span>{st?.message || (statusQ.isLoading ? "Starting…" : "Working…")}</span>
                  <span className="tabular-nums">{Math.round(st?.progress ?? 0)}%</span>
                </div>
              </div>
            )}
            {(st?.error || failed) && <InlineError>{st?.error || "The pipeline failed."}</InlineError>}
            {err && <InlineError>{err}</InlineError>}
            <div className="flex flex-wrap justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(2)} disabled={started}><ArrowLeft className="h-4 w-4" />Back</Button>
              <div className="flex gap-2">
                {!started && <Button onClick={start} loading={busy}><Rocket className="h-4 w-4" />Start pipeline</Button>}
                {failed && <Button variant="outline" onClick={start} loading={busy}>Retry</Button>}
                {started && cid && (
                  <Button variant={done ? "primary" : "outline"} onClick={() => nav(`/c/${cid}`)}>
                    {done ? "Go to Signal Feed" : "Open workspace"}<ArrowRight className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

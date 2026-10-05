import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Plus, RefreshCw, RotateCcw, Save, Target, Trash2, UserRound } from "lucide-react";
import { api, ApiError, errorMessage, type ICP, type ICPRecord, type Persona } from "../../api";
import { qk } from "../../lib/hooks";
import { formatDate, normalizeIcp } from "../../lib/utils";
import { Badge, Button, Card, CardHeader, ChipList, EmptyState, ErrorState, Field, Input, LoadingBlock, Select, TagInput, Textarea } from "../../components/ui";
import { useCompanyCtx } from "./CompanyLayout";

const LISTS: { key: keyof ICP; label: string; hint?: string }[] = [
  { key: "pain_points", label: "Pain points" },
  { key: "buying_triggers", label: "Buying triggers" },
  { key: "keywords", label: "Keywords", hint: "Used to search for signals" },
  { key: "negative_keywords", label: "Negative keywords", hint: "Hits containing these are ignored" },
  { key: "exclusions", label: "Exclusions" },
  { key: "disqualifiers", label: "Disqualifiers" },
];

function Tags({ value, onChange, ro }: { value: string[]; onChange: (v: string[]) => void; ro: boolean }) {
  return ro ? <ChipList items={value} /> : <TagInput value={value} onChange={onChange} />;
}
function Text({ value, onChange, ro, placeholder }: { value: string; onChange: (v: string) => void; ro: boolean; placeholder?: string }) {
  return ro ? <p className="text-sm text-slate-800">{value || <span className="text-slate-400">—</span>}</p> : <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />;
}
function Section({ title, icon, children, actions }: { title: string; icon?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return <Card><CardHeader title={title} icon={icon} actions={actions} /><div className="p-5">{children}</div></Card>;
}

function PersonaCard({ p, ro, onChange, onRemove }: { p: Persona; ro: boolean; onChange: (p: Persona) => void; onRemove: () => void }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-100 text-violet-700"><UserRound className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 space-y-2">
          {ro ? (
            <>
              <p className="font-semibold text-slate-900">{p.title || "Untitled persona"}</p>
              <div className="flex flex-wrap gap-1.5">{p.seniority && <Badge tone="violet">{p.seniority}</Badge>}{p.department && <Badge tone="slate">{p.department}</Badge>}</div>
            </>
          ) : (
            <>
              <Input value={p.title} onChange={(e) => onChange({ ...p, title: e.target.value })} placeholder="Title (e.g. VP Operations)" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={p.seniority} onChange={(e) => onChange({ ...p, seniority: e.target.value })} placeholder="Seniority" />
                <Input value={p.department} onChange={(e) => onChange({ ...p, department: e.target.value })} placeholder="Department" />
              </div>
            </>
          )}
        </div>
        {!ro && <Button size="icon" variant="ghost" className="text-rose-500 hover:bg-rose-50" onClick={onRemove} aria-label="Remove persona"><Trash2 className="h-4 w-4" /></Button>}
      </div>
      <div className="mt-3 space-y-3">
        <div><p className="mb-1 text-xs font-medium text-slate-500">Goals</p><Tags ro={ro} value={p.goals} onChange={(v) => onChange({ ...p, goals: v })} /></div>
        <div><p className="mb-1 text-xs font-medium text-slate-500">Pains</p><Tags ro={ro} value={p.pains} onChange={(v) => onChange({ ...p, pains: v })} /></div>
      </div>
    </div>
  );
}

export default function IcpPage() {
  const { cid, running, poke } = useCompanyCtx();
  const qc = useQueryClient();
  const activeQ = useQuery({ queryKey: qk.icp(cid), queryFn: () => api.icp(cid), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  const versionsQ = useQuery({ queryKey: qk.icpVersions(cid), queryFn: () => api.icpVersions(cid) });
  const versions = useMemo(() => [...(Array.isArray(versionsQ.data) ? versionsQ.data : [])].sort((a, b) => b.version - a.version), [versionsQ.data]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const active = activeQ.data ?? versions.find((v) => v.is_active) ?? null;
  const selected: ICPRecord | null = (selectedId && versions.find((v) => v.id === selectedId)) || active;
  const readOnly = !!selected && !!active && selected.id !== active.id;

  const [draft, setDraft] = useState<ICP | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (selected && !dirty) setDraft(normalizeIcp(selected.data));
  }, [selected?.id, selected?.version]);

  const save = useMutation({
    mutationFn: (d: ICP) => api.saveIcp(cid, d),
    onSuccess: (rec) => {
      setDirty(false); setSelectedId(null);
      qc.setQueryData(qk.icp(cid), rec);
      qc.invalidateQueries({ queryKey: qk.icpVersions(cid) });
      toast.success(`Saved as version ${rec?.version ?? ""}`.trim());
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const regen = useMutation({
    mutationFn: () => api.regenerateIcp(cid),
    onSuccess: () => { setDirty(false); poke(); toast.success("Regenerating ICP from your profile…"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (activeQ.isLoading) return <LoadingBlock label="Loading ICP…" />;
  if (!active && !versions.length) {
    if (activeQ.isError && !(activeQ.error instanceof ApiError && activeQ.error.status === 404)) return <ErrorState error={activeQ.error} onRetry={() => activeQ.refetch()} />;
    return <EmptyState icon={<Target className="h-6 w-6" />} title={running ? "ICP is being generated…" : "No ICP yet"}
      description="Your Ideal Customer Profile is generated from the company profile."
      action={!running && <Button onClick={() => regen.mutate()} loading={regen.isPending}><RefreshCw className="h-4 w-4" />Generate ICP</Button>} />;
  }
  if (!draft) return <LoadingBlock />;

  const update = (patch: Partial<ICP>) => { setDraft({ ...draft, ...patch }); setDirty(true); };
  const fg = draft.firmographics;
  const setFg = (patch: Partial<ICP["firmographics"]>) => update({ firmographics: { ...fg, ...patch } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">Version</span>
          <Select className="w-auto min-w-[220px]" value={selected?.id ?? ""} onChange={(e) => { if (dirty && !confirm("Discard unsaved changes?")) return; setDirty(false); setSelectedId(e.target.value); }}>
            {(versions.length ? versions : active ? [active] : []).map((v) => (
              <option key={v.id} value={v.id}>v{v.version} · {v.origin === "user" ? "edited" : "AI"} · {formatDate(v.created_at)}{v.is_active ? " (active)" : ""}</option>
            ))}
          </Select>
          {readOnly && <Badge tone="amber" icon={<Eye className="h-3 w-3" />}>Read-only older version</Badge>}
          {dirty && <Badge tone="brand">Unsaved changes</Badge>}
        </div>
        <div className="flex flex-wrap gap-2">
          {readOnly ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setSelectedId(null)}>Back to active</Button>
              <Button size="sm" variant="secondary" onClick={() => { setSelectedId(null); setDraft(normalizeIcp(selected!.data)); setDirty(true); }}><RotateCcw className="h-3.5 w-3.5" />Restore as new version</Button>
            </>
          ) : (
            <>
              {dirty && <Button size="sm" variant="ghost" onClick={() => { setDirty(false); setDraft(normalizeIcp(selected!.data)); }}>Discard</Button>}
              <Button size="sm" variant="outline" onClick={() => regen.mutate()} loading={regen.isPending} disabled={running}><RefreshCw className="h-3.5 w-3.5" />Regenerate</Button>
              <Button size="sm" onClick={() => save.mutate(draft)} loading={save.isPending} disabled={!dirty}><Save className="h-3.5 w-3.5" />Save</Button>
            </>
          )}
        </div>
      </div>

      <Section title="Summary" icon={<Target className="h-4 w-4" />}>
        {readOnly ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{draft.summary || "—"}</p>
          : <Textarea rows={4} value={draft.summary} onChange={(e) => update({ summary: e.target.value })} />}
      </Section>

      <Section title="Firmographics">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Industries"><Tags ro={readOnly} value={fg.industries} onChange={(v) => setFg({ industries: v })} /></Field>
          <Field label="Geographies"><Tags ro={readOnly} value={fg.geographies} onChange={(v) => setFg({ geographies: v })} /></Field>
          <Field label="Employee range"><Text ro={readOnly} value={fg.employee_range} onChange={(v) => setFg({ employee_range: v })} placeholder="e.g. 1,000–10,000" /></Field>
          <Field label="Revenue range"><Text ro={readOnly} value={fg.revenue_range} onChange={(v) => setFg({ revenue_range: v })} placeholder="e.g. $100M–$1B" /></Field>
          <Field label="Tech stack" className="md:col-span-2"><Tags ro={readOnly} value={fg.tech_stack} onChange={(v) => setFg({ tech_stack: v })} /></Field>
        </div>
      </Section>

      <Section title={`Personas (${draft.personas.length})`} icon={<UserRound className="h-4 w-4" />}
        actions={!readOnly && <Button size="sm" variant="outline" onClick={() => update({ personas: [...draft.personas, { title: "", seniority: "", department: "", goals: [], pains: [] }] })}><Plus className="h-3.5 w-3.5" />Add persona</Button>}>
        {draft.personas.length === 0 ? <p className="text-sm text-slate-400">No personas defined.</p> : (
          <div className="grid gap-3 md:grid-cols-2">
            {draft.personas.map((p, i) => (
              <PersonaCard key={i} p={p} ro={readOnly}
                onChange={(np) => update({ personas: draft.personas.map((x, j) => (j === i ? np : x)) })}
                onRemove={() => update({ personas: draft.personas.filter((_, j) => j !== i) })} />
            ))}
          </div>
        )}
      </Section>

      <Section title="Targeting">
        <div className="grid gap-5 md:grid-cols-2">
          {LISTS.map((l) => (
            <Field key={l.key} label={l.label} hint={!readOnly ? l.hint : undefined}>
              <Tags ro={readOnly} value={draft[l.key] as string[]} onChange={(v) => update({ [l.key]: v } as Partial<ICP>)} />
            </Field>
          ))}
        </div>
      </Section>
    </div>
  );
}

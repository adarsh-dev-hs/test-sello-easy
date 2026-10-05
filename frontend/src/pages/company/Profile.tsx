import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Box, Pencil, Plus, Quote, RefreshCw, Save, Trash2, UserSquare2 } from "lucide-react";
import { api, ApiError, errorMessage, type CompanyProfile, type Product } from "../../api";
import { qk } from "../../lib/hooks";
import { normalizeProfile } from "../../lib/utils";
import { Badge, Button, Card, CardHeader, ChipList, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, TagInput, Textarea } from "../../components/ui";
import { SourceKindIcon } from "../../components/domain";
import { useCompanyCtx } from "./CompanyLayout";

const LIST_FIELDS: { key: keyof CompanyProfile; label: string }[] = [
  { key: "value_propositions", label: "Value propositions" },
  { key: "differentiators", label: "Differentiators" },
  { key: "target_markets", label: "Target markets" },
  { key: "geographies", label: "Geographies" },
  { key: "customer_examples", label: "Customer examples" },
  { key: "competitors", label: "Competitors" },
];

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div><h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>{children}</div>;
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return <span className="text-sm text-slate-400">—</span>;
  return <ul className="space-y-1.5">{items.map((v, i) => <li key={i} className="flex gap-2 text-sm text-slate-700"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" />{v}</li>)}</ul>;
}

function ProductEditor({ products, onChange }: { products: Product[]; onChange: (p: Product[]) => void }) {
  const set = (i: number, patch: Partial<Product>) => onChange(products.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-3">
      {products.map((p, i) => (
        <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name"><Input value={p.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
            <Field label="Category"><Input value={p.category} onChange={(e) => set(i, { category: e.target.value })} /></Field>
          </div>
          <Field label="Description" className="mt-3"><Textarea rows={2} value={p.description} onChange={(e) => set(i, { description: e.target.value })} /></Field>
          <Field label="Key features" className="mt-3"><TagInput value={p.key_features} onChange={(v) => set(i, { key_features: v })} /></Field>
          <div className="mt-2 flex justify-end">
            <Button size="sm" variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => onChange(products.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" />Remove product</Button>
          </div>
        </div>
      ))}
      <Button size="sm" variant="outline" onClick={() => onChange([...products, { name: "", description: "", category: "", key_features: [] }])}><Plus className="h-3.5 w-3.5" />Add product</Button>
    </div>
  );
}

export default function ProfilePage() {
  const { cid, company, running, poke } = useCompanyCtx();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.profile(cid), queryFn: () => api.profile(cid), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1 });
  const srcQ = useQuery({ queryKey: qk.sources(cid), queryFn: () => api.sources(cid) });
  const [edit, setEdit] = useState<CompanyProfile | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const profile = useMemo(() => (q.data ? normalizeProfile(q.data) : company.profile ? normalizeProfile(company.profile) : null), [q.data, company.profile]);
  const srcById = useMemo(() => new Map((Array.isArray(srcQ.data) ? srcQ.data : []).map((s) => [s.id, s])), [srcQ.data]);

  const save = useMutation({
    mutationFn: (p: CompanyProfile) => api.saveProfile(cid, p),
    onSuccess: (p) => { qc.setQueryData(qk.profile(cid), p); qc.invalidateQueries({ queryKey: qk.company(cid) }); setEdit(null); toast.success("Profile saved"); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const rebuild = useMutation({
    mutationFn: () => api.runPipeline(cid, "ingest"),
    onSuccess: () => { setConfirmRebuild(false); poke(); toast.success("Rebuilding profile — the full pipeline will re-run"); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const actions = (
    <>
      <Button size="sm" variant="outline" onClick={() => setConfirmRebuild(true)} disabled={running}><RefreshCw className="h-3.5 w-3.5" />Rebuild profile</Button>
      {profile && <Button size="sm" onClick={() => setEdit(structuredClone(profile))}><Pencil className="h-3.5 w-3.5" />Edit</Button>}
    </>
  );

  const rebuildModal = (
    <Modal open={confirmRebuild} onClose={() => setConfirmRebuild(false)} size="sm" title="Rebuild profile?"
      description="This re-ingests the website and documents, then regenerates the profile, ICP, signals and leads."
      footer={<><Button variant="ghost" onClick={() => setConfirmRebuild(false)}>Cancel</Button><Button onClick={() => rebuild.mutate()} loading={rebuild.isPending}>Rebuild</Button></>}>
      {company.profile_edited ? <p className="text-sm text-amber-700">You’ve edited this profile manually. Depending on server settings, your edits may be kept or overwritten.</p> : <p className="text-sm text-slate-600">It usually takes a few minutes.</p>}
    </Modal>
  );

  if (q.isLoading) return <LoadingBlock label="Loading profile…" />;
  if (!profile) {
    if (q.isError && !(q.error instanceof ApiError && q.error.status === 404)) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
    return (
      <>
        <EmptyState icon={<UserSquare2 className="h-6 w-6" />} title={running ? "Profile is being built…" : "No profile yet"}
          description={running ? "We’re reading your website and documents." : "Run the pipeline to build a company profile from your website and documents."}
          action={!running && <Button onClick={() => setConfirmRebuild(true)}><RefreshCw className="h-4 w-4" />Build profile</Button>} />
        {rebuildModal}
      </>
    );
  }

  if (edit) {
    const set = <K extends keyof CompanyProfile>(k: K, v: CompanyProfile[K]) => setEdit({ ...edit, [k]: v });
    return (
      <Card>
        <CardHeader title="Edit company profile" description="Changes are saved as your version; AI rebuilds won’t silently overwrite them."
          actions={<><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button size="sm" onClick={() => save.mutate(edit)} loading={save.isPending}><Save className="h-3.5 w-3.5" />Save</Button></>} />
        <div className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name"><Input value={edit.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Industry"><Input value={edit.industry} onChange={(e) => set("industry", e.target.value)} /></Field>
          </div>
          <Field label="One-liner"><Input value={edit.one_liner} onChange={(e) => set("one_liner", e.target.value)} /></Field>
          <Field label="Description"><Textarea rows={5} value={edit.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label="Sub-industries"><TagInput value={edit.sub_industries} onChange={(v) => set("sub_industries", v)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pricing model"><Input value={edit.pricing_model ?? ""} onChange={(e) => set("pricing_model", e.target.value || null)} /></Field>
            <Field label="Company size hint"><Input value={edit.company_size_hint ?? ""} onChange={(e) => set("company_size_hint", e.target.value || null)} /></Field>
          </div>
          <Block title="Products"><ProductEditor products={edit.products} onChange={(v) => set("products", v)} /></Block>
          {LIST_FIELDS.map((f) => (
            <Field key={f.key} label={f.label}><TagInput value={edit[f.key] as string[]} onChange={(v) => set(f.key, v as never)} /></Field>
          ))}
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={() => save.mutate(edit)} loading={save.isPending}><Save className="h-4 w-4" />Save profile</Button>
          </div>
        </div>
      </Card>
    );
  }

  const p = profile;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={p.name || company.name} description={p.one_liner} actions={actions} />
        <div className="space-y-4 p-5">
          <div className="flex flex-wrap gap-2">
            {p.industry && <Badge tone="brand">{p.industry}</Badge>}
            {p.sub_industries.map((s, i) => <Badge key={i} tone="slate">{s}</Badge>)}
            {company.profile_edited && <Badge tone="amber">Edited by you</Badge>}
          </div>
          {p.description && <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{p.description}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Block title="Pricing model"><p className="text-sm text-slate-700">{p.pricing_model || <span className="text-slate-400">—</span>}</p></Block>
            <Block title="Company size"><p className="text-sm text-slate-700">{p.company_size_hint || <span className="text-slate-400">—</span>}</p></Block>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={`Products (${p.products.length})`} icon={<Box className="h-4 w-4" />} />
        <div className="p-5">
          {p.products.length === 0 ? <p className="text-sm text-slate-400">No products identified.</p> : (
            <div className="grid gap-3 md:grid-cols-2">
              {p.products.map((pr, i) => (
                <div key={i} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <h4 className="font-semibold text-slate-900">{pr.name || "Untitled product"}</h4>
                    {pr.category && <Badge tone="violet">{pr.category}</Badge>}
                  </div>
                  {pr.description && <p className="mt-1 text-sm text-slate-600">{pr.description}</p>}
                  {pr.key_features.length > 0 && <div className="mt-3"><ChipList items={pr.key_features} /></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5"><Block title="Value propositions"><BulletList items={p.value_propositions} /></Block></Card>
        <Card className="p-5"><Block title="Differentiators"><BulletList items={p.differentiators} /></Block></Card>
      </div>
      <Card className="grid gap-5 p-5 md:grid-cols-2">
        <Block title="Target markets"><ChipList items={p.target_markets} /></Block>
        <Block title="Geographies"><ChipList items={p.geographies} /></Block>
        <Block title="Customer examples"><ChipList items={p.customer_examples} /></Block>
        <Block title="Competitors"><ChipList items={p.competitors} /></Block>
      </Card>

      <Card>
        <CardHeader title={`Source citations (${p.source_citations.length})`} icon={<Quote className="h-4 w-4" />} description="Evidence from your website and documents backing each claim" />
        <div className="divide-y divide-slate-100">
          {p.source_citations.length === 0 && <p className="p-5 text-sm text-slate-400">No citations.</p>}
          {p.source_citations.map((c, i) => {
            const src = srcById.get(c.source_id);
            return (
              <div key={i} className="px-5 py-3">
                <p className="text-sm font-medium text-slate-800">{c.claim}</p>
                {c.quote && <p className="mt-1 border-l-2 border-brand-200 pl-3 text-sm italic text-slate-600">“{c.quote}”</p>}
                <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  <SourceKindIcon kind={src?.kind} className="h-3 w-3" />
                  <span className="truncate">{src ? src.filename || src.uri : c.source_id ? `source ${c.source_id.slice(0, 8)}` : "unknown source"}</span>
                </span>
              </div>
            );
          })}
        </div>
      </Card>
      {rebuildModal}
    </div>
  );
}

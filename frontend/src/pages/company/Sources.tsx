import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileStack, RefreshCw, Upload } from "lucide-react";
import { api, errorMessage } from "../../api";
import { qk } from "../../lib/hooks";
import { arr, formatDate, hostOf } from "../../lib/utils";
import { Badge, Button, Card, CardHeader, EmptyState, ErrorState, Modal, Skeleton } from "../../components/ui";
import { FileDropzone, SourceKindIcon } from "../../components/domain";
import { useCompanyCtx } from "./CompanyLayout";

export default function SourcesPage() {
  const { cid, running, poke } = useCompanyCtx();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: qk.sources(cid), queryFn: () => api.sources(cid),
    refetchInterval: (query) => (running || arr(query.state.data).some((s) => s.status === "pending") ? 3000 : false),
  });
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [reprocess, setReprocess] = useState(true);
  const upload = useMutation({
    mutationFn: async () => {
      const res = await api.uploadSources(cid, files);
      if (reprocess) await api.runPipeline(cid, "ingest");
      return res;
    },
    onSuccess: () => {
      toast.success(`Uploaded ${files.length} file${files.length > 1 ? "s" : ""}${reprocess ? " — rebuilding profile" : ""}`);
      setFiles([]); setOpen(false);
      qc.invalidateQueries({ queryKey: qk.sources(cid) });
      if (reprocess) poke();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = [...arr(q.data)].sort((a, b) => (a.kind === "website" ? 1 : 0) - (b.kind === "website" ? 1 : 0));
  const totalChars = list.reduce((n, s) => n + (s.chars ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader icon={<FileStack className="h-4 w-4" />} title={`Sources (${list.length})`}
          description={list.length ? `${totalChars.toLocaleString()} characters extracted` : "Website pages and documents used to build the profile"}
          actions={<>
            <Button size="sm" variant="ghost" onClick={() => q.refetch()} loading={q.isFetching && !q.isLoading}><RefreshCw className="h-3.5 w-3.5" /></Button>
            <Button size="sm" onClick={() => setOpen(true)}><Upload className="h-3.5 w-3.5" />Upload files</Button>
          </>} />
        {q.isLoading ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          : q.isError ? <div className="p-5"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>
          : list.length === 0 ? <div className="p-5"><EmptyState icon={<FileStack className="h-6 w-6" />} title="No sources yet" description="Sources appear after the website is crawled or files are uploaded." action={<Button onClick={() => setOpen(true)}><Upload className="h-4 w-4" />Upload files</Button>} /></div>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-5 py-2.5 font-medium">Source</th><th className="px-3 py-2.5 font-medium">Kind</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 text-right font-medium">Chars</th><th className="px-5 py-2.5 font-medium">Added</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {list.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="max-w-[360px] px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600"><SourceKindIcon kind={s.kind} /></span>
                          <div className="min-w-0">
                            {s.kind === "website" && s.uri
                              ? <a href={s.uri} target="_blank" rel="noreferrer" className="block truncate font-medium text-slate-900 hover:text-brand-700">{s.filename || s.uri.replace(/^https?:\/\//, "")}</a>
                              : <p className="truncate font-medium text-slate-900">{s.filename || s.uri || "Untitled"}</p>}
                            <p className="truncate text-xs text-slate-500">{s.kind === "website" ? hostOf(s.uri) : s.mime}</p>
                            {s.error && <p className="mt-0.5 text-xs text-rose-600">{s.error}</p>}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3"><Badge tone="slate">{s.kind}</Badge></td>
                      <td className="px-3 py-3"><Badge tone={s.status === "parsed" ? "green" : s.status === "failed" ? "red" : "amber"}>{s.status}</Badge></td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{s.chars != null ? s.chars.toLocaleString() : "—"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-slate-500">{formatDate(s.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>
      <Modal open={open} onClose={() => !upload.isPending && setOpen(false)} title="Upload more sources" size="lg"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)} disabled={upload.isPending}>Cancel</Button><Button onClick={() => upload.mutate()} loading={upload.isPending} disabled={!files.length}><Upload className="h-4 w-4" />Upload {files.length || ""}</Button></>}>
        <FileDropzone files={files} onChange={setFiles} disabled={upload.isPending} />
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={reprocess} onChange={(e) => setReprocess(e.target.checked)} disabled={running} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
          Re-run the pipeline afterwards (re-ingest and rebuild profile, ICP, signals, leads)
        </label>
      </Modal>
    </div>
  );
}

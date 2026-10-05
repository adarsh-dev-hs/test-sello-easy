import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLink, Phone, RefreshCw, Send, Sparkles } from "lucide-react";
import { api, DEMO_MODE, errorMessage, type CallOutcome, type Lead } from "../../api";
import { qk } from "../../lib/hooks";
import { Button, Field, Input, Select, Skeleton, Textarea } from "../../components/ui";
import { InlineError } from "../../components/domain";
import { Modal } from "../../components/ui";

function useAfterAction(lead: Lead, cid?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: qk.lead(lead.id) });
    if (cid) qc.invalidateQueries({ queryKey: qk.leads(cid) });
  };
}

function useDraft(lead: Lead, channel: "email" | "whatsapp", open: boolean) {
  const m = useMutation({ mutationFn: () => api.draft(lead.id, channel) });
  const { mutate, reset } = m;
  useEffect(() => {
    if (open) mutate();
    else reset();
  }, [open, lead.id, mutate, reset]);
  return m;
}

function DraftBadge({ loading, onRegenerate }: { loading: boolean; onRegenerate: () => void }) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-800">
      <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" />{loading ? "Drafting a personalised message from the lead’s signals…" : "AI draft — review and edit before sending."}</span>
      <Button size="sm" variant="ghost" className="h-7 text-violet-700 hover:bg-violet-100" onClick={onRegenerate} disabled={loading}>
        <RefreshCw className="h-3.5 w-3.5" />Redraft
      </Button>
    </div>
  );
}

export function EmailModal({ lead, cid, open, onClose }: { lead: Lead; cid?: string; open: boolean; onClose: () => void }) {
  const draft = useDraft(lead, "email", open);
  const after = useAfterAction(lead, cid);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  useEffect(() => { if (open) setTo(lead.email ?? ""); }, [open, lead.email]);
  useEffect(() => {
    if (draft.data) { setSubject(draft.data.subject ?? ""); setBody(draft.data.body ?? ""); }
  }, [draft.data]);
  const send = useMutation({
    mutationFn: () => api.sendEmail(lead.id, { to: to.trim(), subject, body }),
    onSuccess: () => { toast.success(DEMO_MODE ? "Logged — demo mode, no email was actually sent" : "Sent (view in Mailpit http://localhost:8025)"); after(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Email ${lead.contact_name || lead.org_name}`}
      description={[lead.contact_title, lead.org_name].filter(Boolean).join(" · ")}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!to.trim() || !body.trim() || draft.isPending}><Send className="h-4 w-4" />Send email</Button>
      </>}
    >
      <DraftBadge loading={draft.isPending} onRegenerate={() => draft.mutate()} />
      {draft.isError && <div className="mb-3"><InlineError>Couldn’t generate a draft: {errorMessage(draft.error)}. You can still write one.</InlineError></div>}
      <div className="space-y-3">
        <Field label="To"><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" /></Field>
        <Field label="Subject">{draft.isPending ? <Skeleton className="h-9" /> : <Input value={subject} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Message">{draft.isPending ? <Skeleton className="h-56" /> : <Textarea rows={12} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

const OUTCOMES: { v: CallOutcome; l: string }[] = [
  { v: "connected", l: "Connected" }, { v: "voicemail", l: "Left voicemail" }, { v: "no_answer", l: "No answer" }, { v: "wrong_number", l: "Wrong number" },
];
export function CallModal({ lead, cid, open, onClose }: { lead: Lead; cid?: string; open: boolean; onClose: () => void }) {
  const after = useAfterAction(lead, cid);
  const [outcome, setOutcome] = useState<CallOutcome>("connected");
  const [notes, setNotes] = useState("");
  useEffect(() => { if (open) { setOutcome("connected"); setNotes(""); } }, [open]);
  const log = useMutation({
    mutationFn: () => api.logCall(lead.id, { outcome, notes }),
    onSuccess: () => { toast.success("Call logged"); after(); onClose(); },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Modal open={open} onClose={onClose} title={`Call ${lead.contact_name || lead.org_name}`} description={[lead.contact_title, lead.org_name].filter(Boolean).join(" · ")}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => log.mutate()} loading={log.isPending}>Log call</Button></>}>
      <div className="space-y-4">
        {lead.phone ? (
          <a href={`tel:${lead.phone.replace(/[^\d+]/g, "")}`} className="flex items-center justify-between rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-brand-800 hover:bg-brand-100">
            <span className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-white"><Phone className="h-4 w-4" /></span>
              <span><span className="block text-lg font-semibold tabular-nums">{lead.phone}</span><span className="text-xs">Tap to call</span></span></span>
            <ExternalLink className="h-4 w-4" />
          </a>
        ) : (
          <InlineError>No phone number on file for this lead. You can still log a call outcome.</InlineError>
        )}
        <Field label="Outcome">
          <Select value={outcome} onChange={(e) => setOutcome(e.target.value as CallOutcome)}>
            {OUTCOMES.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
          </Select>
        </Field>
        <Field label="Notes"><Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you learn? Next steps?" /></Field>
      </div>
    </Modal>
  );
}

export function WhatsAppModal({ lead, cid, open, onClose }: { lead: Lead; cid?: string; open: boolean; onClose: () => void }) {
  const draft = useDraft(lead, "whatsapp", open);
  const after = useAfterAction(lead, cid);
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { if (open) setPhone(lead.phone ?? ""); }, [open, lead.phone]);
  useEffect(() => { if (draft.data) setMessage(draft.data.body ?? ""); }, [draft.data]);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    // Open the window synchronously so popup blockers allow it, then navigate it.
    const w = window.open("about:blank", "_blank");
    setBusy(true);
    try {
      const res = await api.whatsapp(lead.id, { phone: phone.trim(), message });
      if (res?.url) {
        if (w) { w.opener = null; w.location.href = res.url; } else window.open(res.url, "_blank", "noopener");
      } else w?.close();
      toast.success("WhatsApp opened and activity logged");
      after();
      onClose();
    } catch (e) {
      w?.close();
      toast.error(errorMessage(e));
    } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={`WhatsApp ${lead.contact_name || lead.org_name}`} description={[lead.contact_title, lead.org_name].filter(Boolean).join(" · ")}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="success" onClick={send} loading={busy} disabled={!phone.trim() || !message.trim() || draft.isPending}>Open in WhatsApp<ExternalLink className="h-4 w-4" /></Button></>}>
      <DraftBadge loading={draft.isPending} onRegenerate={() => draft.mutate()} />
      {draft.isError && <div className="mb-3"><InlineError>Couldn’t generate a draft: {errorMessage(draft.error)}</InlineError></div>}
      <div className="space-y-3">
        <Field label="Phone (international format)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+31 6 1234 5678" /></Field>
        <Field label="Message">{draft.isPending ? <Skeleton className="h-40" /> : <Textarea rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

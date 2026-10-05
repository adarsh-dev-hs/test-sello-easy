import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { Info } from "lucide-react";
import { api, errorMessage } from "../api";
import { useAuth } from "../lib/auth";
import { Button, Field, Input } from "../components/ui";
import { InlineError } from "../components/domain";
import { Logo } from "../components/AppShell";

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-600 to-violet-600 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="text-lg font-semibold">SelloQ</div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Turn the open web into a<br />pipeline of warm leads.</h2>
          <p className="mt-4 max-w-md text-brand-100">Upload your website and docs. SelloQ builds your company profile and ICP, watches for buying signals across the internet, and serves you leads with the evidence behind them.</p>
          <ul className="mt-8 space-y-2 text-sm text-brand-100">
            <li>• AI-built company profile & ICP</li>
            <li>• Signals across news, jobs, social and web</li>
            <li>• Explainable scores and one-click outreach</li>
          </ul>
        </div>
        <p className="text-xs text-brand-200">© SelloQ</p>
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
      </div>
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-8" />
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

function DemoHint() {
  return (
    <div className="mt-6 flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs text-brand-800">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>Demo: <b>demo@selloq.local</b> / <b>demo1234</b></span>
    </div>
  );
}

export function LoginPage() {
  const { signIn, isAuthed } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (isAuthed) return <Navigate to="/" replace />;
  const from = (loc.state as { from?: string } | null)?.from || "/";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      signIn(await api.login(email.trim(), password));
      nav(from, { replace: true });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to your SelloQ account">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
        <Field label="Password"><Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <InlineError>{err}</InlineError>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>Sign in</Button>
        <Button type="button" variant="outline" className="w-full" onClick={() => { setEmail("demo@selloq.local"); setPassword("demo1234"); }}>Use demo credentials</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">No account? <Link to="/register" className="font-medium text-brand-600 hover:underline">Create one</Link></p>
      <DemoHint />
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { signIn, isAuthed } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (isAuthed) return <Navigate to="/" replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      signIn(await api.register(email.trim(), password, name.trim()));
      nav("/", { replace: true });
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <AuthLayout title="Create your account" subtitle="Start finding signal-driven leads in minutes">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" /></Field>
        <Field label="Work email"><Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" /></Field>
        <Field label="Password" hint="At least 6 characters"><Input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        {err && <InlineError>{err}</InlineError>}
        <Button type="submit" className="w-full" size="lg" loading={busy}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">Already have an account? <Link to="/login" className="font-medium text-brand-600 hover:underline">Sign in</Link></p>
      <DemoHint />
    </AuthLayout>
  );
}

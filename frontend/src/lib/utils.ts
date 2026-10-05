import type { CompanyProfile, CompanyStatus, ICP } from "../api/types";

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

export const arr = <T,>(v: T[] | null | undefined): T[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(s);
  const fmt = (n: number, u: string) => `${n}${u} ${s >= 0 ? "ago" : "from now"}`;
  if (abs < 45) return "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  if (abs < 86400 * 30) return fmt(Math.round(abs / 86400), "d");
  if (abs < 86400 * 365) return fmt(Math.round(abs / (86400 * 30)), "mo");
  return fmt(Math.round(abs / (86400 * 365)), "y");
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function humanize(s: string | null | undefined): string {
  if (!s) return "";
  const t = s.replace(/[_-]+/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function hostOf(url: string | null | undefined): string {
  if (!url) return "";
  try { return new URL(url.includes("://") ? url : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return url; }
}

export function externalUrl(url: string): string {
  return url.includes("://") ? url : `https://${url}`;
}

export const RUNNING_STATUSES: CompanyStatus[] = ["ingesting", "profiling", "generating_icp", "generating_signals", "finding_leads"];
export const isRunningStatus = (s: CompanyStatus | undefined | null) => !!s && RUNNING_STATUSES.includes(s);
/** Poll while status is not a terminal/idle one. */
export const shouldPollStatus = (s: CompanyStatus | undefined | null) => !s || !["leads_ready", "failed", "draft"].includes(s);

export function normalizeProfile(p: Partial<CompanyProfile> | null | undefined): CompanyProfile {
  const x = p ?? {};
  return {
    name: str(x.name), one_liner: str(x.one_liner), description: str(x.description), industry: str(x.industry),
    sub_industries: arr(x.sub_industries).map(str),
    products: arr(x.products).map((pr) => ({
      name: str(pr?.name), description: str(pr?.description), category: str(pr?.category),
      key_features: arr(pr?.key_features).map(str),
    })),
    value_propositions: arr(x.value_propositions).map(str), differentiators: arr(x.differentiators).map(str),
    target_markets: arr(x.target_markets).map(str), geographies: arr(x.geographies).map(str),
    customer_examples: arr(x.customer_examples).map(str), competitors: arr(x.competitors).map(str),
    pricing_model: x.pricing_model ?? null, company_size_hint: x.company_size_hint ?? null,
    source_citations: arr(x.source_citations).map((c) => ({ source_id: str(c?.source_id), claim: str(c?.claim), quote: str(c?.quote) })),
  };
}

export function normalizeIcp(i: Partial<ICP> | null | undefined): ICP {
  const x = i ?? {};
  const f = (x.firmographics ?? {}) as Partial<ICP["firmographics"]>;
  return {
    summary: str(x.summary),
    firmographics: {
      industries: arr(f.industries).map(str), employee_range: str(f.employee_range), revenue_range: str(f.revenue_range),
      geographies: arr(f.geographies).map(str), tech_stack: arr(f.tech_stack).map(str),
    },
    personas: arr(x.personas).map((p) => ({
      title: str(p?.title), seniority: str(p?.seniority), department: str(p?.department),
      goals: arr(p?.goals).map(str), pains: arr(p?.pains).map(str),
    })),
    pain_points: arr(x.pain_points).map(str), buying_triggers: arr(x.buying_triggers).map(str),
    keywords: arr(x.keywords).map(str), negative_keywords: arr(x.negative_keywords).map(str),
    exclusions: arr(x.exclusions).map(str), disqualifiers: arr(x.disqualifiers).map(str),
  };
}

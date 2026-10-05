const TOKEN_KEY = "selloq.token";
const USER_KEY = "selloq.user";

/** VITE_DEMO_MODE=true → no backend: an in-browser mock API with sample data (see src/demo/mockApi.ts). */
export const DEMO_MODE: boolean = ["true", "1", "yes"].includes(String(import.meta.env.VITE_DEMO_MODE ?? "").toLowerCase());

export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") || "/api/v1";

export const tokenStore = {
  get: (): string | null => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* ignore */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ } },
  getUser: <T,>(): T | null => { try { const v = localStorage.getItem(USER_KEY); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  setUser: (u: unknown) => { try { localStorage.setItem(USER_KEY, JSON.stringify(u)); } catch { /* ignore */ } },
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

type Query = Record<string, string | number | boolean | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  let url = `${API_BASE}${path}`;
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) { onUnauthorized = fn; }

function extractDetail(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const d = (body as { detail: unknown }).detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) return d.map((x) => (x && typeof x === "object" && "msg" in x ? String((x as { msg: unknown }).msg) : String(x))).join("; ");
  }
  return fallback;
}

export async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData; auth?: boolean } = {}): Promise<T> {
  if (DEMO_MODE) {
    const { mockRequest } = await import("../demo/mockApi");
    return mockRequest<T>(method, path, { body: opts.body, query: opts.query, form: opts.form });
  }
  const headers: Record<string, string> = { Accept: "application/json" };
  const token = tokenStore.get();
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }

  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), { method, headers, body });
  } catch {
    throw new ApiError(0, "Network error — is the backend running?");
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) { try { data = JSON.parse(text); } catch { data = text; } }

  if (!res.ok) {
    if (res.status === 401 && opts.auth !== false) {
      tokenStore.clear();
      onUnauthorized?.();
    }
    throw new ApiError(res.status, extractDetail(data, `${res.status} ${res.statusText || "Request failed"}`));
  }
  return data as T;
}

export const http = {
  get: <T,>(p: string, query?: Query) => request<T>("GET", p, { query }),
  post: <T,>(p: string, body?: unknown) => request<T>("POST", p, { body: body ?? {} }),
  put: <T,>(p: string, body?: unknown) => request<T>("PUT", p, { body }),
  patch: <T,>(p: string, body?: unknown) => request<T>("PATCH", p, { body }),
  upload: <T,>(p: string, form: FormData) => request<T>("POST", p, { form }),
};

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

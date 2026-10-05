import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { shouldPollStatus } from "./utils";

export const qk = {
  workspaces: ["workspaces"] as const,
  company: (cid: string) => ["company", cid] as const,
  status: (cid: string) => ["status", cid] as const,
  sources: (cid: string) => ["sources", cid] as const,
  profile: (cid: string) => ["profile", cid] as const,
  icp: (cid: string) => ["icp", cid] as const,
  icpVersions: (cid: string) => ["icp-versions", cid] as const,
  signals: (cid: string) => ["signals", cid] as const,
  runs: (cid: string) => ["runs", cid] as const,
  leads: (cid: string) => ["leads", cid] as const,
  lead: (lid: string) => ["lead", lid] as const,
  mcp: ["mcp-servers"] as const,
};

// After a job is enqueued the backend status may lag behind; keep polling for a grace window.
const forceUntil = new Map<string, number>();

/** Polls pipeline status every 2s while the company is working (or shortly after a job was kicked off). */
export function useCompanyStatus(cid: string | undefined, keepAlive = false) {
  return useQuery({
    queryKey: qk.status(cid ?? ""),
    queryFn: () => api.status(cid!),
    enabled: !!cid,
    refetchInterval: (q) => {
      const cur = q.state.data?.status;
      if (keepAlive && cur !== "leads_ready" && cur !== "failed") return 2000;
      if ((forceUntil.get(cid ?? "") ?? 0) > Date.now()) return 2000;
      return shouldPollStatus(q.state.data?.status) ? 2000 : false;
    },
    retry: 1,
  });
}

/** Call after enqueuing a job to (re)start status polling. */
export function usePokeStatus(cid: string | undefined) {
  const qc = useQueryClient();
  return useCallback(() => {
    if (!cid) return;
    forceUntil.set(cid, Date.now() + 12000);
    qc.invalidateQueries({ queryKey: qk.status(cid) });
    qc.invalidateQueries({ queryKey: qk.runs(cid) });
  }, [cid, qc]);
}

export function useCompany(cid: string | undefined) {
  return useQuery({ queryKey: qk.company(cid ?? ""), queryFn: () => api.company(cid!), enabled: !!cid });
}

export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

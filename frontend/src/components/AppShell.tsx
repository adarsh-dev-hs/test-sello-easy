import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { ChevronDown, LayoutGrid, LogOut, Server, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { cn } from "../lib/utils";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold text-slate-900", className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-600 to-violet-600 text-white shadow-sm">
        <Sparkles className="h-4 w-4" />
      </span>
      SelloEasy
    </span>
  );
}

function UserMenu() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const name = user?.name || user?.email || "Account";
  const initials = name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials || "U"}</span>
        <span className="hidden max-w-[160px] truncate text-sm text-slate-700 sm:block">{name}</span>
        <ChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-56 animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="truncate text-sm font-medium text-slate-900">{user?.name || "—"}</p>
            <p className="truncate text-xs text-slate-500">{user?.email}</p>
          </div>
          <Link to="/" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><LayoutGrid className="h-4 w-4" />Workspaces</Link>
          <Link to="/settings/mcp" onClick={() => setOpen(false)} className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"><Server className="h-4 w-4" />Settings · MCP servers</Link>
          <button onClick={signOut} className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><LogOut className="h-4 w-4" />Sign out</button>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link to="/"><Logo /></Link>
            <nav className="hidden items-center gap-1 md:flex">
              <NavLink to="/" end className={({ isActive }) => cn("rounded-md px-3 py-1.5 text-sm", isActive ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:text-slate-900")}>Workspaces</NavLink>
              <NavLink to="/settings/mcp" className={({ isActive }) => cn("rounded-md px-3 py-1.5 text-sm", isActive ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:text-slate-900")}>MCP servers</NavLink>
            </nav>
          </div>
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}

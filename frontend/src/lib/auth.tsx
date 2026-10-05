import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { setUnauthorizedHandler, tokenStore } from "../api/client";
import type { Token, User } from "../api/types";

interface AuthCtx {
  user: User | null;
  isAuthed: boolean;
  signIn: (t: Token) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => tokenStore.get());
  const [user, setUser] = useState<User | null>(() => tokenStore.getUser<User>());
  const navigate = useNavigate();
  const qc = useQueryClient();

  const signOut = useCallback(() => {
    tokenStore.clear();
    setToken(null);
    setUser(null);
    qc.clear();
    navigate("/login", { replace: true });
  }, [navigate, qc]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      setUser(null);
      qc.clear();
      navigate("/login", { replace: true });
    });
  }, [navigate, qc]);

  const signIn = useCallback((t: Token) => {
    tokenStore.set(t.access_token);
    tokenStore.setUser(t.user);
    setToken(t.access_token);
    setUser(t.user);
  }, []);

  const value = useMemo(() => ({ user, isAuthed: !!token, signIn, signOut }), [user, token, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

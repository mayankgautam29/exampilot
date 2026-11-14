"use client";

import { create } from "zustand";
import { api, getToken, setToken } from "./api";
import type { components } from "./api-types";
import type { User } from "./types";

type LoginBody = components["schemas"]["LoginRequest"];

interface AuthState {
  user: User | null;
  loading: boolean;
  hydrate: () => Promise<void>;
  login: (email: string, password: string) => Promise<User>;
  logout: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: true,
  hydrate: async () => {
    if (!getToken()) return set({ user: null, loading: false });
    try {
      set({ user: await api<User>("/auth/me"), loading: false });
    } catch {
      setToken(null);
      set({ user: null, loading: false });
    }
  },
  login: async (email, password) => {
    const body: LoginBody = { email, password };
    const result = await api<{ token: string; user: User }>("/auth/login", { method: "POST", body });
    setToken(result.token);
    set({ user: result.user, loading: false });
    return result.user;
  },
  logout: () => {
    setToken(null);
    set({ user: null });
    window.location.href = "/login";
  },
}));

export function homeFor(role: User["role"]): string {
  return role === "admin" ? "/admin" : role === "faculty" ? "/faculty" : "/student";
}

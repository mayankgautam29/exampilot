"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { AiStatus, Catalogue, PlanDetail, PlanSummary } from "./types";

export function usePlans(status?: string) {
  return useQuery({ queryKey: ["plans", status ?? "all"], queryFn: () => api<PlanSummary[]>("/plans", { params: { status } }), refetchInterval: 15000 });
}

export function usePublished() {
  const query = usePlans();
  const published = query.data?.find((p) => p.status === "PUBLISHED");
  return { ...query, published };
}

export function useCatalogue() {
  return useQuery({ queryKey: ["catalogue"], queryFn: () => api<Catalogue>("/catalogue"), staleTime: 600000 });
}

export function usePlanDetail(id: number | undefined) {
  return useQuery({ queryKey: ["plan", id], queryFn: () => api<PlanDetail>(`/plans/${id}`), enabled: id !== undefined });
}

export function useAiStatus() {
  return useQuery({ queryKey: ["ai-status"], queryFn: () => api<AiStatus>("/agent/status"), refetchInterval: 30000 });
}

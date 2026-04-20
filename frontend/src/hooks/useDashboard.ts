"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getStats, getEPOs, getActivityFeed, getTodayStats, Stats, EPO, ActivityItem } from "@/lib/api";

export function useGetStats(supervisorId?: number): UseQueryResult<Stats, Error> {
  return useQuery<Stats, Error>({
    queryKey: ["stats", supervisorId],
    queryFn: () => getStats(supervisorId),
  });
}

export function useGetEPOs(status?: string, supervisorId?: number): UseQueryResult<EPO[], Error> {
  return useQuery<EPO[], Error>({
    queryKey: ["epos", status, supervisorId],
    queryFn: () => getEPOs(status, supervisorId),
  });
}

export function useActivityFeed(limit: number = 20, days: number = 7): UseQueryResult<{ feed: ActivityItem[]; total: number }, Error> {
  return useQuery<{ feed: ActivityItem[]; total: number }, Error>({
    queryKey: ["activity", limit, days],
    queryFn: () => getActivityFeed(limit, days),
  });
}

export function useTodayStats(): UseQueryResult<any, Error> {
  return useQuery<any, Error>({
    queryKey: ["todayStats"],
    queryFn: () => getTodayStats(),
  });
}

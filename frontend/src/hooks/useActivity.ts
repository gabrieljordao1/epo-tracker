"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getActivityFeed, getTodayStats, ActivityItem } from "@/lib/api";

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

"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getBuilderScores, getCommunityScores, getTrends, BuilderScore, CommunityScore, TrendWeek } from "@/lib/api";

export interface UseBuilderScoresOptions {
  sortBy?: string;
  days?: number;
}

export function useBuilderScores(options: UseBuilderScoresOptions = {}): UseQueryResult<BuilderScore[], Error> {
  return useQuery<BuilderScore[], Error>({
    queryKey: ["builders", options.sortBy, options.days],
    queryFn: () => getBuilderScores(options.sortBy, options.days),
  });
}

export interface UseCommunityScsoresOptions {
  days?: number;
}

export function useCommunityScores(options: UseCommunityScsoresOptions = {}): UseQueryResult<CommunityScore[], Error> {
  return useQuery<CommunityScore[], Error>({
    queryKey: ["communities", options.days],
    queryFn: () => getCommunityScores(options.days),
  });
}

export interface UseTrendsOptions {
  weeks?: number;
}

export function useTrends(options: UseTrendsOptions = {}): UseQueryResult<TrendWeek[], Error> {
  return useQuery<TrendWeek[], Error>({
    queryKey: ["trends", options.weeks],
    queryFn: () => getTrends(options.weeks),
  });
}

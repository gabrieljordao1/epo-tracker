"use client";

import { useQuery, useMutation, useQueryClient, UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getEPOs,
  getStats,
  updateEPO,
  sendFollowup,
  batchFollowup,
  backfillEPOAmounts,
  syncRecentGmail,
  EPO,
  Stats,
} from "@/lib/api";

export interface UseEPOsOptions {
  status?: string;
  supervisorId?: number;
}

export function useEPOs(options: UseEPOsOptions = {}): UseQueryResult<EPO[], Error> {
  return useQuery<EPO[], Error>({
    queryKey: ["epos", options.status, options.supervisorId],
    queryFn: () => getEPOs(options.status, options.supervisorId),
  });
}

export function useStats(supervisorId?: number): UseQueryResult<Stats, Error> {
  return useQuery<Stats, Error>({
    queryKey: ["stats", supervisorId],
    queryFn: () => getStats(supervisorId),
  });
}

export function useUpdateEPO(): UseMutationResult<EPO, Error, { id: number; updates: Partial<EPO> }> {
  const queryClient = useQueryClient();

  return useMutation<EPO, Error, { id: number; updates: Partial<EPO> }>({
    mutationFn: ({ id, updates }) => updateEPO(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epos"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useSendFollowup(): UseMutationResult<any, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<any, Error, number>({
    mutationFn: (epoId) => sendFollowup(epoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epos"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useBatchFollowup(): UseMutationResult<any, Error, void> {
  const queryClient = useQueryClient();

  return useMutation<any, Error, void>({
    mutationFn: () => batchFollowup(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epos"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

export function useBackfillEPOAmounts(): UseMutationResult<any, Error, void> {
  const queryClient = useQueryClient();

  return useMutation<any, Error, void>({
    mutationFn: () => backfillEPOAmounts(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epos"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useSyncRecentGmail(): UseMutationResult<any, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<any, Error, number>({
    mutationFn: (days) => syncRecentGmail(days),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["epos"] });
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
    },
  });
}

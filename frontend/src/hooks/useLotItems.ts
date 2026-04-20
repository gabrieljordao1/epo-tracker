"use client";

import { useQuery, useMutation, useQueryClient, UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import { getLotItems, createLotItem, updateLotItem, deleteLotItem, autoSplitLotItems, LotItem } from "@/lib/api";

export function useLotItems(epoId: number | null): UseQueryResult<LotItem[], Error> {
  return useQuery<LotItem[], Error>({
    queryKey: ["lotItems", epoId],
    queryFn: () => getLotItems(epoId!),
    enabled: !!epoId,
  });
}

export function useCreateLotItem(): UseMutationResult<LotItem, Error, { epoId: number; item: { lot_number: string; amount?: number; description?: string; notes?: string } }> {
  const queryClient = useQueryClient();
  return useMutation<LotItem, Error, { epoId: number; item: { lot_number: string; amount?: number; description?: string; notes?: string } }>({
    mutationFn: ({ epoId, item }) => createLotItem(epoId, item),
    onSuccess: (_, { epoId }) => {
      queryClient.invalidateQueries({ queryKey: ["lotItems", epoId] });
    },
  });
}

export function useUpdateLotItem(): UseMutationResult<LotItem, Error, { itemId: number; updates: Partial<LotItem>; epoId: number }> {
  const queryClient = useQueryClient();
  return useMutation<LotItem, Error, { itemId: number; updates: Partial<LotItem>; epoId: number }>({
    mutationFn: ({ itemId, updates }) => updateLotItem(itemId, updates),
    onSuccess: (_, { epoId }) => {
      queryClient.invalidateQueries({ queryKey: ["lotItems", epoId] });
    },
  });
}

export function useDeleteLotItem(): UseMutationResult<void, Error, { itemId: number; epoId: number }> {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { itemId: number; epoId: number }>({
    mutationFn: ({ itemId }) => deleteLotItem(itemId),
    onSuccess: (_, { epoId }) => {
      queryClient.invalidateQueries({ queryKey: ["lotItems", epoId] });
    },
  });
}

export function useAutoSplitLotItems(): UseMutationResult<LotItem[], Error, { epoId: number; force?: boolean }> {
  const queryClient = useQueryClient();
  return useMutation<LotItem[], Error, { epoId: number; force?: boolean }>({
    mutationFn: ({ epoId, force }) => autoSplitLotItems(epoId, force),
    onSuccess: (_, { epoId }) => {
      queryClient.invalidateQueries({ queryKey: ["lotItems", epoId] });
    },
  });
}

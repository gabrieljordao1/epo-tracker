"use client";

import { useQuery, useMutation, useQueryClient, UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getProfitSummary,
  createSubPayment,
  updateSubPayment,
  deleteSubPayment,
  SubPayment,
} from "@/lib/api";

export function useProfitSummary(): UseQueryResult<{ overview: any; epos: any[] }, Error> {
  return useQuery<{ overview: any; epos: any[] }, Error>({
    queryKey: ["profitSummary"],
    queryFn: () => getProfitSummary(),
  });
}

export function useCreateSubPayment(): UseMutationResult<SubPayment, Error, any> {
  const queryClient = useQueryClient();

  return useMutation<SubPayment, Error, any>({
    mutationFn: (payment) => createSubPayment(payment),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profitSummary"] });
    },
  });
}

export function useUpdateSubPayment(): UseMutationResult<SubPayment, Error, { id: number; updates: Partial<SubPayment> }> {
  const queryClient = useQueryClient();

  return useMutation<SubPayment, Error, { id: number; updates: Partial<SubPayment> }>({
    mutationFn: ({ id, updates }) => updateSubPayment(id, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profitSummary"] });
    },
  });
}

export function useDeleteSubPayment(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (id) => deleteSubPayment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profitSummary"] });
    },
  });
}

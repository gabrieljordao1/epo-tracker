"use client";

import { useQuery, useMutation, useQueryClient, UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getBudgetOverview,
  getBudgetTrends,
  createBudget,
  updateBudget,
  deleteBudget,
  CommunityBudget,
  BudgetOverview,
  BudgetTrendMonth,
} from "@/lib/api";

export function useGetBudgetOverview(): UseQueryResult<BudgetOverview, Error> {
  return useQuery<BudgetOverview, Error>({
    queryKey: ["budgetOverview"],
    queryFn: () => getBudgetOverview(),
  });
}

export function useGetBudgetTrends(community: string): UseQueryResult<BudgetTrendMonth[], Error> {
  return useQuery<BudgetTrendMonth[], Error>({
    queryKey: ["budgetTrends", community],
    queryFn: () => getBudgetTrends(community),
  });
}

export function useCreateBudget(): UseMutationResult<CommunityBudget, Error, Partial<CommunityBudget>> {
  const queryClient = useQueryClient();

  return useMutation<CommunityBudget, Error, Partial<CommunityBudget>>({
    mutationFn: (data) => createBudget(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgetOverview"] });
    },
  });
}

export function useUpdateBudget(): UseMutationResult<CommunityBudget, Error, { id: number; data: Partial<CommunityBudget> }> {
  const queryClient = useQueryClient();

  return useMutation<CommunityBudget, Error, { id: number; data: Partial<CommunityBudget> }>({
    mutationFn: ({ id, data }) => updateBudget(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgetOverview"] });
    },
  });
}

export function useDeleteBudget(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (id) => deleteBudget(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgetOverview"] });
    },
  });
}

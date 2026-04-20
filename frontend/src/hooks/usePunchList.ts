"use client";

import { useQuery, useMutation, useQueryClient, UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getPunchItems,
  getPunchSummary,
  getPunchItem,
  createPunchItem,
  updatePunchItem,
  completePunchItem,
  verifyPunchItem,
  assignPunchItem,
  deletePunchItem,
  getPunchByLot,
  PunchItem,
  PunchSummary,
} from "@/lib/api";

export interface UseGetPunchItemsOptions {
  community?: string;
  lot_number?: string;
  status?: string;
  priority?: string;
  category?: string;
  assigned_to_id?: number;
  page?: number;
  per_page?: number;
}

export function useGetPunchItems(options: UseGetPunchItemsOptions = {}): UseQueryResult<
  { items: PunchItem[]; total: number; page: number; per_page: number },
  Error
> {
  return useQuery<{ items: PunchItem[]; total: number; page: number; per_page: number }, Error>({
    queryKey: ["punchItems", options],
    queryFn: () => getPunchItems(options),
  });
}

export function useGetPunchItem(id: number): UseQueryResult<PunchItem, Error> {
  return useQuery<PunchItem, Error>({
    queryKey: ["punchItem", id],
    queryFn: () => getPunchItem(id),
  });
}

export function useGetPunchSummary(): UseQueryResult<PunchSummary, Error> {
  return useQuery<PunchSummary, Error>({
    queryKey: ["punchSummary"],
    queryFn: () => getPunchSummary(),
  });
}

export function useGetPunchByLot(community: string, lot_number: string): UseQueryResult<{ items: PunchItem[] }, Error> {
  return useQuery<{ items: PunchItem[] }, Error>({
    queryKey: ["punchByLot", community, lot_number],
    queryFn: () => getPunchByLot(community, lot_number),
  });
}

export function useCreatePunchItem(): UseMutationResult<PunchItem, Error, Partial<PunchItem>> {
  const queryClient = useQueryClient();

  return useMutation<PunchItem, Error, Partial<PunchItem>>({
    mutationFn: (data) => createPunchItem(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["punchItems"] });
      queryClient.invalidateQueries({ queryKey: ["punchSummary"] });
    },
  });
}

export function useUpdatePunchItem(): UseMutationResult<PunchItem, Error, { id: number; data: Partial<PunchItem> }> {
  const queryClient = useQueryClient();

  return useMutation<PunchItem, Error, { id: number; data: Partial<PunchItem> }>({
    mutationFn: ({ id, data }) => updatePunchItem(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["punchItems"] });
      queryClient.invalidateQueries({ queryKey: ["punchItem", data.id] });
      queryClient.invalidateQueries({ queryKey: ["punchSummary"] });
    },
  });
}

export function useCompletePunchItem(): UseMutationResult<PunchItem, Error, { id: number; data?: any }> {
  const queryClient = useQueryClient();

  return useMutation<PunchItem, Error, { id: number; data?: any }>({
    mutationFn: ({ id, data }) => completePunchItem(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["punchItems"] });
      queryClient.invalidateQueries({ queryKey: ["punchItem", data.id] });
      queryClient.invalidateQueries({ queryKey: ["punchSummary"] });
    },
  });
}

export function useVerifyPunchItem(): UseMutationResult<PunchItem, Error, { id: number; approved: boolean; notes?: string }> {
  const queryClient = useQueryClient();

  return useMutation<PunchItem, Error, { id: number; approved: boolean; notes?: string }>({
    mutationFn: ({ id, approved, notes }) => verifyPunchItem(id, approved, notes),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["punchItems"] });
      queryClient.invalidateQueries({ queryKey: ["punchItem", data.id] });
      queryClient.invalidateQueries({ queryKey: ["punchSummary"] });
    },
  });
}

export function useAssignPunchItem(): UseMutationResult<PunchItem, Error, { id: number; assigned_to_id: number }> {
  const queryClient = useQueryClient();

  return useMutation<PunchItem, Error, { id: number; assigned_to_id: number }>({
    mutationFn: ({ id, assigned_to_id }) => assignPunchItem(id, assigned_to_id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["punchItems"] });
      queryClient.invalidateQueries({ queryKey: ["punchItem", data.id] });
      queryClient.invalidateQueries({ queryKey: ["punchSummary"] });
    },
  });
}

export function useDeletePunchItem(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (id) => deletePunchItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["punchItems"] });
      queryClient.invalidateQueries({ queryKey: ["punchSummary"] });
    },
  });
}

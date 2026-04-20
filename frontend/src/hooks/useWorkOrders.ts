"use client";

import { useQuery, useMutation, useQueryClient, UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getWorkOrders,
  getWorkOrderSummary,
  getWeekSchedule,
  createWorkOrder,
  updateWorkOrder,
  assignWorkOrder,
  startWorkOrder,
  completeWorkOrder,
  holdWorkOrder,
  cancelWorkOrder,
  deleteWorkOrder,
  WorkOrder,
  WorkOrderSummary,
  WeekSchedule,
} from "@/lib/api";

export interface UseGetWorkOrdersOptions {
  community?: string;
  status?: string;
  priority?: string;
  work_type?: string;
  assigned_to_id?: number;
  page?: number;
  per_page?: number;
}

export function useGetWorkOrders(options: UseGetWorkOrdersOptions = {}): UseQueryResult<
  { orders: WorkOrder[]; total: number; page: number; per_page: number },
  Error
> {
  return useQuery<{ orders: WorkOrder[]; total: number; page: number; per_page: number }, Error>({
    queryKey: ["workOrders", options],
    queryFn: () => getWorkOrders(options),
  });
}

export function useGetWorkOrderSummary(): UseQueryResult<WorkOrderSummary, Error> {
  return useQuery<WorkOrderSummary, Error>({
    queryKey: ["workOrderSummary"],
    queryFn: () => getWorkOrderSummary(),
  });
}

export function useGetWeekSchedule(weekStart?: string): UseQueryResult<WeekSchedule, Error> {
  return useQuery<WeekSchedule, Error>({
    queryKey: ["weekSchedule", weekStart],
    queryFn: () => getWeekSchedule(weekStart),
  });
}

export function useCreateWorkOrder(): UseMutationResult<WorkOrder, Error, Partial<WorkOrder>> {
  const queryClient = useQueryClient();

  return useMutation<WorkOrder, Error, Partial<WorkOrder>>({
    mutationFn: (data) => createWorkOrder(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
      queryClient.invalidateQueries({ queryKey: ["weekSchedule"] });
    },
  });
}

export function useUpdateWorkOrder(): UseMutationResult<WorkOrder, Error, { id: number; data: Partial<WorkOrder> }> {
  const queryClient = useQueryClient();

  return useMutation<WorkOrder, Error, { id: number; data: Partial<WorkOrder> }>({
    mutationFn: ({ id, data }) => updateWorkOrder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
      queryClient.invalidateQueries({ queryKey: ["weekSchedule"] });
    },
  });
}

export function useAssignWorkOrder(): UseMutationResult<WorkOrder, Error, { id: number; assigned_to_id: number }> {
  const queryClient = useQueryClient();

  return useMutation<WorkOrder, Error, { id: number; assigned_to_id: number }>({
    mutationFn: ({ id, assigned_to_id }) => assignWorkOrder(id, assigned_to_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
    },
  });
}

export function useStartWorkOrder(): UseMutationResult<WorkOrder, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<WorkOrder, Error, number>({
    mutationFn: (id) => startWorkOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
      queryClient.invalidateQueries({ queryKey: ["weekSchedule"] });
    },
  });
}

export function useCompleteWorkOrder(): UseMutationResult<WorkOrder, Error, { id: number; data?: any }> {
  const queryClient = useQueryClient();

  return useMutation<WorkOrder, Error, { id: number; data?: any }>({
    mutationFn: ({ id, data }) => completeWorkOrder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
      queryClient.invalidateQueries({ queryKey: ["weekSchedule"] });
    },
  });
}

export function useHoldWorkOrder(): UseMutationResult<WorkOrder, Error, { id: number; reason?: string }> {
  const queryClient = useQueryClient();

  return useMutation<WorkOrder, Error, { id: number; reason?: string }>({
    mutationFn: ({ id, reason }) => holdWorkOrder(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
    },
  });
}

export function useCancelWorkOrder(): UseMutationResult<WorkOrder, Error, { id: number; reason?: string }> {
  const queryClient = useQueryClient();

  return useMutation<WorkOrder, Error, { id: number; reason?: string }>({
    mutationFn: ({ id, reason }) => cancelWorkOrder(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
    },
  });
}

export function useDeleteWorkOrder(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (id) => deleteWorkOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workOrders"] });
      queryClient.invalidateQueries({ queryKey: ["workOrderSummary"] });
      queryClient.invalidateQueries({ queryKey: ["weekSchedule"] });
    },
  });
}

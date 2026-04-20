"use client";

import { useQuery, useMutation, useQueryClient, UseQueryResult, UseMutationResult } from "@tanstack/react-query";
import {
  getDailyReports,
  getDailyReportSummary,
  getDailyReport,
  createDailyReport,
  updateDailyReport,
  submitDailyReport,
  deleteDailyReport,
  DailyReport,
  DailyReportSummary,
} from "@/lib/api";

export interface UseGetDailyReportsOptions {
  community?: string;
  date_from?: string;
  date_to?: string;
  status?: string;
  page?: number;
  per_page?: number;
}

export function useGetDailyReports(options: UseGetDailyReportsOptions = {}): UseQueryResult<
  { reports: DailyReport[]; total: number; page: number; per_page: number },
  Error
> {
  return useQuery<{ reports: DailyReport[]; total: number; page: number; per_page: number }, Error>({
    queryKey: ["dailyReports", options],
    queryFn: () => getDailyReports(options),
  });
}

export function useGetDailyReportSummary(): UseQueryResult<DailyReportSummary, Error> {
  return useQuery<DailyReportSummary, Error>({
    queryKey: ["dailyReportSummary"],
    queryFn: () => getDailyReportSummary(),
  });
}

export function useGetDailyReport(id: number): UseQueryResult<DailyReport, Error> {
  return useQuery<DailyReport, Error>({
    queryKey: ["dailyReport", id],
    queryFn: () => getDailyReport(id),
  });
}

export function useCreateDailyReport(): UseMutationResult<DailyReport, Error, Partial<DailyReport>> {
  const queryClient = useQueryClient();

  return useMutation<DailyReport, Error, Partial<DailyReport>>({
    mutationFn: (data) => createDailyReport(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dailyReports"] });
      queryClient.invalidateQueries({ queryKey: ["dailyReportSummary"] });
    },
  });
}

export function useUpdateDailyReport(): UseMutationResult<DailyReport, Error, { id: number; data: Partial<DailyReport> }> {
  const queryClient = useQueryClient();

  return useMutation<DailyReport, Error, { id: number; data: Partial<DailyReport> }>({
    mutationFn: ({ id, data }) => updateDailyReport(id, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dailyReports"] });
      queryClient.invalidateQueries({ queryKey: ["dailyReport", data.id] });
      queryClient.invalidateQueries({ queryKey: ["dailyReportSummary"] });
    },
  });
}

export function useSubmitDailyReport(): UseMutationResult<DailyReport, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<DailyReport, Error, number>({
    mutationFn: (id) => submitDailyReport(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["dailyReports"] });
      queryClient.invalidateQueries({ queryKey: ["dailyReport", data.id] });
      queryClient.invalidateQueries({ queryKey: ["dailyReportSummary"] });
    },
  });
}

export function useDeleteDailyReport(): UseMutationResult<void, Error, number> {
  const queryClient = useQueryClient();

  return useMutation<void, Error, number>({
    mutationFn: (id) => deleteDailyReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dailyReports"] });
      queryClient.invalidateQueries({ queryKey: ["dailyReportSummary"] });
    },
  });
}

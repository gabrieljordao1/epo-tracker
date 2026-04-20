"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getTeamMembers } from "@/lib/api";

export function useTeamMembers(): UseQueryResult<any, Error> {
  return useQuery<any, Error>({
    queryKey: ["teamMembers"],
    queryFn: () => getTeamMembers(),
  });
}

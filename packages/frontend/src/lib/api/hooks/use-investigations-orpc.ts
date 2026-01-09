'use client'

/**
 * Investigation hooks using oRPC client
 *
 * Type-safe hooks for investigation operations using oRPC with TanStack Query.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '../orpc-client'
import type { InvestigationQuery } from '@prismalens/contracts'

/**
 * Query key factory for investigations
 */
export const investigationKeys = {
  all: () => orpc.investigations.key(),
  lists: () => orpc.investigations.list.key(),
  list: (filters: Partial<InvestigationQuery>) => orpc.investigations.list.key({ input: filters }),
  detail: (id: string) => orpc.investigations.get.key({ input: { id } }),
  status: (id: string) => orpc.investigations.getStatus.key({ input: { id } }),
  byIncident: (incidentId: string) => orpc.investigations.list.key({ input: { incidentId } }),
}

/**
 * Fetch list of investigations with optional filters
 */
export function useInvestigations(params?: Partial<InvestigationQuery>) {
  return useQuery(
    orpc.investigations.list.queryOptions({
      input: params ?? {},
    })
  )
}

/**
 * Fetch a single investigation by ID
 */
export function useInvestigation(id: string) {
  return useQuery({
    ...orpc.investigations.get.queryOptions({
      input: { id },
    }),
    enabled: !!id,
  })
}

/**
 * Fetch investigation status with polling
 */
export function useInvestigationStatus(id: string, options?: { refetchInterval?: number }) {
  return useQuery({
    ...orpc.investigations.getStatus.queryOptions({
      input: { id },
    }),
    enabled: !!id,
    refetchInterval: options?.refetchInterval,
  })
}

/**
 * Fetch investigations for a specific incident
 */
export function useInvestigationsByIncident(incidentId: string) {
  return useQuery({
    ...orpc.investigations.list.queryOptions({
      input: { incidentId },
    }),
    enabled: !!incidentId,
  })
}

/**
 * Create (start) a new investigation
 */
export function useCreateInvestigation() {
  const queryClient = useQueryClient()

  return useMutation({
    ...orpc.investigations.create.mutationOptions(),
    onSuccess: (investigation) => {
      queryClient.invalidateQueries({ queryKey: investigationKeys.lists() })
      if (investigation.incidentId) {
        queryClient.invalidateQueries({
          queryKey: investigationKeys.byIncident(investigation.incidentId),
        })
      }
    },
  })
}

/**
 * Cancel an investigation
 */
export function useCancelInvestigation() {
  const queryClient = useQueryClient()

  return useMutation({
    ...orpc.investigations.cancel.mutationOptions(),
    onSuccess: (investigation) => {
      queryClient.invalidateQueries({ queryKey: investigationKeys.lists() })
      queryClient.setQueryData(investigationKeys.detail(investigation.id), investigation)
    },
  })
}

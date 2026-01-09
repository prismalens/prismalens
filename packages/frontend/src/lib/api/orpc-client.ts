/**
 * oRPC Client for PrismaLens Frontend
 *
 * Provides type-safe API calls using oRPC contracts.
 * Integrates with TanStack Query for data fetching.
 */
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import type { ContractRouterClient } from '@orpc/contract'
import type { Contract } from '@prismalens/contracts'

// API base URL - uses Next.js proxy in development
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api'

/**
 * Custom error class for connection errors
 */
export class ConnectionError extends Error {
  constructor(message: string = 'Unable to connect to API server') {
    super(message)
    this.name = 'ConnectionError'
  }
}

/**
 * RPC Link for oRPC client
 * Configured to work with the PrismaLens API
 */
const link = new RPCLink({
  url: API_BASE_URL,
  headers: () => ({
    'Content-Type': 'application/json',
  }),
  fetch: async (input, init) => {
    try {
      const response = await fetch(input, {
        ...init,
        credentials: 'include', // Send cookies for authentication
      })

      // Handle gateway errors as connection errors
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new ConnectionError('API server is unavailable')
      }

      return response
    } catch (error) {
      // Network errors (fetch throws TypeError for network failures)
      if (error instanceof TypeError) {
        throw new ConnectionError()
      }
      throw error
    }
  },
})

/**
 * Type-safe oRPC client
 * Use this for direct API calls when not using TanStack Query
 */
export const client: ContractRouterClient<Contract> = createORPCClient(link)

/**
 * TanStack Query utilities for oRPC
 * Use this with useQuery, useMutation, etc.
 *
 * @example
 * ```tsx
 * import { useQuery } from '@tanstack/react-query'
 * import { orpc } from '@/lib/api/orpc-client'
 *
 * function AlertsList() {
 *   const { data, isLoading } = useQuery(
 *     orpc.alerts.list.queryOptions({
 *       input: { limit: 20 }
 *     })
 *   )
 *   // ...
 * }
 * ```
 */
export const orpc = createTanstackQueryUtils(client)

// Re-export types for convenience
export type { Contract } from '@prismalens/contracts'

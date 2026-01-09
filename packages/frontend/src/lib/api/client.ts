/**
 * Generic API Client for PrismaLens Frontend
 *
 * Provides simple HTTP utilities for API calls.
 * For type-safe oRPC calls, use the orpc-client instead.
 */

// API base URL - uses Vite proxy in development
const API_BASE_URL = '/api'

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
    constructor(
        message: string,
        public status: number,
        public data?: unknown
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi<T>(
    url: string,
    options?: RequestInit
): Promise<T> {
    const response = await fetch(`${API_BASE_URL}${url}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...options?.headers,
        },
    })

    if (!response.ok) {
        const data = await response.json().catch(() => null)
        throw new ApiError(
            data?.message || `HTTP ${response.status}`,
            response.status,
            data
        )
    }

    return response.json()
}

/**
 * GET request
 */
export async function apiGet<T>(url: string): Promise<T> {
    return fetchApi<T>(url, { method: 'GET' })
}

/**
 * POST request
 */
export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
    return fetchApi<T>(url, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
    })
}

/**
 * PATCH request
 */
export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
    return fetchApi<T>(url, {
        method: 'PATCH',
        body: body ? JSON.stringify(body) : undefined,
    })
}

/**
 * DELETE request
 */
export async function apiDelete<T>(url: string): Promise<T> {
    return fetchApi<T>(url, { method: 'DELETE' })
}

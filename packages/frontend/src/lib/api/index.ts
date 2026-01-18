/**
 * API client exports
 *
 * NOTE: Most API calls now use oRPC hooks from @/lib/api/hooks/
 * This file exports the low-level client utilities for any remaining manual API calls.
 */

// Client utilities
export { ApiError, apiDelete, apiGet, apiPatch, apiPost } from "./client";

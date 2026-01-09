'use client';

/**
 * License Context
 *
 * React context for license state management.
 * Provides hooks for checking features, tiers, and quotas.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiDelete } from '../api/client';
import {
  LICENSE_TIERS,
  LICENSE_TYPES,
  TIER_ORDER,
  UNLIMITED_QUOTA,
  type LicenseFeature,
  type LicenseTierType,
} from './constants';
import type {
  LicenseStatus,
  LicenseContextValue,
  ActivateLicenseRequest,
  ActivateLicenseResponse,
} from './types';

// =============================================================================
// CONTEXT
// =============================================================================

const LicenseContext = createContext<LicenseContextValue | null>(null);

// =============================================================================
// QUERY KEYS
// =============================================================================

export const licenseQueryKeys = {
  all: ['license'] as const,
  status: () => [...licenseQueryKeys.all, 'status'] as const,
};

// =============================================================================
// API FUNCTIONS
// =============================================================================

async function fetchLicenseStatus(): Promise<LicenseStatus> {
  return apiGet<LicenseStatus>('/license');
}

async function activateLicenseApi(
  data: ActivateLicenseRequest
): Promise<ActivateLicenseResponse> {
  return apiPost<ActivateLicenseResponse, ActivateLicenseRequest>(
    '/license/activate',
    data
  );
}

async function deactivateLicenseApi(): Promise<void> {
  return apiDelete('/license');
}

async function refreshLicenseApi(): Promise<LicenseStatus> {
  return apiPost<LicenseStatus>('/license/refresh');
}

// =============================================================================
// PROVIDER
// =============================================================================

interface LicenseProviderProps {
  children: React.ReactNode;
}

export function LicenseProvider({ children }: LicenseProviderProps) {
  const queryClient = useQueryClient();

  // Fetch license status
  const {
    data: licenseData,
    isLoading,
    error,
  } = useQuery({
    queryKey: licenseQueryKeys.status(),
    queryFn: fetchLicenseStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });

  // Activate license mutation
  const activateMutation = useMutation({
    mutationFn: activateLicenseApi,
    onSuccess: (result) => {
      if (result.success && result.license) {
        queryClient.setQueryData(licenseQueryKeys.status(), result.license);
      }
    },
  });

  // Deactivate license mutation
  const deactivateMutation = useMutation({
    mutationFn: deactivateLicenseApi,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: licenseQueryKeys.status() });
    },
  });

  // Refresh license mutation
  const refreshMutation = useMutation({
    mutationFn: refreshLicenseApi,
    onSuccess: (data) => {
      queryClient.setQueryData(licenseQueryKeys.status(), data);
    },
  });

  // Helper: Check if feature is available
  const hasFeature = useCallback(
    (feature: LicenseFeature): boolean => {
      if (!licenseData) return false;
      return licenseData.features.includes(feature);
    },
    [licenseData]
  );

  // Helper: Check if tier meets requirement
  const hasTier = useCallback(
    (requiredTier: LicenseTierType): boolean => {
      if (!licenseData) return false;

      const currentIndex = TIER_ORDER.indexOf(licenseData.tier as LicenseTierType);
      const requiredIndex = TIER_ORDER.indexOf(requiredTier);

      return currentIndex >= requiredIndex;
    },
    [licenseData]
  );

  // Helper: Get quota value
  const getQuota = useCallback(
    (quotaKey: string): number => {
      if (!licenseData) return 0;
      return licenseData.quotas[quotaKey] ?? 0;
    },
    [licenseData]
  );

  // Helper: Check if quota is unlimited
  const isQuotaUnlimited = useCallback(
    (quotaKey: string): boolean => {
      return getQuota(quotaKey) === UNLIMITED_QUOTA;
    },
    [getQuota]
  );

  // Action: Refresh license
  const refreshLicense = useCallback(async () => {
    await refreshMutation.mutateAsync();
  }, [refreshMutation]);

  // Action: Activate license
  const activateLicense = useCallback(
    async (licenseKey: string) => {
      const result = await activateMutation.mutateAsync({ licenseKey });
      return {
        success: result.success,
        error: result.error,
      };
    },
    [activateMutation]
  );

  // Action: Deactivate license
  const deactivateLicense = useCallback(async () => {
    await deactivateMutation.mutateAsync();
  }, [deactivateMutation]);

  // Build context value
  const contextValue = useMemo<LicenseContextValue>(() => {
    const defaultState: LicenseContextValue = {
      // Loading state
      isLoading,
      error: error as Error | null,

      // License info (defaults)
      status: licenseData?.status ?? 'none',
      tier: (licenseData?.tier ?? LICENSE_TIERS.FREE) as LicenseTierType,
      licenseType: licenseData?.licenseType ?? LICENSE_TYPES.NONE,
      features: licenseData?.features ?? [],
      quotas: licenseData?.quotas ?? {},
      expiresAt: licenseData?.expiresAt
        ? new Date(licenseData.expiresAt)
        : null,
      isReadOnly: licenseData?.isReadOnly ?? false,

      // Customer info
      customerEmail: licenseData?.customer?.email,
      customerName: licenseData?.customer?.name,

      // Helpers
      hasFeature,
      hasTier,
      getQuota,
      isQuotaUnlimited,

      // Actions
      refreshLicense,
      activateLicense,
      deactivateLicense,
    };

    return defaultState;
  }, [
    isLoading,
    error,
    licenseData,
    hasFeature,
    hasTier,
    getQuota,
    isQuotaUnlimited,
    refreshLicense,
    activateLicense,
    deactivateLicense,
  ]);

  return (
    <LicenseContext.Provider value={contextValue}>
      {children}
    </LicenseContext.Provider>
  );
}

// =============================================================================
// HOOKS
// =============================================================================

/**
 * Hook to access license context
 */
export function useLicense(): LicenseContextValue {
  const context = useContext(LicenseContext);

  if (!context) {
    throw new Error('useLicense must be used within a LicenseProvider');
  }

  return context;
}

/**
 * Hook to check if a feature is available
 */
export function useHasFeature(feature: LicenseFeature): boolean {
  const { hasFeature, isLoading } = useLicense();

  // While loading, return false (conservative)
  if (isLoading) return false;

  return hasFeature(feature);
}

/**
 * Hook to check if tier meets requirement
 */
export function useHasTier(requiredTier: LicenseTierType): boolean {
  const { hasTier, isLoading } = useLicense();

  // While loading, return false (conservative)
  if (isLoading) return false;

  return hasTier(requiredTier);
}

/**
 * Hook to get quota value
 */
export function useQuota(quotaKey: string): {
  value: number;
  isUnlimited: boolean;
  isLoading: boolean;
} {
  const { getQuota, isQuotaUnlimited, isLoading } = useLicense();

  return {
    value: getQuota(quotaKey),
    isUnlimited: isQuotaUnlimited(quotaKey),
    isLoading,
  };
}

/**
 * Hook to check if write operations are allowed
 */
export function useCanWrite(): { allowed: boolean; isLoading: boolean } {
  const { isReadOnly, isLoading } = useLicense();

  return {
    allowed: !isReadOnly,
    isLoading,
  };
}

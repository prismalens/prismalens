'use client';

/**
 * FeatureGate Component
 *
 * Conditionally renders children based on license features, tiers, or quotas.
 * Provides a fallback UI when the feature is not available.
 */

import React from 'react';
import { useLicense } from '@/lib/license/license-context';
import {
  TIER_DISPLAY_NAMES,
  FEATURE_DISPLAY_NAMES,
  type LicenseFeature,
  type LicenseTierType,
} from '@/lib/license/constants';

// =============================================================================
// TYPES
// =============================================================================

interface FeatureGateProps {
  children: React.ReactNode;
  /** Required feature flag */
  feature?: LicenseFeature;
  /** Required minimum tier */
  tier?: LicenseTierType;
  /** Custom fallback component */
  fallback?: React.ReactNode;
  /** If true, hide content completely when not licensed (no fallback) */
  hideWhenLocked?: boolean;
  /** If true, show loading state while checking license */
  showLoading?: boolean;
}

interface TierGateProps {
  children: React.ReactNode;
  /** Required minimum tier */
  tier: LicenseTierType;
  /** Custom fallback component */
  fallback?: React.ReactNode;
  /** If true, hide content completely when not licensed */
  hideWhenLocked?: boolean;
}

interface WriteGateProps {
  children: React.ReactNode;
  /** Custom fallback component */
  fallback?: React.ReactNode;
  /** If true, hide content completely when read-only */
  hideWhenLocked?: boolean;
}

// =============================================================================
// DEFAULT FALLBACK
// =============================================================================

interface DefaultFallbackProps {
  feature?: LicenseFeature;
  tier?: LicenseTierType;
  currentTier: LicenseTierType;
}

function DefaultFallback({ feature, tier, currentTier }: DefaultFallbackProps) {
  const featureName = feature ? FEATURE_DISPLAY_NAMES[feature] : null;
  const tierName = tier ? TIER_DISPLAY_NAMES[tier] : null;
  const currentTierName = TIER_DISPLAY_NAMES[currentTier];

  return (
    <div className="flex flex-col items-center justify-center p-6 text-center rounded-lg border border-dashed border-gray-300 bg-gray-50 dark:bg-gray-900 dark:border-gray-700">
      <div className="text-gray-400 dark:text-gray-500 mb-2">
        <svg
          className="w-8 h-8 mx-auto"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
          />
        </svg>
      </div>
      <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
        {featureName || tierName
          ? `${featureName || tierName} Required`
          : 'Upgrade Required'}
      </h3>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {tierName ? (
          <>
            This feature requires the <strong>{tierName}</strong> tier or higher.
            <br />
            You are currently on the <strong>{currentTierName}</strong> tier.
          </>
        ) : (
          <>This feature is not available in your current license.</>
        )}
      </p>
      <a
        href="/settings/license"
        className="mt-3 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
      >
        View License Settings &rarr;
      </a>
    </div>
  );
}

// =============================================================================
// LOADING STATE
// =============================================================================

function LoadingState() {
  return (
    <div className="flex items-center justify-center p-4">
      <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin" />
    </div>
  );
}

// =============================================================================
// FEATURE GATE COMPONENT
// =============================================================================

/**
 * Gate content based on license feature or tier.
 *
 * @example
 * ```tsx
 * // Require a specific feature
 * <FeatureGate feature={LICENSE_FEATURES.SSO_SAML}>
 *   <SsoSettings />
 * </FeatureGate>
 *
 * // Require a minimum tier
 * <FeatureGate tier={LICENSE_TIERS.TEAM}>
 *   <TeamFeatures />
 * </FeatureGate>
 *
 * // Hide completely when not licensed
 * <FeatureGate feature={LICENSE_FEATURES.AUDIT_LOGS} hideWhenLocked>
 *   <AuditLogLink />
 * </FeatureGate>
 * ```
 */
export function FeatureGate({
  children,
  feature,
  tier,
  fallback,
  hideWhenLocked = false,
  showLoading = false,
}: FeatureGateProps) {
  const { hasFeature, hasTier, tier: currentTier, isLoading } = useLicense();

  // Show loading state if requested
  if (isLoading && showLoading) {
    return <LoadingState />;
  }

  // Check feature requirement
  if (feature && !hasFeature(feature)) {
    if (hideWhenLocked) return null;
    return (
      fallback ?? (
        <DefaultFallback feature={feature} currentTier={currentTier} />
      )
    );
  }

  // Check tier requirement
  if (tier && !hasTier(tier)) {
    if (hideWhenLocked) return null;
    return (
      fallback ?? (
        <DefaultFallback tier={tier} currentTier={currentTier} />
      )
    );
  }

  return <>{children}</>;
}

// =============================================================================
// TIER GATE COMPONENT
// =============================================================================

/**
 * Shorthand for tier-only gating.
 *
 * @example
 * ```tsx
 * <TierGate tier={LICENSE_TIERS.BUSINESS}>
 *   <BusinessOnlyFeature />
 * </TierGate>
 * ```
 */
export function TierGate({
  children,
  tier,
  fallback,
  hideWhenLocked = false,
}: TierGateProps) {
  return (
    <FeatureGate tier={tier} fallback={fallback} hideWhenLocked={hideWhenLocked}>
      {children}
    </FeatureGate>
  );
}

// =============================================================================
// WRITE GATE COMPONENT
// =============================================================================

/**
 * Gate content that requires write access.
 * Blocks when license is expired (read-only mode).
 *
 * @example
 * ```tsx
 * <WriteGate>
 *   <button onClick={createInvestigation}>Create Investigation</button>
 * </WriteGate>
 * ```
 */
export function WriteGate({
  children,
  fallback,
  hideWhenLocked = false,
}: WriteGateProps) {
  const { isReadOnly, isLoading } = useLicense();

  // While loading, render children (optimistic)
  if (isLoading) {
    return <>{children}</>;
  }

  if (isReadOnly) {
    if (hideWhenLocked) return null;

    return (
      fallback ?? (
        <div className="flex flex-col items-center justify-center p-4 text-center rounded-lg border border-dashed border-yellow-300 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-700">
          <div className="text-yellow-500 dark:text-yellow-400 mb-2">
            <svg
              className="w-6 h-6 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
            License Expired
          </h3>
          <p className="mt-1 text-xs text-yellow-600 dark:text-yellow-300">
            Your subscription has expired. Please renew to create new content.
          </p>
          <a
            href="/settings/license"
            className="mt-2 text-xs text-yellow-700 hover:text-yellow-800 dark:text-yellow-400 dark:hover:text-yellow-300"
          >
            Renew License &rarr;
          </a>
        </div>
      )
    );
  }

  return <>{children}</>;
}

// =============================================================================
// HOC FOR CLASS COMPONENTS
// =============================================================================

/**
 * Higher-order component for feature gating.
 *
 * @example
 * ```tsx
 * const ProtectedComponent = withFeatureGate(MyComponent, {
 *   feature: LICENSE_FEATURES.CODE_INDEXING,
 * });
 * ```
 */
export function withFeatureGate<P extends object>(
  Component: React.ComponentType<P>,
  options: Omit<FeatureGateProps, 'children'>
) {
  return function WrappedComponent(props: P) {
    return (
      <FeatureGate {...options}>
        <Component {...props} />
      </FeatureGate>
    );
  };
}

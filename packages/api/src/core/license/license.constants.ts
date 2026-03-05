/**
 * License Constants
 *
 * Defines feature flags and default values for Community and Enterprise editions.
 * Types derived from @prismalens/contracts/schemas (SSOT).
 *
 * PHILOSOPHY:
 * - Community Edition: Honest, unlimited. No fake quotas or artificial limits.
 *   Like GitLab CE - run your own instance, no restrictions.
 * - Enterprise Edition: SSO, audit logs, multi-tenancy, premium support.
 *   Feature-based differentiation, not quota-based.
 */
import type { LicenseTier, LicenseType } from '@prismalens/contracts/schemas';

// =============================================================================
// LICENSE FEATURES (Enterprise-only)
// =============================================================================
// Features that are only available in Enterprise Edition.
// Community Edition has all core features, unlimited.

export const LICENSE_FEATURES = {
  // Authentication (Enterprise)
  SSO_SAML: 'feat:sso_saml',
  SSO_LDAP: 'feat:sso_ldap',
  SSO_OIDC: 'feat:sso_oidc',

  // Multi-tenancy (Enterprise)
  MULTI_TENANCY: 'feat:multi_tenancy',

  // Compliance (Enterprise)
  AUDIT_LOGS: 'feat:audit_logs',

  // Advanced features (Enterprise)
  CODE_INDEXING: 'feat:code_indexing',
  ADVANCED_CORRELATION: 'feat:advanced_correlation',
  CUSTOM_INTEGRATIONS: 'feat:custom_integrations',

  // Premium integrations (Enterprise)
  INTEGRATION_PAGERDUTY: 'feat:integration_pagerduty',
  INTEGRATION_DATADOG: 'feat:integration_datadog',
  INTEGRATION_SPLUNK: 'feat:integration_splunk',
} as const;

export type LicenseFeature =
  (typeof LICENSE_FEATURES)[keyof typeof LICENSE_FEATURES];

// =============================================================================
// LICENSE TIERS
// =============================================================================
// Simplified two-tier model:
// - COMMUNITY: Self-hosted, open-source, unlimited
// - ENTERPRISE: SSO, audit logs, multi-tenancy, premium support

export const LICENSE_TIERS: Record<Uppercase<LicenseTier>, LicenseTier> = {
  COMMUNITY: 'community',
  ENTERPRISE: 'enterprise',
} as const;

export type LicenseTierType = LicenseTier;

// =============================================================================
// LICENSE TYPES
// =============================================================================

export const LICENSE_TYPES: Record<Uppercase<LicenseType>, LicenseType> = {
  NONE: 'none', // Community Edition (no license key needed)
  SUBSCRIPTION: 'subscription', // Enterprise Edition
} as const;

export type LicenseTypeValue = LicenseType;

// =============================================================================
// TIER CONFIGURATIONS
// =============================================================================

interface TierConfig {
  features: LicenseFeature[];
  description: string;
}

export const TIER_CONFIGS: Record<LicenseTierType, TierConfig> = {
  community: {
    features: [],
    description:
      'Open-source, self-hosted. Unlimited users, services, integrations, and investigations. No artificial limits.',
  },

  enterprise: {
    features: [
      LICENSE_FEATURES.SSO_SAML,
      LICENSE_FEATURES.SSO_LDAP,
      LICENSE_FEATURES.SSO_OIDC,
      LICENSE_FEATURES.MULTI_TENANCY,
      LICENSE_FEATURES.AUDIT_LOGS,
      LICENSE_FEATURES.CODE_INDEXING,
      LICENSE_FEATURES.ADVANCED_CORRELATION,
      LICENSE_FEATURES.CUSTOM_INTEGRATIONS,
      LICENSE_FEATURES.INTEGRATION_PAGERDUTY,
      LICENSE_FEATURES.INTEGRATION_DATADOG,
      LICENSE_FEATURES.INTEGRATION_SPLUNK,
    ],
    description:
      'Enterprise features: SSO, audit logs, multi-tenancy, premium integrations, and priority support.',
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a feature is available for a given tier
 */
export function hasFeature(
  tier: LicenseTierType,
  feature: LicenseFeature,
): boolean {
  // Enterprise has all features
  if (tier === LICENSE_TIERS.ENTERPRISE) {
    return true;
  }

  // Community has core features (not in LICENSE_FEATURES)
  // Enterprise-only features are explicitly listed in LICENSE_FEATURES
  return !Object.values(LICENSE_FEATURES).includes(feature);
}

/**
 * Check if running Community Edition (no license key)
 */
function isCommunityEdition(licenseType: LicenseTypeValue): boolean {
  return licenseType === LICENSE_TYPES.NONE;
}

/**
 * Get the current tier based on license type
 */
function getTierFromLicenseType(
  licenseType: LicenseTypeValue,
): LicenseTierType {
  return licenseType === LICENSE_TYPES.SUBSCRIPTION
    ? LICENSE_TIERS.ENTERPRISE
    : LICENSE_TIERS.COMMUNITY;
}

// Reserved for future use
void isCommunityEdition;
void getTierFromLicenseType;

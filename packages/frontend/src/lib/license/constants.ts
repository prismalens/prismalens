/**
 * License Constants
 *
 * Derived from @prismalens/contracts/schemas (SSOT).
 * Two-tier model: Community (open-source) and Enterprise.
 */
import type { LicenseTier, LicenseType } from "@prismalens/contracts/schemas";

// =============================================================================
// LICENSE FEATURES (Enterprise-only)
// =============================================================================

export const LICENSE_FEATURES = {
	// Authentication (Enterprise)
	SSO_SAML: "feat:sso_saml",
	SSO_LDAP: "feat:sso_ldap",
	SSO_OIDC: "feat:sso_oidc",

	// Multi-tenancy (Enterprise)
	MULTI_TENANCY: "feat:multi_tenancy",

	// Compliance (Enterprise)
	AUDIT_LOGS: "feat:audit_logs",

	// Advanced features (Enterprise)
	CODE_INDEXING: "feat:code_indexing",
	ADVANCED_CORRELATION: "feat:advanced_correlation",
	CUSTOM_INTEGRATIONS: "feat:custom_integrations",

	// Premium integrations (Enterprise)
	INTEGRATION_PAGERDUTY: "feat:integration_pagerduty",
	INTEGRATION_DATADOG: "feat:integration_datadog",
	INTEGRATION_SPLUNK: "feat:integration_splunk",
} as const;

export type LicenseFeature =
	(typeof LICENSE_FEATURES)[keyof typeof LICENSE_FEATURES];

// =============================================================================
// LICENSE TIERS
// =============================================================================

export const LICENSE_TIERS: Record<Uppercase<LicenseTier>, LicenseTier> = {
	COMMUNITY: "community",
	ENTERPRISE: "enterprise",
} as const;

export type LicenseTierType = LicenseTier;

// Tier order for comparison (higher index = higher tier)
export const TIER_ORDER: LicenseTierType[] = [
	LICENSE_TIERS.COMMUNITY,
	LICENSE_TIERS.ENTERPRISE,
];

// =============================================================================
// LICENSE TYPES
// =============================================================================

export const LICENSE_TYPES: Record<Uppercase<LicenseType>, LicenseType> = {
	NONE: "none",
	SUBSCRIPTION: "subscription",
} as const;

export type LicenseTypeValue = LicenseType;

// =============================================================================
// TIER DISPLAY NAMES
// =============================================================================

export const TIER_DISPLAY_NAMES: Record<LicenseTierType, string> = {
	community: "Community",
	enterprise: "Enterprise",
};

// =============================================================================
// FEATURE DISPLAY NAMES
// =============================================================================

export const FEATURE_DISPLAY_NAMES: Record<LicenseFeature, string> = {
	[LICENSE_FEATURES.SSO_SAML]: "SAML 2.0 SSO",
	[LICENSE_FEATURES.SSO_LDAP]: "LDAP/Active Directory",
	[LICENSE_FEATURES.SSO_OIDC]: "OAuth2/OIDC",
	[LICENSE_FEATURES.MULTI_TENANCY]: "Multi-Tenancy",
	[LICENSE_FEATURES.AUDIT_LOGS]: "Audit Logs",
	[LICENSE_FEATURES.CODE_INDEXING]: "Code Indexing",
	[LICENSE_FEATURES.ADVANCED_CORRELATION]: "Advanced Correlation",
	[LICENSE_FEATURES.CUSTOM_INTEGRATIONS]: "Custom Integrations",
	[LICENSE_FEATURES.INTEGRATION_PAGERDUTY]: "PagerDuty Integration",
	[LICENSE_FEATURES.INTEGRATION_DATADOG]: "Datadog Integration",
	[LICENSE_FEATURES.INTEGRATION_SPLUNK]: "Splunk Integration",
};

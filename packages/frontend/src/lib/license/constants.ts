/**
 * License Constants
 *
 * Mirrored from packages/api/src/core/license/license.constants.ts
 * Keep these in sync with the TypeScript API definitions.
 */

// =============================================================================
// LICENSE FEATURES
// =============================================================================

export const LICENSE_FEATURES = {
	// Extended agent capabilities
	EXTENDED_AGENTS: "feat:extended_agents",
	EXTENDED_TOOLS: "feat:extended_tools",
	CUSTOM_AGENT_PROMPTS: "feat:custom_agent_prompts",

	// Authentication (Enterprise)
	SSO_SAML: "feat:sso_saml",
	SSO_LDAP: "feat:sso_ldap",
	SSO_OIDC: "feat:sso_oidc",

	// Multi-tenancy (Enterprise)
	MULTI_TENANCY: "feat:multi_tenancy",

	// Advanced features
	CODE_INDEXING: "feat:code_indexing",
	AUDIT_LOGS: "feat:audit_logs",
	ADVANCED_CORRELATION: "feat:advanced_correlation",
	CUSTOM_INTEGRATIONS: "feat:custom_integrations",

	// Premium integrations
	INTEGRATION_PAGERDUTY: "feat:integration_pagerduty",
	INTEGRATION_DATADOG: "feat:integration_datadog",
	INTEGRATION_SPLUNK: "feat:integration_splunk",
} as const;

export type LicenseFeature =
	(typeof LICENSE_FEATURES)[keyof typeof LICENSE_FEATURES];

// =============================================================================
// LICENSE QUOTAS
// =============================================================================

export const LICENSE_QUOTAS = {
	// Investigation limits
	MAX_INVESTIGATIONS_MONTHLY: "quota:investigations_monthly",
	MAX_CONCURRENT_INVESTIGATIONS: "quota:concurrent_investigations",

	// Resource limits
	MAX_SERVICES: "quota:services",
	MAX_USERS: "quota:users",
	MAX_INTEGRATIONS: "quota:integrations",

	// Data retention
	MAX_RETENTION_DAYS: "quota:retention_days",
	MAX_TIMELINE_ENTRIES: "quota:timeline_entries",

	// Seat-based (for Team tier)
	SEATS: "quota:seats",
} as const;

export type LicenseQuota = (typeof LICENSE_QUOTAS)[keyof typeof LICENSE_QUOTAS];

// =============================================================================
// LICENSE TIERS
// =============================================================================

export const LICENSE_TIERS = {
	FREE: "free",
	FREE_PLUS: "free_plus",
	BEGINNER: "beginner",
	TEAM: "team",
	BUSINESS: "business",
	ENTERPRISE: "enterprise",
} as const;

export type LicenseTierType =
	(typeof LICENSE_TIERS)[keyof typeof LICENSE_TIERS];

// Tier order for comparison (higher index = higher tier)
export const TIER_ORDER: LicenseTierType[] = [
	LICENSE_TIERS.FREE,
	LICENSE_TIERS.FREE_PLUS,
	LICENSE_TIERS.BEGINNER,
	LICENSE_TIERS.TEAM,
	LICENSE_TIERS.BUSINESS,
	LICENSE_TIERS.ENTERPRISE,
];

// =============================================================================
// LICENSE TYPES
// =============================================================================

export const LICENSE_TYPES = {
	NONE: "none",
	PERPETUAL: "perpetual",
	SUBSCRIPTION: "subscription",
} as const;

export type LicenseTypeValue =
	(typeof LICENSE_TYPES)[keyof typeof LICENSE_TYPES];

// =============================================================================
// UNLIMITED QUOTA MARKER
// =============================================================================

export const UNLIMITED_QUOTA = -1;

// =============================================================================
// TIER DISPLAY NAMES
// =============================================================================

export const TIER_DISPLAY_NAMES: Record<LicenseTierType, string> = {
	[LICENSE_TIERS.FREE]: "Free",
	[LICENSE_TIERS.FREE_PLUS]: "Free+",
	[LICENSE_TIERS.BEGINNER]: "Beginner",
	[LICENSE_TIERS.TEAM]: "Team",
	[LICENSE_TIERS.BUSINESS]: "Business",
	[LICENSE_TIERS.ENTERPRISE]: "Enterprise",
};

// =============================================================================
// FEATURE DISPLAY NAMES
// =============================================================================

export const FEATURE_DISPLAY_NAMES: Record<LicenseFeature, string> = {
	[LICENSE_FEATURES.EXTENDED_AGENTS]: "Extended Agent Capabilities",
	[LICENSE_FEATURES.EXTENDED_TOOLS]: "Extended Agent Tools",
	[LICENSE_FEATURES.CUSTOM_AGENT_PROMPTS]: "Custom Agent Prompts",
	[LICENSE_FEATURES.SSO_SAML]: "SAML 2.0 SSO",
	[LICENSE_FEATURES.SSO_LDAP]: "LDAP/Active Directory",
	[LICENSE_FEATURES.SSO_OIDC]: "OAuth2/OIDC",
	[LICENSE_FEATURES.MULTI_TENANCY]: "Multi-Tenancy",
	[LICENSE_FEATURES.CODE_INDEXING]: "Code Indexing",
	[LICENSE_FEATURES.AUDIT_LOGS]: "Audit Logs",
	[LICENSE_FEATURES.ADVANCED_CORRELATION]: "Advanced Correlation",
	[LICENSE_FEATURES.CUSTOM_INTEGRATIONS]: "Custom Integrations",
	[LICENSE_FEATURES.INTEGRATION_PAGERDUTY]: "PagerDuty Integration",
	[LICENSE_FEATURES.INTEGRATION_DATADOG]: "Datadog Integration",
	[LICENSE_FEATURES.INTEGRATION_SPLUNK]: "Splunk Integration",
};

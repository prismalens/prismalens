/**
 * License Constants
 *
 * Defines feature flags, quota keys, and default values for each license tier.
 * These constants are shared with the Python worker via mirrored definitions.
 */

// =============================================================================
// LICENSE FEATURES
// =============================================================================
// Feature flags that can be enabled/disabled per license tier.
// Format: "feat:{feature_name}"

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
// Numeric limits that can be set per license tier.
// Format: "quota:{quota_name}"

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
// DEFAULT TIER CONFIGURATIONS
// =============================================================================
// Default features and quotas for each tier.
// When a license is activated, these are populated from the license server.
// These serve as fallbacks if the license server is unavailable.

export interface TierConfig {
	features: LicenseFeature[];
	quotas: Record<string, number>;
}

export const DEFAULT_TIER_CONFIGS: Record<LicenseTierType, TierConfig> = {
	[LICENSE_TIERS.FREE]: {
		features: [],
		quotas: {
			[LICENSE_QUOTAS.MAX_INVESTIGATIONS_MONTHLY]: 50,
			[LICENSE_QUOTAS.MAX_CONCURRENT_INVESTIGATIONS]: 2,
			[LICENSE_QUOTAS.MAX_SERVICES]: 5,
			[LICENSE_QUOTAS.MAX_USERS]: 3,
			[LICENSE_QUOTAS.MAX_INTEGRATIONS]: 3,
			[LICENSE_QUOTAS.MAX_RETENTION_DAYS]: 7,
			[LICENSE_QUOTAS.MAX_TIMELINE_ENTRIES]: 100,
		},
	},

	[LICENSE_TIERS.FREE_PLUS]: {
		features: [
			LICENSE_FEATURES.EXTENDED_AGENTS,
			LICENSE_FEATURES.EXTENDED_TOOLS,
		],
		quotas: {
			[LICENSE_QUOTAS.MAX_INVESTIGATIONS_MONTHLY]: 500,
			[LICENSE_QUOTAS.MAX_CONCURRENT_INVESTIGATIONS]: 10,
			[LICENSE_QUOTAS.MAX_SERVICES]: 25,
			[LICENSE_QUOTAS.MAX_USERS]: 10,
			[LICENSE_QUOTAS.MAX_INTEGRATIONS]: 10,
			[LICENSE_QUOTAS.MAX_RETENTION_DAYS]: 30,
			[LICENSE_QUOTAS.MAX_TIMELINE_ENTRIES]: 1000,
		},
	},

	[LICENSE_TIERS.BEGINNER]: {
		// Same as Free+License but cloud-hosted
		features: [
			LICENSE_FEATURES.EXTENDED_AGENTS,
			LICENSE_FEATURES.EXTENDED_TOOLS,
		],
		quotas: {
			[LICENSE_QUOTAS.MAX_INVESTIGATIONS_MONTHLY]: 500,
			[LICENSE_QUOTAS.MAX_CONCURRENT_INVESTIGATIONS]: 10,
			[LICENSE_QUOTAS.MAX_SERVICES]: 25,
			[LICENSE_QUOTAS.MAX_USERS]: 10,
			[LICENSE_QUOTAS.MAX_INTEGRATIONS]: 10,
			[LICENSE_QUOTAS.MAX_RETENTION_DAYS]: 30,
			[LICENSE_QUOTAS.MAX_TIMELINE_ENTRIES]: 1000,
		},
	},

	[LICENSE_TIERS.TEAM]: {
		features: [
			LICENSE_FEATURES.EXTENDED_AGENTS,
			LICENSE_FEATURES.EXTENDED_TOOLS,
			LICENSE_FEATURES.CUSTOM_AGENT_PROMPTS,
		],
		quotas: {
			[LICENSE_QUOTAS.MAX_INVESTIGATIONS_MONTHLY]: 2000,
			[LICENSE_QUOTAS.MAX_CONCURRENT_INVESTIGATIONS]: 25,
			[LICENSE_QUOTAS.MAX_SERVICES]: 100,
			[LICENSE_QUOTAS.MAX_USERS]: -1, // Seat-based, use SEATS quota
			[LICENSE_QUOTAS.SEATS]: 10, // Default seats
			[LICENSE_QUOTAS.MAX_INTEGRATIONS]: 25,
			[LICENSE_QUOTAS.MAX_RETENTION_DAYS]: 90,
			[LICENSE_QUOTAS.MAX_TIMELINE_ENTRIES]: 10000,
		},
	},

	[LICENSE_TIERS.BUSINESS]: {
		features: [
			LICENSE_FEATURES.EXTENDED_AGENTS,
			LICENSE_FEATURES.EXTENDED_TOOLS,
			LICENSE_FEATURES.CUSTOM_AGENT_PROMPTS,
			LICENSE_FEATURES.SSO_SAML,
			LICENSE_FEATURES.SSO_LDAP,
			LICENSE_FEATURES.SSO_OIDC,
			LICENSE_FEATURES.AUDIT_LOGS,
			LICENSE_FEATURES.ADVANCED_CORRELATION,
			LICENSE_FEATURES.INTEGRATION_PAGERDUTY,
			LICENSE_FEATURES.INTEGRATION_DATADOG,
		],
		quotas: {
			[LICENSE_QUOTAS.MAX_INVESTIGATIONS_MONTHLY]: 10000,
			[LICENSE_QUOTAS.MAX_CONCURRENT_INVESTIGATIONS]: 50,
			[LICENSE_QUOTAS.MAX_SERVICES]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_USERS]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_INTEGRATIONS]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_RETENTION_DAYS]: 365,
			[LICENSE_QUOTAS.MAX_TIMELINE_ENTRIES]: -1, // Unlimited
		},
	},

	[LICENSE_TIERS.ENTERPRISE]: {
		features: [
			LICENSE_FEATURES.EXTENDED_AGENTS,
			LICENSE_FEATURES.EXTENDED_TOOLS,
			LICENSE_FEATURES.CUSTOM_AGENT_PROMPTS,
			LICENSE_FEATURES.SSO_SAML,
			LICENSE_FEATURES.SSO_LDAP,
			LICENSE_FEATURES.SSO_OIDC,
			LICENSE_FEATURES.MULTI_TENANCY,
			LICENSE_FEATURES.CODE_INDEXING,
			LICENSE_FEATURES.AUDIT_LOGS,
			LICENSE_FEATURES.ADVANCED_CORRELATION,
			LICENSE_FEATURES.CUSTOM_INTEGRATIONS,
			LICENSE_FEATURES.INTEGRATION_PAGERDUTY,
			LICENSE_FEATURES.INTEGRATION_DATADOG,
			LICENSE_FEATURES.INTEGRATION_SPLUNK,
		],
		quotas: {
			[LICENSE_QUOTAS.MAX_INVESTIGATIONS_MONTHLY]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_CONCURRENT_INVESTIGATIONS]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_SERVICES]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_USERS]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_INTEGRATIONS]: -1, // Unlimited
			[LICENSE_QUOTAS.MAX_RETENTION_DAYS]: -1, // Custom
			[LICENSE_QUOTAS.MAX_TIMELINE_ENTRIES]: -1, // Unlimited
		},
	},
};

// =============================================================================
// UNLIMITED QUOTA MARKER
// =============================================================================
// -1 means unlimited for quota checks

export const UNLIMITED_QUOTA = -1;

/**
 * License Decorators
 *
 * Route decorators for declaring license requirements.
 */

import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import type { LicenseFeature, LicenseTierType } from "./license.constants.js";
import {
	LicenseFeatureGuard,
	LicenseGuard,
	LicenseTierGuard,
	LicenseWriteGuard,
} from "./license.guard.js";

// =============================================================================
// METADATA KEYS
// =============================================================================

export const REQUIRES_FEATURE_KEY = "license:requires_feature";
export const REQUIRES_TIER_KEY = "license:requires_tier";
export const REQUIRES_WRITE_ACCESS_KEY = "license:requires_write_access";

// =============================================================================
// DECORATORS
// =============================================================================

/**
 * Require a specific license feature to access this route.
 *
 * @example
 * ```ts
 * @RequiresFeature(LICENSE_FEATURES.SSO_SAML)
 * @Get('sso/saml/config')
 * getSamlConfig() { ... }
 * ```
 */
export const RequiresFeature = (feature: LicenseFeature) =>
	applyDecorators(
		SetMetadata(REQUIRES_FEATURE_KEY, feature),
		UseGuards(LicenseFeatureGuard),
	);

/**
 * Require a minimum license tier to access this route.
 *
 * @example
 * ```ts
 * @RequiresTier(LICENSE_TIERS.TEAM)
 * @Get('collaboration/settings')
 * getCollaborationSettings() { ... }
 * ```
 */
export const RequiresTier = (tier: LicenseTierType) =>
	applyDecorators(
		SetMetadata(REQUIRES_TIER_KEY, tier),
		UseGuards(LicenseTierGuard),
	);

/**
 * Mark a route as requiring write access.
 * Write access is blocked when a subscription license is expired.
 *
 * @example
 * ```ts
 * @RequiresWriteAccess()
 * @Post('investigations')
 * createInvestigation() { ... }
 * ```
 */
export const RequiresWriteAccess = () =>
	applyDecorators(
		SetMetadata(REQUIRES_WRITE_ACCESS_KEY, true),
		UseGuards(LicenseWriteGuard),
	);

/**
 * Apply all license checks: feature, tier, and write access.
 * Useful when you need multiple requirements on a single route.
 *
 * @example
 * ```ts
 * @RequiresLicense({
 *   feature: LICENSE_FEATURES.MULTI_TENANCY,
 *   tier: LICENSE_TIERS.ENTERPRISE,
 *   writeAccess: true,
 * })
 * @Post('tenants')
 * createTenant() { ... }
 * ```
 */
export const RequiresLicense = (options: {
	feature?: LicenseFeature;
	tier?: LicenseTierType;
	writeAccess?: boolean;
}) => {
	const decorators: Array<
		ClassDecorator | MethodDecorator | PropertyDecorator
	> = [];

	if (options.feature) {
		decorators.push(SetMetadata(REQUIRES_FEATURE_KEY, options.feature));
	}

	if (options.tier) {
		decorators.push(SetMetadata(REQUIRES_TIER_KEY, options.tier));
	}

	if (options.writeAccess) {
		decorators.push(SetMetadata(REQUIRES_WRITE_ACCESS_KEY, true));
	}

	// Use the combined guard
	decorators.push(UseGuards(LicenseGuard));

	return applyDecorators(...decorators);
};

/**
 * Mark a route as a paid feature (requires any non-free tier).
 * Convenience decorator for routes that require a license but not a specific feature.
 *
 * @example
 * ```ts
 * @PaidFeature()
 * @Get('analytics/advanced')
 * getAdvancedAnalytics() { ... }
 * ```
 */
export const PaidFeature = () => RequiresTier("free_plus" as LicenseTierType);

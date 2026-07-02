/**
 * License Decorators
 *
 * Route decorators for declaring license requirements.
 * Simplified for Community/Enterprise model.
 */

import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import type { LicenseFeature, LicenseTierType } from "./license.constants.js";
import { LICENSE_TIERS } from "./license.constants.js";
import {
	LicenseFeatureGuard,
	LicenseGuard,
	LicenseTierGuard,
} from "./license.guard.js";

// =============================================================================
// METADATA KEYS
// =============================================================================

export const REQUIRES_FEATURE_KEY = "license:requires_feature";
export const REQUIRES_TIER_KEY = "license:requires_tier";

// =============================================================================
// DECORATORS
// =============================================================================

/**
 * Require a specific license feature to access this route.
 * Enterprise-only features are defined in LICENSE_FEATURES.
 *
 * @example
 * ```ts
 * @RequiresFeature(LICENSE_FEATURES.SSO_SAML)
 * @Get('sso/saml/config')
 * getSamlConfig() { ... }
 * ```
 */
const RequiresFeature = (feature: LicenseFeature) =>
	applyDecorators(
		SetMetadata(REQUIRES_FEATURE_KEY, feature),
		UseGuards(LicenseFeatureGuard),
	);

/**
 * Require a minimum license tier to access this route.
 * In the simplified model, only ENTERPRISE tier requires a license.
 *
 * @example
 * ```ts
 * @RequiresTier(LICENSE_TIERS.ENTERPRISE)
 * @Get('audit-logs')
 * getAuditLogs() { ... }
 * ```
 */
const RequiresTier = (tier: LicenseTierType) =>
	applyDecorators(
		SetMetadata(REQUIRES_TIER_KEY, tier),
		UseGuards(LicenseTierGuard),
	);

/**
 * Apply all license checks: feature and tier.
 * Useful when you need multiple requirements on a single route.
 *
 * @example
 * ```ts
 * @RequiresLicense({
 *   feature: LICENSE_FEATURES.MULTI_TENANCY,
 *   tier: LICENSE_TIERS.ENTERPRISE,
 * })
 * @Post('tenants')
 * createTenant() { ... }
 * ```
 */
const RequiresLicense = (options: {
	feature?: LicenseFeature;
	tier?: LicenseTierType;
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

	// Use the combined guard
	decorators.push(UseGuards(LicenseGuard));

	return applyDecorators(...decorators);
};

/**
 * Mark a route as requiring Enterprise license.
 * Convenience decorator for Enterprise-only routes.
 *
 * @example
 * ```ts
 * @PaidFeature()
 * @Get('audit-logs')
 * getAuditLogs() { ... }
 * ```
 */
const PaidFeature = () => RequiresTier(LICENSE_TIERS.ENTERPRISE);

// Suppress unused variable warnings for decorators reserved for future use
void RequiresFeature;
void RequiresTier;
void RequiresLicense;
void PaidFeature;

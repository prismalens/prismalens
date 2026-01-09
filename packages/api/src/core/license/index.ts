/**
 * License Module Exports
 *
 * Public API for license management and feature gating.
 */

// Decorators
export {
	PaidFeature,
	REQUIRES_FEATURE_KEY,
	REQUIRES_TIER_KEY,
	REQUIRES_WRITE_ACCESS_KEY,
	RequiresFeature,
	RequiresLicense,
	RequiresTier,
	RequiresWriteAccess,
} from "./decorators.js";
// Constants
export {
	DEFAULT_TIER_CONFIGS,
	LICENSE_FEATURES,
	LICENSE_QUOTAS,
	LICENSE_TIERS,
	LICENSE_TYPES,
	type LicenseFeature,
	type LicenseQuota,
	type LicenseTierType,
	type LicenseTypeValue,
	type TierConfig,
	UNLIMITED_QUOTA,
} from "./license.constants.js";

// Guards
export {
	LicenseFeatureGuard,
	LicenseGuard,
	LicenseTierGuard,
	LicenseWriteGuard,
} from "./license.guard.js";
// Module
export { LicenseModule } from "./license.module.js";
// Service
export {
	type ActivateLicenseResult,
	LicenseService,
	type LicenseState,
	type QuotaCheckResult,
} from "./license.service.js";

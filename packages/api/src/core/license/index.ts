/**
 * License Module Exports
 *
 * Public API for license management and feature gating.
 * Simplified Community/Enterprise model.
 */

// Decorators
export {
	PaidFeature,
	REQUIRES_FEATURE_KEY,
	REQUIRES_TIER_KEY,
	RequiresFeature,
	RequiresLicense,
	RequiresTier,
} from "./decorators.js";

// Constants
export {
	LICENSE_FEATURES,
	LICENSE_TIERS,
	LICENSE_TYPES,
	TIER_CONFIGS,
	hasFeature,
	isCommunityEdition,
	getTierFromLicenseType,
	type LicenseFeature,
	type LicenseTierType,
	type LicenseTypeValue,
	type TierConfig,
} from "./license.constants.js";

// Guards
export {
	LicenseFeatureGuard,
	LicenseGuard,
	LicenseTierGuard,
} from "./license.guard.js";

// Module
export { LicenseModule } from "./license.module.js";

// Service
export {
	type ActivateLicenseResult,
	LicenseService,
	type LicenseState,
} from "./license.service.js";

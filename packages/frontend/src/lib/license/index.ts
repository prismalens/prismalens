/**
 * License Module Exports
 *
 * Public API for license management in the frontend.
 */

// Constants
export {
	FEATURE_DISPLAY_NAMES,
	LICENSE_FEATURES,
	LICENSE_TIERS,
	LICENSE_TYPES,
	type LicenseFeature,
	type LicenseTierType,
	type LicenseTypeValue,
	TIER_DISPLAY_NAMES,
	TIER_ORDER,
} from "./constants";
// Context and hooks
export {
	LicenseProvider,
	licenseQueryKeys,
	useCanWrite,
	useHasFeature,
	useHasTier,
	useLicense,
	useQuota,
} from "./license-context";
// Types
export type {
	ActivateLicenseRequest,
	ActivateLicenseResponse,
	LicenseContextValue,
	LicenseState,
	LicenseStatus,
} from "./types";

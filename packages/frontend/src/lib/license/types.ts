/**
 * License Types
 *
 * Type definitions for license state and API responses.
 */

import type {
	LicenseFeature,
	LicenseTierType,
	LicenseTypeValue,
} from "./constants";

/**
 * License status response from API
 */
export interface LicenseStatus {
	status: "active" | "expired" | "none";
	tier: LicenseTierType;
	licenseType: LicenseTypeValue;
	features: LicenseFeature[];
	quotas: Record<string, number>;
	expiresAt: string | null;
	isReadOnly: boolean;
	customer?: {
		email?: string;
		name?: string;
	};
}

/**
 * License state for React context
 */
export interface LicenseState {
	// Loading state
	isLoading: boolean;
	error: Error | null;

	// License info
	status: "active" | "expired" | "none";
	tier: LicenseTierType;
	licenseType: LicenseTypeValue;
	features: LicenseFeature[];
	quotas: Record<string, number>;
	expiresAt: Date | null;
	isReadOnly: boolean;

	// Customer info (if licensed)
	customerEmail?: string;
	customerName?: string;
}

/**
 * License context value
 */
export interface LicenseContextValue extends LicenseState {
	// Helper functions
	hasFeature: (feature: LicenseFeature) => boolean;
	hasTier: (requiredTier: LicenseTierType) => boolean;
	getQuota: (quotaKey: string) => number;
	isQuotaUnlimited: (quotaKey: string) => boolean;

	// Actions
	refreshLicense: () => Promise<void>;
	activateLicense: (
		licenseKey: string,
	) => Promise<{ success: boolean; error?: string }>;
	deactivateLicense: () => Promise<void>;
}

/**
 * Activate license request
 */
export interface ActivateLicenseRequest {
	licenseKey: string;
}

/**
 * Activate license response
 */
export interface ActivateLicenseResponse {
	success: boolean;
	error?: string;
	license?: LicenseStatus;
}

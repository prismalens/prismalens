/**
 * License Module Exports
 *
 * Public API for license management in the frontend.
 */

// Context and hooks
export {
  LicenseProvider,
  useLicense,
  useHasFeature,
  useHasTier,
  useQuota,
  useCanWrite,
  licenseQueryKeys,
} from './license-context';

// Types
export type {
  LicenseStatus,
  LicenseState,
  LicenseContextValue,
  ActivateLicenseRequest,
  ActivateLicenseResponse,
} from './types';

// Constants
export {
  LICENSE_FEATURES,
  LICENSE_QUOTAS,
  LICENSE_TIERS,
  LICENSE_TYPES,
  TIER_ORDER,
  UNLIMITED_QUOTA,
  TIER_DISPLAY_NAMES,
  FEATURE_DISPLAY_NAMES,
  type LicenseFeature,
  type LicenseQuota,
  type LicenseTierType,
  type LicenseTypeValue,
} from './constants';

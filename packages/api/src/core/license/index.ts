/**
 * License Module Exports
 *
 * Public API for license management and feature gating.
 */

// Module
export { LicenseModule } from './license.module.js';

// Service
export {
  LicenseService,
  type LicenseState,
  type QuotaCheckResult,
  type ActivateLicenseResult,
} from './license.service.js';

// Guards
export {
  LicenseGuard,
  LicenseFeatureGuard,
  LicenseTierGuard,
  LicenseWriteGuard,
} from './license.guard.js';

// Decorators
export {
  RequiresFeature,
  RequiresTier,
  RequiresWriteAccess,
  RequiresLicense,
  PaidFeature,
  REQUIRES_FEATURE_KEY,
  REQUIRES_TIER_KEY,
  REQUIRES_WRITE_ACCESS_KEY,
} from './decorators.js';

// Constants
export {
  LICENSE_FEATURES,
  LICENSE_QUOTAS,
  LICENSE_TIERS,
  LICENSE_TYPES,
  DEFAULT_TIER_CONFIGS,
  UNLIMITED_QUOTA,
  type LicenseFeature,
  type LicenseQuota,
  type LicenseTierType,
  type LicenseTypeValue,
  type TierConfig,
} from './license.constants.js';

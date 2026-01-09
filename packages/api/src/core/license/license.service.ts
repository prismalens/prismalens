/**
 * License Service
 *
 * Core license validation and management logic.
 * Supports perpetual (Free+License) and subscription (paid tiers) license types.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
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
} from './license.constants.js';

// =============================================================================
// TYPES
// =============================================================================

export interface LicenseState {
  isValid: boolean;
  licenseType: LicenseTypeValue;
  tier: LicenseTierType;
  features: LicenseFeature[];
  quotas: Record<string, number>;
  expiresAt: Date | null;
  isExpired: boolean;
  isReadOnly: boolean; // True if subscription expired (can read, cannot write)
  customerEmail?: string;
  customerName?: string;
}

export interface QuotaCheckResult {
  allowed: boolean;
  current: number;
  limit: number;
  remaining: number;
  reason?: string;
}

export interface ActivateLicenseResult {
  success: boolean;
  error?: string;
  licenseState?: LicenseState;
}

// License info as stored in database
interface LicenseInfoRecord {
  id: string;
  licenseKey: string | null;
  licenseType: string;
  tier: string;
  validUntil: Date | null;
  activatedAt: Date | null;
  lastValidated: Date | null;
  features: string;
  quotas: string;
  billingCycle: string | null;
  seats: number | null;
  cloudInstanceId: string | null;
  isCloudManaged: boolean;
  customerEmail: string | null;
  customerName: string | null;
  metadata: string;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Cache TTL in milliseconds (1 hour for production use)
const LICENSE_CACHE_TTL_MS = 60 * 60 * 1000;

// Revalidation threshold for subscriptions (24 hours)
const SUBSCRIPTION_REVALIDATION_HOURS = 24;

// =============================================================================
// SERVICE
// =============================================================================

@Injectable()
export class LicenseService implements OnModuleInit {
  private readonly logger = new Logger(LicenseService.name);
  private cachedLicenseState: LicenseState | null = null;
  private cacheTimestamp: number = 0;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Pre-load license state on startup
    await this.getLicenseState();
  }

  // ===========================================================================
  // PUBLIC API
  // ===========================================================================

  /**
   * Get current license state (cached with 1-hour TTL)
   */
  async getLicenseState(forceRefresh = false): Promise<LicenseState> {
    // Check cache validity
    if (
      !forceRefresh &&
      this.cachedLicenseState &&
      Date.now() - this.cacheTimestamp < LICENSE_CACHE_TTL_MS
    ) {
      return this.cachedLicenseState;
    }

    // Fetch and validate license
    const licenseState = await this.validateLicense();

    // Update cache
    this.cachedLicenseState = licenseState;
    this.cacheTimestamp = Date.now();

    return licenseState;
  }

  /**
   * Check if a feature is available in current license
   */
  async hasFeature(feature: LicenseFeature): Promise<boolean> {
    const state = await this.getLicenseState();
    return state.features.includes(feature);
  }

  /**
   * Check if current tier matches or exceeds required tier
   */
  async hasTier(requiredTier: LicenseTierType): Promise<boolean> {
    const state = await this.getLicenseState();
    return this.tierMeetsRequirement(state.tier, requiredTier);
  }

  /**
   * Check quota availability for a given quota key
   */
  async checkQuota(
    quotaKey: LicenseQuota,
    currentUsage: number,
  ): Promise<QuotaCheckResult> {
    const state = await this.getLicenseState();
    const limit = state.quotas[quotaKey] ?? 0;

    // Unlimited quota (-1)
    if (limit === UNLIMITED_QUOTA) {
      return {
        allowed: true,
        current: currentUsage,
        limit: -1,
        remaining: -1,
      };
    }

    const remaining = Math.max(0, limit - currentUsage);
    const allowed = currentUsage < limit;

    return {
      allowed,
      current: currentUsage,
      limit,
      remaining,
      reason: allowed
        ? undefined
        : `Quota exceeded: ${currentUsage}/${limit} for ${quotaKey}`,
    };
  }

  /**
   * Check if write operations are allowed
   * (Subscription licenses in read-only mode after expiry)
   */
  async canWrite(): Promise<{ allowed: boolean; reason?: string }> {
    const state = await this.getLicenseState();

    if (state.isReadOnly) {
      return {
        allowed: false,
        reason:
          'License expired. Please renew your subscription to create new investigations.',
      };
    }

    return { allowed: true };
  }

  /**
   * Activate a license key
   */
  async activateLicense(licenseKey: string): Promise<ActivateLicenseResult> {
    try {
      // For now, we'll store the license key and mark as needing validation
      // In production, this would call the Keygen.sh API to validate

      // Check if license already exists
      const existing = await this.getLicenseFromDb();

      if (existing && existing.licenseKey === licenseKey) {
        return {
          success: true,
          licenseState: await this.getLicenseState(),
        };
      }

      // Validate with license server (stub for now)
      const validationResult = await this.validateWithLicenseServer(licenseKey);

      if (!validationResult.isValid) {
        return {
          success: false,
          error: validationResult.error || 'Invalid license key',
        };
      }

      // Store license in database
      await this.storeLicense({
        licenseKey,
        licenseType: validationResult.licenseType,
        tier: validationResult.tier,
        validUntil: validationResult.validUntil,
        features: validationResult.features,
        quotas: validationResult.quotas,
        customerEmail: validationResult.customerEmail,
        customerName: validationResult.customerName,
      });

      // Refresh cache
      const newState = await this.getLicenseState(true);

      this.logger.log(
        `License activated: ${validationResult.tier} (${validationResult.licenseType})`,
      );

      return {
        success: true,
        licenseState: newState,
      };
    } catch (error) {
      this.logger.error('Failed to activate license', error);
      return {
        success: false,
        error: 'Failed to activate license. Please try again.',
      };
    }
  }

  /**
   * Deactivate current license (revert to free tier)
   */
  async deactivateLicense(): Promise<void> {
    const existing = await this.getLicenseFromDb();

    if (existing) {
      await (this.prisma as any).licenseInfo.delete({
        where: { id: existing.id },
      });
    }

    // Clear cache
    this.cachedLicenseState = null;
    this.cacheTimestamp = 0;

    this.logger.log('License deactivated, reverted to free tier');
  }

  /**
   * Get license state for internal API (worker consumption)
   * Returns a simplified, serializable format
   */
  async getLicenseStateForWorker(): Promise<{
    tier: string;
    features: string[];
    quotas: Record<string, number>;
    isValid: boolean;
    isReadOnly: boolean;
  }> {
    const state = await this.getLicenseState();
    return {
      tier: state.tier,
      features: state.features,
      quotas: state.quotas,
      isValid: state.isValid,
      isReadOnly: state.isReadOnly,
    };
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Core validation logic
   */
  private async validateLicense(): Promise<LicenseState> {
    const license = await this.getLicenseFromDb();

    // No license or "none" type → free tier
    if (!license || license.licenseType === LICENSE_TYPES.NONE) {
      return this.getFreeTierDefaults();
    }

    // Perpetual license: validate once, trust forever
    if (license.licenseType === LICENSE_TYPES.PERPETUAL) {
      // If never validated, validate now (first activation)
      if (license.activatedAt && !license.lastValidated) {
        await this.revalidateWithServer(license);
      }
      return this.buildLicenseState(license, false);
    }

    // Subscription license: check expiry and periodic validation
    if (license.licenseType === LICENSE_TYPES.SUBSCRIPTION) {
      const isExpired = this.isLicenseExpired(license);

      // If expired, return read-only state
      if (isExpired) {
        return this.buildLicenseState(license, true);
      }

      // Check if revalidation needed
      if (this.needsRevalidation(license)) {
        await this.revalidateWithServer(license);
      }

      return this.buildLicenseState(license, false);
    }

    // Unknown license type → free tier
    return this.getFreeTierDefaults();
  }

  /**
   * Get license record from database
   */
  private async getLicenseFromDb(): Promise<LicenseInfoRecord | null> {
    try {
      // Get first (and only) license record
      const license = await (this.prisma as any).licenseInfo.findFirst();
      return license as LicenseInfoRecord | null;
    } catch (error) {
      // Table might not exist yet (pre-migration)
      this.logger.warn('Could not fetch license info from database');
      return null;
    }
  }

  /**
   * Store license in database
   */
  private async storeLicense(data: {
    licenseKey: string;
    licenseType: string;
    tier: string;
    validUntil: Date | null;
    features: LicenseFeature[];
    quotas: Record<string, number>;
    customerEmail?: string;
    customerName?: string;
  }): Promise<void> {
    const existing = await this.getLicenseFromDb();

    const licenseData = {
      licenseKey: data.licenseKey,
      licenseType: data.licenseType,
      tier: data.tier,
      validUntil: data.validUntil,
      activatedAt: new Date(),
      lastValidated: new Date(),
      features: JSON.stringify(data.features),
      quotas: JSON.stringify(data.quotas),
      customerEmail: data.customerEmail,
      customerName: data.customerName,
    };

    if (existing) {
      await (this.prisma as any).licenseInfo.update({
        where: { id: existing.id },
        data: licenseData,
      });
    } else {
      await (this.prisma as any).licenseInfo.create({
        data: licenseData,
      });
    }
  }

  /**
   * Build license state from database record
   */
  private buildLicenseState(
    license: LicenseInfoRecord,
    isReadOnly: boolean,
  ): LicenseState {
    const features = this.parseJsonField<LicenseFeature[]>(
      license.features,
      [],
    );
    const quotas = this.parseJsonField<Record<string, number>>(
      license.quotas,
      {},
    );

    return {
      isValid: true,
      licenseType: license.licenseType as LicenseTypeValue,
      tier: license.tier as LicenseTierType,
      features,
      quotas,
      expiresAt: license.validUntil,
      isExpired:
        license.licenseType === LICENSE_TYPES.SUBSCRIPTION &&
        this.isLicenseExpired(license),
      isReadOnly,
      customerEmail: license.customerEmail ?? undefined,
      customerName: license.customerName ?? undefined,
    };
  }

  /**
   * Get default free tier state
   */
  private getFreeTierDefaults(): LicenseState {
    const config = DEFAULT_TIER_CONFIGS[LICENSE_TIERS.FREE];

    return {
      isValid: true,
      licenseType: LICENSE_TYPES.NONE,
      tier: LICENSE_TIERS.FREE,
      features: config.features,
      quotas: config.quotas,
      expiresAt: null,
      isExpired: false,
      isReadOnly: false,
    };
  }

  /**
   * Check if subscription license is expired
   */
  private isLicenseExpired(license: LicenseInfoRecord): boolean {
    if (!license.validUntil) return false;
    return new Date() > license.validUntil;
  }

  /**
   * Check if license needs revalidation with server
   */
  private needsRevalidation(license: LicenseInfoRecord): boolean {
    if (!license.lastValidated) return true;

    const hoursSinceValidation =
      (Date.now() - license.lastValidated.getTime()) / (1000 * 60 * 60);

    return hoursSinceValidation > SUBSCRIPTION_REVALIDATION_HOURS;
  }

  /**
   * Revalidate license with Keygen.sh server
   */
  private async revalidateWithServer(
    license: LicenseInfoRecord,
  ): Promise<void> {
    if (!license.licenseKey) return;

    try {
      const result = await this.validateWithLicenseServer(license.licenseKey);

      if (result.isValid) {
        // Update last validated timestamp
        await (this.prisma as any).licenseInfo.update({
          where: { id: license.id },
          data: {
            lastValidated: new Date(),
            features: JSON.stringify(result.features),
            quotas: JSON.stringify(result.quotas),
            validUntil: result.validUntil,
          },
        });
      } else {
        this.logger.warn(
          `License validation failed: ${result.error || 'Unknown error'}`,
        );
      }
    } catch (error) {
      // Log but don't fail - use cached data
      this.logger.warn('Could not reach license server for revalidation');
    }
  }

  /**
   * Validate license key with Keygen.sh server
   * TODO: Implement actual Keygen.sh API call
   */
  private async validateWithLicenseServer(licenseKey: string): Promise<{
    isValid: boolean;
    error?: string;
    licenseType: LicenseTypeValue;
    tier: LicenseTierType;
    validUntil: Date | null;
    features: LicenseFeature[];
    quotas: Record<string, number>;
    customerEmail?: string;
    customerName?: string;
  }> {
    // STUB: For now, accept any key starting with "PL-" as Free+License
    // This will be replaced with actual Keygen.sh API integration

    if (!licenseKey || !licenseKey.startsWith('PL-')) {
      return {
        isValid: false,
        error: 'Invalid license key format',
        licenseType: LICENSE_TYPES.NONE,
        tier: LICENSE_TIERS.FREE,
        validUntil: null,
        features: [],
        quotas: {},
      };
    }

    // Simulate Free+License tier (perpetual)
    const config = DEFAULT_TIER_CONFIGS[LICENSE_TIERS.FREE_PLUS];

    return {
      isValid: true,
      licenseType: LICENSE_TYPES.PERPETUAL,
      tier: LICENSE_TIERS.FREE_PLUS,
      validUntil: null, // Perpetual never expires
      features: config.features,
      quotas: config.quotas,
      customerEmail: 'user@example.com',
      customerName: 'License User',
    };
  }

  /**
   * Check if a tier meets or exceeds a requirement
   */
  private tierMeetsRequirement(
    currentTier: LicenseTierType,
    requiredTier: LicenseTierType,
  ): boolean {
    const tierOrder: LicenseTierType[] = [
      LICENSE_TIERS.FREE,
      LICENSE_TIERS.FREE_PLUS,
      LICENSE_TIERS.BEGINNER,
      LICENSE_TIERS.TEAM,
      LICENSE_TIERS.BUSINESS,
      LICENSE_TIERS.ENTERPRISE,
    ];

    const currentIndex = tierOrder.indexOf(currentTier);
    const requiredIndex = tierOrder.indexOf(requiredTier);

    return currentIndex >= requiredIndex;
  }

  /**
   * Safely parse JSON field with fallback
   */
  private parseJsonField<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback;
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}

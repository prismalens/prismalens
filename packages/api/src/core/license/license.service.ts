// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * License Service
 *
 * Core license validation and management logic.
 * Simplified for Community/Enterprise model:
 * - Community: Open-source, self-hosted, unlimited (no license key needed)
 * - Enterprise: SSO, audit logs, multi-tenancy, premium support (license key required)
 */

import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import {
	hasFeature,
	LICENSE_TIERS,
	LICENSE_TYPES,
	type LicenseFeature,
	type LicenseTierType,
	type LicenseTypeValue,
	TIER_CONFIGS,
} from "./license.constants.js";

// =============================================================================
// TYPES
// =============================================================================

export interface LicenseState {
	isValid: boolean;
	licenseType: LicenseTypeValue;
	tier: LicenseTierType;
	features: LicenseFeature[];
	expiresAt: Date | null;
	isExpired: boolean;
	customerEmail?: string;
	customerName?: string;
}

interface ActivateLicenseResult {
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

// Cache TTL in milliseconds (1 hour)
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
		return hasFeature(state.tier, feature);
	}

	/**
	 * Check if current tier is Enterprise
	 */
	async isEnterprise(): Promise<boolean> {
		const state = await this.getLicenseState();
		return state.tier === LICENSE_TIERS.ENTERPRISE;
	}

	/**
	 * Check if running Community Edition
	 */
	async isCommunity(): Promise<boolean> {
		const state = await this.getLicenseState();
		return state.tier === LICENSE_TIERS.COMMUNITY;
	}

	/**
	 * Activate an Enterprise license key
	 */
	async activateLicense(licenseKey: string): Promise<ActivateLicenseResult> {
		try {
			// Check if license already exists
			const existing = await this.getLicenseFromDb();

			if (existing && existing.licenseKey === licenseKey) {
				return {
					success: true,
					licenseState: await this.getLicenseState(),
				};
			}

			// Validate with license server
			const validationResult = await this.validateWithLicenseServer(licenseKey);

			if (!validationResult.isValid) {
				return {
					success: false,
					error: validationResult.error || "Invalid license key",
				};
			}

			// Store license in database
			await this.storeLicense({
				licenseKey,
				licenseType: LICENSE_TYPES.SUBSCRIPTION,
				tier: LICENSE_TIERS.ENTERPRISE,
				validUntil: validationResult.validUntil,
				features: TIER_CONFIGS[LICENSE_TIERS.ENTERPRISE].features,
				customerEmail: validationResult.customerEmail,
				customerName: validationResult.customerName,
			});

			// Refresh cache
			const newState = await this.getLicenseState(true);

			this.logger.log("Enterprise license activated");

			return {
				success: true,
				licenseState: newState,
			};
		} catch (error) {
			this.logger.error("Failed to activate license", error);
			return {
				success: false,
				error: "Failed to activate license. Please try again.",
			};
		}
	}

	/**
	 * Deactivate current license (revert to Community Edition)
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

		this.logger.log("License deactivated, reverted to Community Edition");
	}

	/**
	 * Get license state for internal API (worker consumption)
	 */
	async getLicenseStateForWorker(): Promise<{
		tier: string;
		features: string[];
		isValid: boolean;
	}> {
		const state = await this.getLicenseState();
		return {
			tier: state.tier,
			features: state.features,
			isValid: state.isValid,
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

		// No license → Community Edition
		if (!license || license.licenseType === LICENSE_TYPES.NONE) {
			return this.getCommunityDefaults();
		}

		// Subscription license: check expiry
		if (license.licenseType === LICENSE_TYPES.SUBSCRIPTION) {
			const isExpired = this.isLicenseExpired(license);

			// If expired, revert to Community Edition
			if (isExpired) {
				this.logger.warn("Enterprise license expired, reverting to Community");
				return this.getCommunityDefaults();
			}

			// Check if revalidation needed
			if (this.needsRevalidation(license)) {
				await this.revalidateWithServer(license);
			}

			return this.buildLicenseState(license);
		}

		// Unknown license type → Community Edition
		return this.getCommunityDefaults();
	}

	/**
	 * Get license record from database
	 */
	private async getLicenseFromDb(): Promise<LicenseInfoRecord | null> {
		try {
			const license = await (this.prisma as any).licenseInfo.findFirst();
			return license as LicenseInfoRecord | null;
		} catch (_error) {
			// Table might not exist yet (pre-migration)
			this.logger.warn("Could not fetch license info from database");
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
			quotas: JSON.stringify({}), // No quotas in simplified model
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
	private buildLicenseState(license: LicenseInfoRecord): LicenseState {
		const features = this.parseJsonField<LicenseFeature[]>(
			license.features,
			[],
		);

		return {
			isValid: true,
			licenseType: license.licenseType as LicenseTypeValue,
			tier: license.tier as LicenseTierType,
			features,
			expiresAt: license.validUntil,
			isExpired: this.isLicenseExpired(license),
			customerEmail: license.customerEmail ?? undefined,
			customerName: license.customerName ?? undefined,
		};
	}

	/**
	 * Get default Community Edition state
	 */
	private getCommunityDefaults(): LicenseState {
		return {
			isValid: true,
			licenseType: LICENSE_TYPES.NONE,
			tier: LICENSE_TIERS.COMMUNITY,
			features: [], // Community has core features, not enterprise features
			expiresAt: null,
			isExpired: false,
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
	 * Revalidate license with server
	 */
	private async revalidateWithServer(
		license: LicenseInfoRecord,
	): Promise<void> {
		if (!license.licenseKey) return;

		try {
			const result = await this.validateWithLicenseServer(license.licenseKey);

			if (result.isValid) {
				await (this.prisma as any).licenseInfo.update({
					where: { id: license.id },
					data: {
						lastValidated: new Date(),
						validUntil: result.validUntil,
					},
				});
			} else {
				this.logger.warn(
					`License validation failed: ${result.error || "Unknown error"}`,
				);
			}
		} catch (_error) {
			// Log but don't fail - use cached data
			this.logger.warn("Could not reach license server for revalidation");
		}
	}

	/**
	 * Validate license key with server
	 * TODO: Implement actual license server API call
	 */
	private async validateWithLicenseServer(licenseKey: string): Promise<{
		isValid: boolean;
		error?: string;
		validUntil: Date | null;
		customerEmail?: string;
		customerName?: string;
	}> {
		// STUB: For now, accept any key starting with "PL-ENT-" as Enterprise
		// This will be replaced with actual license server integration

		if (!licenseKey || !licenseKey.startsWith("PL-ENT-")) {
			return {
				isValid: false,
				error: "Invalid license key format. Enterprise keys start with PL-ENT-",
				validUntil: null,
			};
		}

		// Simulate Enterprise license (1 year validity)
		const validUntil = new Date();
		validUntil.setFullYear(validUntil.getFullYear() + 1);

		return {
			isValid: true,
			validUntil,
			customerEmail: "enterprise@example.com",
			customerName: "Enterprise Customer",
		};
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

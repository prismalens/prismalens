// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * License Guard
 *
 * NestJS guards for enforcing license requirements on routes.
 * Simplified for Community/Enterprise model.
 */

import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRES_FEATURE_KEY, REQUIRES_TIER_KEY } from "./decorators.js";
import {
	LICENSE_TIERS,
	type LicenseFeature,
	type LicenseTierType,
} from "./license.constants.js";
import { LicenseService } from "./license.service.js";

/**
 * Guard that checks if the current license has a required feature
 */
@Injectable()
export class LicenseFeatureGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly licenseService: LicenseService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const requiredFeature = this.reflector.getAllAndOverride<LicenseFeature>(
			REQUIRES_FEATURE_KEY,
			[context.getHandler(), context.getClass()],
		);

		// No feature requirement → allow
		if (!requiredFeature) {
			return true;
		}

		const hasFeature = await this.licenseService.hasFeature(requiredFeature);

		if (!hasFeature) {
			throw new ForbiddenException({
				statusCode: 403,
				error: "Enterprise License Required",
				message: `This feature requires an Enterprise license. Please upgrade to access "${requiredFeature}".`,
				requiredFeature,
			});
		}

		return true;
	}
}

/**
 * Guard that checks if the current license tier meets requirements
 */
@Injectable()
export class LicenseTierGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly licenseService: LicenseService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const requiredTier = this.reflector.getAllAndOverride<LicenseTierType>(
			REQUIRES_TIER_KEY,
			[context.getHandler(), context.getClass()],
		);

		// No tier requirement → allow
		if (!requiredTier) {
			return true;
		}

		// Only Enterprise tier requires a license
		if (requiredTier === LICENSE_TIERS.ENTERPRISE) {
			const isEnterprise = await this.licenseService.isEnterprise();

			if (!isEnterprise) {
				throw new ForbiddenException({
					statusCode: 403,
					error: "Enterprise License Required",
					message:
						"This feature requires an Enterprise license. Please upgrade to access this feature.",
					requiredTier,
				});
			}
		}

		return true;
	}
}

/**
 * Combined guard that checks feature and tier
 * Use this as a single guard when you need all checks
 */
@Injectable()
export class LicenseGuard implements CanActivate {
	constructor(
		private readonly featureGuard: LicenseFeatureGuard,
		private readonly tierGuard: LicenseTierGuard,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		// Run all guards in sequence
		await this.featureGuard.canActivate(context);
		await this.tierGuard.canActivate(context);

		return true;
	}
}

/**
 * License Guard
 *
 * NestJS guards for enforcing license requirements on routes.
 */

import {
	CanActivate,
	ExecutionContext,
	ForbiddenException,
	Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
	REQUIRES_FEATURE_KEY,
	REQUIRES_TIER_KEY,
	REQUIRES_WRITE_ACCESS_KEY,
} from "./decorators.js";
import type { LicenseFeature, LicenseTierType } from "./license.constants.js";
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
				error: "License Required",
				message: `This feature requires the "${requiredFeature}" entitlement. Please upgrade your license.`,
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

		const hasTier = await this.licenseService.hasTier(requiredTier);

		if (!hasTier) {
			throw new ForbiddenException({
				statusCode: 403,
				error: "License Upgrade Required",
				message: `This feature requires the "${requiredTier}" tier or higher. Please upgrade your license.`,
				requiredTier,
			});
		}

		return true;
	}
}

/**
 * Guard that checks if write operations are allowed
 * (Blocks writes when subscription license is expired)
 */
@Injectable()
export class LicenseWriteGuard implements CanActivate {
	constructor(
		private readonly reflector: Reflector,
		private readonly licenseService: LicenseService,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const requiresWriteAccess = this.reflector.getAllAndOverride<boolean>(
			REQUIRES_WRITE_ACCESS_KEY,
			[context.getHandler(), context.getClass()],
		);

		// No write access requirement → allow
		if (!requiresWriteAccess) {
			return true;
		}

		const { allowed, reason } = await this.licenseService.canWrite();

		if (!allowed) {
			throw new ForbiddenException({
				statusCode: 403,
				error: "License Expired",
				message:
					reason || "Write operations are not allowed with an expired license.",
			});
		}

		return true;
	}
}

/**
 * Combined guard that checks feature, tier, and write access
 * Use this as a single guard when you need all checks
 */
@Injectable()
export class LicenseGuard implements CanActivate {
	constructor(
		private readonly featureGuard: LicenseFeatureGuard,
		private readonly tierGuard: LicenseTierGuard,
		private readonly writeGuard: LicenseWriteGuard,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		// Run all guards in sequence
		await this.featureGuard.canActivate(context);
		await this.tierGuard.canActivate(context);
		await this.writeGuard.canActivate(context);

		return true;
	}
}

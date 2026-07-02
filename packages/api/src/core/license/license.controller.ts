/**
 * License Controller
 *
 * Endpoints for license management and status.
 * Simplified for Community/Enterprise model.
 */

import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	HttpStatus,
	Post,
	UseGuards,
} from "@nestjs/common";
import { InternalGuard } from "../../infrastructure/internal/guards/internal.guard.js";
import { Public } from "../auth/public.decorator.js";
import { LicenseService, type LicenseState } from "./license.service.js";

// =============================================================================
// DTOs
// =============================================================================

class ActivateLicenseDto {
	licenseKey!: string;
}

interface LicenseStatusResponse {
	status: "active" | "expired" | "community";
	tier: string;
	licenseType: string;
	features: string[];
	expiresAt: string | null;
	customer?: {
		email?: string;
		name?: string;
	};
}

interface ActivateLicenseResponse {
	success: boolean;
	error?: string;
	license?: LicenseStatusResponse;
}

// =============================================================================
// CONTROLLER
// =============================================================================

@Controller("license")
export class LicenseController {
	constructor(private readonly licenseService: LicenseService) {}

	/**
	 * Get current license status
	 * GET /api/license
	 */
	@Get()
	async getLicenseStatus(): Promise<LicenseStatusResponse> {
		const state = await this.licenseService.getLicenseState();
		return this.formatLicenseResponse(state);
	}

	/**
	 * Activate an Enterprise license key
	 * POST /api/license/activate
	 */
	@Post("activate")
	@HttpCode(HttpStatus.OK)
	async activateLicense(
		@Body() dto: ActivateLicenseDto,
	): Promise<ActivateLicenseResponse> {
		const result = await this.licenseService.activateLicense(dto.licenseKey);

		if (!result.success) {
			return {
				success: false,
				error: result.error,
			};
		}

		return {
			success: true,
			license: result.licenseState
				? this.formatLicenseResponse(result.licenseState)
				: undefined,
		};
	}

	/**
	 * Deactivate current license (revert to Community Edition)
	 * DELETE /api/license
	 */
	@Delete()
	@HttpCode(HttpStatus.OK)
	async deactivateLicense(): Promise<{ success: boolean }> {
		await this.licenseService.deactivateLicense();
		return { success: true };
	}

	/**
	 * Refresh license from server (force revalidation)
	 * POST /api/license/refresh
	 */
	@Post("refresh")
	@HttpCode(HttpStatus.OK)
	async refreshLicense(): Promise<LicenseStatusResponse> {
		const state = await this.licenseService.getLicenseState(true);
		return this.formatLicenseResponse(state);
	}

	/**
	 * Internal endpoint for worker to get license state
	 * GET /api/license/internal
	 *
	 * @Public() skips AuthGuard — InternalGuard handles auth via X-Internal-Secret.
	 */
	@Public()
	@UseGuards(InternalGuard)
	@Get("internal")
	async getLicenseStateInternal(): Promise<{
		tier: string;
		features: string[];
		isValid: boolean;
	}> {
		return this.licenseService.getLicenseStateForWorker();
	}

	// ===========================================================================
	// PRIVATE HELPERS
	// ===========================================================================

	private formatLicenseResponse(state: LicenseState): LicenseStatusResponse {
		let status: "active" | "expired" | "community";

		if (state.licenseType === "none") {
			status = "community";
		} else if (state.isExpired) {
			status = "expired";
		} else {
			status = "active";
		}

		return {
			status,
			tier: state.tier,
			licenseType: state.licenseType,
			features: state.features,
			expiresAt: state.expiresAt?.toISOString() ?? null,
			...(state.customerEmail && {
				customer: {
					email: state.customerEmail,
					name: state.customerName,
				},
			}),
		};
	}
}

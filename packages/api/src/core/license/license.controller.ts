/**
 * License Controller
 *
 * Endpoints for license management and status.
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { LicenseService, type LicenseState } from './license.service.js';

// =============================================================================
// DTOs
// =============================================================================

class ActivateLicenseDto {
  licenseKey!: string;
}

interface LicenseStatusResponse {
  status: 'active' | 'expired' | 'none';
  tier: string;
  licenseType: string;
  features: string[];
  quotas: Record<string, number>;
  expiresAt: string | null;
  isReadOnly: boolean;
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

@Controller('license')
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
   * Activate a license key
   * POST /api/license/activate
   */
  @Post('activate')
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
   * Deactivate current license (revert to free tier)
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
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshLicense(): Promise<LicenseStatusResponse> {
    const state = await this.licenseService.getLicenseState(true);
    return this.formatLicenseResponse(state);
  }

  /**
   * Internal endpoint for worker to get license state
   * GET /api/license/internal
   *
   * Note: This should be protected by internal auth in production
   */
  @Get('internal')
  async getLicenseStateInternal(): Promise<{
    tier: string;
    features: string[];
    quotas: Record<string, number>;
    isValid: boolean;
    isReadOnly: boolean;
  }> {
    return this.licenseService.getLicenseStateForWorker();
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private formatLicenseResponse(state: LicenseState): LicenseStatusResponse {
    let status: 'active' | 'expired' | 'none';

    if (state.licenseType === 'none') {
      status = 'none';
    } else if (state.isExpired) {
      status = 'expired';
    } else {
      status = 'active';
    }

    return {
      status,
      tier: state.tier,
      licenseType: state.licenseType,
      features: state.features,
      quotas: state.quotas,
      expiresAt: state.expiresAt?.toISOString() ?? null,
      isReadOnly: state.isReadOnly,
      ...(state.customerEmail && {
        customer: {
          email: state.customerEmail,
          name: state.customerName,
        },
      }),
    };
  }
}

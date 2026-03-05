import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Redirect,
  Req,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '@prismalens/config';
import { getTemplate } from '@prismalens/integrations';
import { Public } from '../../../core/auth/public.decorator.js';
import { IntegrationsService } from '../integrations.service.js';
import { OAuthService } from './oauth.service.js';

@Controller('integrations/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly oauthService: OAuthService,
    private readonly configService: ConfigService<EnvironmentVariables>,
    private readonly integrationsService: IntegrationsService,
  ) {}

  /**
   * Start OAuth authorization flow.
   * POST /api/integrations/oauth/:integrationId/authorize
   */
  @Post(':integrationId/authorize')
  async authorize(
    @Param('integrationId') integrationId: string,
    @Req() req: { user?: { id: string } },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Authentication required');
    }

    const baseUrl = this.configService.get('PRISMALENS_PUBLIC_URL');
    if (!baseUrl) {
      throw new BadRequestException('PRISMALENS_PUBLIC_URL must be configured');
    }

    const callbackUrl = `${baseUrl}/api/integrations/oauth/callback`;

    const result = await this.oauthService.startAuthorization(
      integrationId,
      userId,
      callbackUrl,
    );

    this.logger.log(
      `Starting OAuth flow for integration ${integrationId}, user: ${userId}`,
    );

    return { redirectUrl: result.url };
  }

  /**
   * OAuth callback handler — single endpoint, provider resolved from state token.
   * GET /api/integrations/oauth/callback
   */
  @Public()
  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const baseUrl = this.configService.get('PRISMALENS_PUBLIC_URL') || '';
    const defaultRedirect = `${baseUrl}/settings`;

    if (error) {
      this.logger.warn(`OAuth error: ${error} - ${errorDescription}`);
      const errorParams = new URLSearchParams({
        status: 'error',
        error,
        ...(errorDescription && { error_description: errorDescription }),
      });
      return { url: `${defaultRedirect}?${errorParams.toString()}` };
    }

    if (!code || !state) {
      const errorParams = new URLSearchParams({
        status: 'error',
        error: 'missing_params',
        error_description: 'Missing authorization code or state',
      });
      return { url: `${defaultRedirect}?${errorParams.toString()}` };
    }

    try {
      const connection = await this.oauthService.handleCallback(code, state);

      this.logger.log(`OAuth completed, connection: ${connection.id}`);

      // Check if this is a VCS integration that needs configuration
      const connectionWithIntegration =
        await this.integrationsService.findConnectionById(connection.id);
      if (connectionWithIntegration) {
        const template = getTemplate(
          connectionWithIntegration.integration.templateId,
        );
        if (template?.category === 'vcs') {
          const configureUrl = `${baseUrl}/settings/integrations/configure`;
          const configParams = new URLSearchParams({
            connectionId: connection.id,
          });
          return { url: `${configureUrl}?${configParams.toString()}` };
        }
      }

      const successParams = new URLSearchParams({
        status: 'success',
        connectionId: connection.id,
      });
      return { url: `${defaultRedirect}?${successParams.toString()}` };
    } catch (err) {
      this.logger.error('OAuth callback failed', err);
      const errorParams = new URLSearchParams({
        status: 'error',
        error: 'callback_failed',
        error_description:
          'OAuth authorization failed. Please try again or check your integration settings.',
      });
      return { url: `${defaultRedirect}?${errorParams.toString()}` };
    }
  }

  /**
   * Refresh OAuth token for a connection.
   * GET /api/integrations/oauth/refresh/:connectionId
   */
  @Get('refresh/:connectionId')
  async refreshToken(
    @Param('connectionId') connectionId: string,
    @Req() req: { user?: { id: string } },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new BadRequestException('Authentication required');
    }

    // Verify the connection belongs to the requesting user
    const existing = await this.integrationsService.findConnectionById(
      connectionId,
      userId,
    );
    if (!existing) {
      return {
        success: false,
        message:
          'Failed to refresh token. Connection may not exist or have a refresh token.',
      };
    }

    const connection = await this.oauthService.refreshToken(connectionId);

    if (!connection) {
      return {
        success: false,
        message:
          'Failed to refresh token. Connection may not exist or have a refresh token.',
      };
    }

    return {
      success: true,
      connectionId: connection.id,
      status: connection.status,
      message: 'Token refreshed successfully',
    };
  }
}

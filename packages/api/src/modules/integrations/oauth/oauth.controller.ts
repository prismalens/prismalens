import {
  Controller,
  Get,
  Query,
  Param,
  Redirect,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthService } from './oauth.service.js';

@Controller('integrations/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(
    private readonly oauthService: OAuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Start OAuth authorization flow.
   *
   * GET /api/integrations/oauth/:provider/authorize
   *
   * Query params:
   * - name: Connection name (required)
   * - redirect_uri: Where to redirect after OAuth (optional, defaults to app callback)
   */
  @Get(':provider/authorize')
  @Redirect()
  async authorize(
    @Param('provider') provider: string,
    @Query('name') name: string,
    @Query('redirect_uri') redirectUri?: string,
  ) {
    if (!name) {
      throw new BadRequestException('Connection name is required');
    }

    // Default redirect URI to our callback endpoint
    const baseUrl = this.configService.get<string>('APP_BASE_URL', 'http://localhost:3001');
    const callbackUri = redirectUri || `${baseUrl}/api/integrations/oauth/${provider}/callback`;

    const authUrl = await this.oauthService.getAuthorizationUrl(
      provider,
      name,
      callbackUri,
    );

    this.logger.log(`Starting OAuth flow for ${provider}, connection: ${name}`);

    return { url: authUrl };
  }

  /**
   * OAuth callback handler.
   *
   * GET /api/integrations/oauth/:provider/callback
   *
   * Query params:
   * - code: Authorization code from provider
   * - state: State parameter for CSRF validation
   * - error: Error code if authorization failed
   * - error_description: Error description
   */
  @Get(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    // Handle OAuth errors
    if (error) {
      this.logger.warn(`OAuth error for ${provider}: ${error} - ${errorDescription}`);
      return {
        success: false,
        error,
        errorDescription,
        message: `OAuth authorization was denied or failed: ${errorDescription || error}`,
      };
    }

    if (!code || !state) {
      throw new BadRequestException('Missing authorization code or state');
    }

    try {
      const connection = await this.oauthService.handleCallback(provider, code, state);

      this.logger.log(`OAuth completed for ${provider}, connection: ${connection.id}`);

      return {
        success: true,
        connectionId: connection.id,
        connectionName: connection.name,
        status: connection.status,
        message: `Successfully connected to ${provider}`,
      };
    } catch (error) {
      this.logger.error(`OAuth callback failed for ${provider}`, error);
      throw error;
    }
  }

  /**
   * Refresh OAuth token for a connection.
   *
   * GET /api/integrations/oauth/:provider/refresh/:connectionId
   */
  @Get(':provider/refresh/:connectionId')
  async refreshToken(
    @Param('provider') provider: string,
    @Param('connectionId') connectionId: string,
  ) {
    const connection = await this.oauthService.refreshToken(connectionId);

    if (!connection) {
      return {
        success: false,
        message: 'Failed to refresh token. Connection may not exist or have a refresh token.',
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

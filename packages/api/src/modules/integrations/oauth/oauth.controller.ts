import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Param,
  Query,
  Redirect,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '@prismalens/config';
import { Public } from '../../../core/auth/public.decorator.js';
import { OAuthService } from './oauth.service.js';
import { IntegrationsService } from '../integrations.service.js';

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
    const baseUrl = this.configService.get('PRISMALENS_PUBLIC_URL');

    // Validate redirect_uri is same-origin when provided
    if (redirectUri) {
      if (!baseUrl) {
        throw new BadRequestException(
          'PRISMALENS_PUBLIC_URL must be configured to use custom redirect_uri',
        );
      }
      try {
        const allowed = new URL(baseUrl);
        const requested = new URL(redirectUri);
        if (requested.origin !== allowed.origin) {
          throw new BadRequestException(
            'redirect_uri must match the application origin',
          );
        }
      } catch (e) {
        if (e instanceof BadRequestException) throw e;
        throw new BadRequestException('Invalid redirect_uri');
      }
    }

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
   *
   * Redirects to frontend settings page with result query params.
   */
  @Public()
  @Get(':provider/callback')
  @Redirect()
  async callback(
    @Param('provider') provider: string,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    // Parse state to get the original redirect URI
    const baseUrl = this.configService.get('PRISMALENS_PUBLIC_URL') || '';
    const defaultRedirect = `${baseUrl}/settings`;

    let frontendRedirect = defaultRedirect;

    // Retrieve redirect URI from trusted server-side state store (not from untrusted base64)
    if (state) {
      const storedRedirectUri = this.oauthService.getStoredRedirectUri(state);
      if (storedRedirectUri && !storedRedirectUri.includes('/api/integrations/oauth/')) {
        // Defense-in-depth: validate origin matches our app
        try {
          if (baseUrl) {
            const allowed = new URL(baseUrl);
            const requested = new URL(storedRedirectUri);
            if (requested.origin === allowed.origin) {
              frontendRedirect = storedRedirectUri;
            }
          }
        } catch {
          // Invalid URL, use default redirect
        }
      }
    }

    // Handle OAuth errors - redirect with error params
    if (error) {
      this.logger.warn(`OAuth error for ${provider}: ${error} - ${errorDescription}`);
      const errorParams = new URLSearchParams({
        oauth: provider,
        status: 'error',
        error: error,
        ...(errorDescription && { error_description: errorDescription }),
      });
      return { url: `${frontendRedirect}?${errorParams.toString()}` };
    }

    if (!code || !state) {
      const errorParams = new URLSearchParams({
        oauth: provider,
        status: 'error',
        error: 'missing_params',
        error_description: 'Missing authorization code or state',
      });
      return { url: `${frontendRedirect}?${errorParams.toString()}` };
    }

    try {
      const connection = await this.oauthService.handleCallback(provider, code, state);

      this.logger.log(`OAuth completed for ${provider}, connection: ${connection.id}`);

      // Check if this is a code_source integration that needs configuration
      const connectionWithDef = await this.integrationsService.findConnectionById(connection.id);
      const isCodeSource = connectionWithDef?.definition?.category === 'code_source';

      if (isCodeSource) {
        // Redirect to configuration page for code_source integrations (GitHub, GitLab, etc.)
        // This allows the user to select organizations and repositories
        const configureUrl = `${baseUrl}/settings/integrations/configure`;
        const configParams = new URLSearchParams({
          connectionId: connection.id,
          provider: provider,
        });
        this.logger.log(`Redirecting to configure page for code_source: ${connection.id}`);
        return { url: `${configureUrl}?${configParams.toString()}` };
      }

      // For non-code_source integrations, redirect with success params as before
      const successParams = new URLSearchParams({
        oauth: provider,
        status: 'success',
        connectionId: connection.id,
      });
      return { url: `${frontendRedirect}?${successParams.toString()}` };
    } catch (err) {
      this.logger.error(`OAuth callback failed for ${provider}`, err);
      const errorMessage = err instanceof Error ? err.message : 'OAuth callback failed';
      const errorParams = new URLSearchParams({
        oauth: provider,
        status: 'error',
        error: 'callback_failed',
        error_description: errorMessage,
      });
      return { url: `${frontendRedirect}?${errorParams.toString()}` };
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

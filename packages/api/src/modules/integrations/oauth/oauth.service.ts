import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Connection } from '@prismalens/database';
import {
  OAuth2Flow,
  getTemplate,
  type OAuth2StoreDeps,
  type OAuthStateData,
} from '@prismalens/integrations';
import { PrismaService } from '../../../core/prisma/prisma.service.js';
import { CredentialsService } from '../crypto/credentials.service.js';
import { IntegrationsService } from '../integrations.service.js';

@Injectable()
export class OAuthService implements OAuth2StoreDeps {
  private readonly logger = new Logger(OAuthService.name);
  private readonly oauth2Flow: OAuth2Flow;

  constructor(
    private readonly prisma: PrismaService,
    private readonly credentialsService: CredentialsService,
    private readonly integrationsService: IntegrationsService,
  ) {
    this.oauth2Flow = new OAuth2Flow(credentialsService.getVault(), this);
  }

  // =========================================================================
  // OAuth2StoreDeps implementation (DB-backed state)
  // =========================================================================

  async saveOAuthState(data: OAuthStateData): Promise<void> {
    await this.prisma.oAuthState.create({
      data: {
        state: data.state,
        integrationId: data.integrationId,
        userId: data.userId,
        organizationId: data.organizationId,
        callbackUrl: data.callbackUrl,
        connectionConfigEnc: data.connectionConfigEnc
          ? (new Uint8Array(
              data.connectionConfigEnc,
            ) as Uint8Array<ArrayBuffer>)
          : null,
        codeVerifier: data.codeVerifier,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        expiresAt: data.expiresAt,
      },
    });
  }

  async getOAuthState(stateToken: string): Promise<OAuthStateData | null> {
    const row = await this.prisma.oAuthState.findUnique({
      where: { state: stateToken },
    });
    if (!row) return null;

    return {
      state: row.state,
      integrationId: row.integrationId,
      userId: row.userId,
      organizationId: row.organizationId ?? undefined,
      callbackUrl: row.callbackUrl,
      connectionConfigEnc: row.connectionConfigEnc
        ? Buffer.from(row.connectionConfigEnc)
        : null,
      codeVerifier: row.codeVerifier,
      metadata: row.metadata
        ? (JSON.parse(row.metadata as string) as Record<string, unknown>)
        : undefined,
      expiresAt: row.expiresAt,
    };
  }

  async deleteOAuthState(stateToken: string): Promise<void> {
    await this.prisma.oAuthState.delete({
      where: { state: stateToken },
    });
  }

  // =========================================================================
  // Public OAuth flow methods
  // =========================================================================

  async startAuthorization(
    integrationId: string,
    userId: string,
    callbackUrl: string,
  ): Promise<{ url: string; state: string }> {
    const integration =
      await this.integrationsService.findIntegrationById(integrationId);
    if (!integration) {
      throw new NotFoundException('Integration not found');
    }

    const template = getTemplate(integration.templateId);
    if (!template) {
      throw new NotFoundException(
        `Template '${integration.templateId}' not found`,
      );
    }

    if (template.authMode !== 'oauth2') {
      throw new BadRequestException(
        `Template '${template.id}' does not support OAuth`,
      );
    }

    const { clientId } =
      this.integrationsService.getClientCredentials(integration);

    const scopes = Array.isArray(integration.scopes)
      ? integration.scopes
      : (JSON.parse(integration.scopes || '[]') as string[]);

    return this.oauth2Flow.startAuthorization({
      template,
      integrationId,
      userId,
      clientId,
      callbackUrl,
      scopes,
    });
  }

  async handleCallback(code: string, stateToken: string): Promise<Connection> {
    const oauthState = await this.getOAuthState(stateToken);
    if (!oauthState) {
      throw new BadRequestException('Invalid or expired OAuth state');
    }
    if (oauthState.expiresAt < new Date()) {
      await this.deleteOAuthState(stateToken);
      throw new BadRequestException('OAuth state expired');
    }
    await this.deleteOAuthState(stateToken);

    const integration = await this.integrationsService.findIntegrationById(
      oauthState.integrationId,
    );
    if (!integration) {
      throw new BadRequestException('Integration no longer exists');
    }

    const template = getTemplate(integration.templateId);
    if (!template) {
      throw new BadRequestException('Template not found');
    }

    const { clientId, clientSecret } =
      this.integrationsService.getClientCredentials(integration);

    const tokenResult = await this.oauth2Flow.exchangeCodeForTokens(
      template,
      code,
      oauthState,
      clientId,
      clientSecret,
    );

    return this.prisma.connection.create({
      data: {
        integrationId: integration.id,
        userId: oauthState.userId,
        organizationId: oauthState.organizationId,
        credentialsEnc: this.credentialsService.encrypt({
          accessToken: tokenResult.accessToken,
          refreshToken: tokenResult.refreshToken ?? null,
          tokenType: tokenResult.tokenType,
        }),
        connectionConfigEnc: oauthState.connectionConfigEnc
          ? (new Uint8Array(
              oauthState.connectionConfigEnc,
            ) as Uint8Array<ArrayBuffer>)
          : null,
        tokenExpiresAt: tokenResult.expiresIn
          ? new Date(Date.now() + tokenResult.expiresIn * 1000)
          : null,
        tokenType: tokenResult.tokenType,
        grantedScopes: JSON.stringify(tokenResult.grantedScopes ?? []),
        metadataEnc: tokenResult.metadata
          ? this.credentialsService.encrypt(tokenResult.metadata)
          : null,
        status: 'ACTIVE',
      },
    });
  }

  async refreshToken(connectionId: string): Promise<Connection | null> {
    const connection = await this.prisma.connection.findUnique({
      where: { id: connectionId },
      include: { integration: true },
    });

    if (!connection) return null;

    const template = getTemplate(connection.integration.templateId);
    if (!template?.oauth2) {
      this.logger.warn(
        `Cannot refresh: template ${connection.integration.templateId} has no oauth2 config`,
      );
      return null;
    }

    const vault = this.credentialsService.getVault();
    const credentials = vault.decryptJSON<{
      accessToken: string;
      refreshToken?: string;
    }>(Buffer.from(connection.credentialsEnc));

    if (!credentials.refreshToken) {
      this.logger.warn(
        `No refresh token available for connection ${connectionId}`,
      );
      return null;
    }

    const { clientId, clientSecret } =
      this.integrationsService.getClientCredentials(connection.integration);

    try {
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: 'refresh_token',
      });

      const response = await fetch(template.oauth2.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = (await response.json()) as Record<string, unknown>;

      if (!data.access_token || typeof data.access_token !== 'string') {
        throw new Error('OAuth token refresh returned no access_token');
      }

      const newCredentials = {
        accessToken: data.access_token,
        refreshToken:
          typeof data.refresh_token === 'string'
            ? data.refresh_token
            : credentials.refreshToken,
        tokenType:
          typeof data.token_type === 'string' ? data.token_type : 'bearer',
      };

      const expiresIn = data.expires_in as number | undefined;

      return this.prisma.connection.update({
        where: { id: connectionId },
        data: {
          credentialsEnc: this.credentialsService.encrypt(newCredentials),
          tokenExpiresAt: expiresIn
            ? new Date(Date.now() + expiresIn * 1000)
            : null,
          status: 'ACTIVE',
          lastRefreshedAt: new Date(),
          lastErrorMessage: null,
          lastErrorAt: null,
          consecutiveErrors: 0,
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Token refresh failed';
      this.logger.error(
        `Failed to refresh token for ${connectionId}: ${errorMessage}`,
      );

      await this.prisma.connection.update({
        where: { id: connectionId },
        data: {
          status: 'REFRESH_FAILED',
          lastErrorMessage: errorMessage,
          lastErrorAt: new Date(),
          consecutiveErrors: connection.consecutiveErrors + 1,
        },
      });

      return null;
    }
  }
}

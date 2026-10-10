// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	BadRequestException,
	Injectable,
	Logger,
	NotFoundException,
	type OnModuleInit,
} from "@nestjs/common";
import type { ServiceIntegrationWithStatus } from "@prismalens/contracts";
import type {
	Connection,
	Integration,
	ServiceIntegration,
} from "@prismalens/database";
import {
	type AuthenticatedRequestFn,
	AuthManager,
	type AuthManagerDeps,
	type AuthTemplate,
	createAdapter,
	getAllTemplates,
	getTemplate,
	isLegacyTemplateId,
	urlOnlyRequestFn,
} from "@prismalens/integrations";
import {
	GIT_HOST_RULE,
	GitCredential,
	normalizeGitHost,
	repoPath,
	urlHost,
} from "../../core/harness/git-credential.js";
import { diagnoseGitFailure } from "../../core/harness/git-failure.js";
import {
	effectiveGitUrl,
	GIT_LS_REMOTE_TIMEOUT_MS,
	GitSpawnError,
	remoteGitEnv,
	spawnGit,
} from "../../core/harness/git-spawn.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import {
	integrationKindFor,
	TelemetryService,
} from "../../core/telemetry/telemetry.service.js";
import { CredentialsService } from "./crypto/credentials.service.js";
import type {
	CreateConnectionDto,
	CreateIntegrationDto,
	CreateServiceIntegrationDto,
} from "./dto/create-connection.dto.js";
import type {
	UpdateConnectionDto,
	UpdateIntegrationDto,
} from "./dto/update-connection.dto.js";
import { type HostToken, pickOf, readHostToken } from "./host-token.js";

export interface ConnectionWithIntegration extends Connection {
	integration: Integration;
}

export interface IntegrationContext {
	type: string;
	connectionId: string;
	credentials: Record<string, unknown>;
	config: Record<string, unknown>;
	specUrl?: string | null;
	serviceOverrides?: Record<string, unknown>;
}

/** Upper bound for connection queries — prevents unbounded result sets in single-tenant deployments */
const MAX_CONNECTIONS_PER_QUERY = 1000;

export interface TestConnectionResult {
	success: boolean;
	error?: string;
	details?: string[];
	untested?: boolean;
}

/** Repositories a git host token's Test tries, and how many at once (a proxied request must not outlive them). */
const TEST_REPO_LIMIT = 10;
const TEST_CONCURRENCY = 3;

const EXPIRY_HEADER = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC$/;

/** GitHub's `github-authentication-token-expiration` header, e.g. `2026-10-17 09:30:00 UTC`; null when absent or another shape. */
export function parseTokenExpiration(raw: string | null): Date | null {
	const m = raw ? EXPIRY_HEADER.exec(raw.trim()) : null;
	if (!m) return null;
	const at = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
	return Number.isNaN(at.getTime()) ? null : at;
}

/** `host` of a git host token form, normalised; the API stores `host[:port]` only. */
function normalizedConfig(
	templateId: string,
	config: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (templateId !== "git-host-token" || !config) return config;
	const host = normalizeGitHost(config.host ?? "");
	if (!host) throw new BadRequestException(GIT_HOST_RULE);
	return { ...config, host };
}

@Injectable()
export class IntegrationsService implements OnModuleInit {
	private readonly logger = new Logger(IntegrationsService.name);
	private authManager!: AuthManager;
	private authManagerInitialized = false;

	constructor(
		private readonly prisma: PrismaService,
		private readonly credentialsService: CredentialsService,
		private readonly telemetry: TelemetryService,
	) {}

	onModuleInit(): void {
		this.initAuthManager();
	}

	private initAuthManager(): void {
		if (this.authManagerInitialized) return;
		const vault = this.credentialsService.getVault();

		const deps: AuthManagerDeps = {
			getConnection: async (connectionId: string) => {
				const conn = await this.prisma.connection.findUnique({
					where: { id: connectionId },
					include: { integration: true },
				});
				if (!conn) return null;
				return {
					id: conn.id,
					integrationId: conn.integrationId,
					credentialsEnc: Buffer.from(conn.credentialsEnc),
					tokenExpiresAt: conn.tokenExpiresAt,
				};
			},
			getTemplate: async (integrationId: string) => {
				const integration = await this.prisma.integration.findUnique({
					where: { id: integrationId },
				});
				if (!integration) return null;
				const template = getTemplate(integration.templateId);
				if (!template) return null;
				const clientId = integration.clientIdEnc
					? vault.decrypt(Buffer.from(integration.clientIdEnc))
					: "";
				const clientSecret = integration.clientSecretEnc
					? vault.decrypt(Buffer.from(integration.clientSecretEnc))
					: "";
				return { template, clientId, clientSecret };
			},
			updateConnectionTokens: async (connectionId, data) => {
				await this.prisma.connection.update({
					where: { id: connectionId },
					data: {
						credentialsEnc: new Uint8Array(
							data.credentialsEnc,
						) as Uint8Array<ArrayBuffer>,
						tokenExpiresAt: data.tokenExpiresAt,
						lastRefreshedAt: data.lastRefreshedAt,
						status: data.status,
						consecutiveErrors: data.consecutiveErrors,
					},
				});
			},
			markConnectionError: async (connectionId, error, status) => {
				await this.prisma.connection.update({
					where: { id: connectionId },
					data: {
						status,
						lastErrorMessage: error,
						lastErrorAt: new Date(),
						consecutiveErrors: { increment: 1 },
					},
				});
			},
			getTemplateForConnection: async (connectionId: string) => {
				const conn = await this.prisma.connection.findUnique({
					where: { id: connectionId },
					include: { integration: true },
				});
				if (!conn) return null;
				return getTemplate(conn.integration.templateId) ?? null;
			},
			getConnectionCredentials: async (connectionId: string) => {
				const conn = await this.prisma.connection.findUnique({
					where: { id: connectionId },
				});
				if (!conn) return null;
				return this.credentialsService.decrypt<Record<string, unknown>>(
					Buffer.from(conn.credentialsEnc),
				);
			},
		};

		this.authManager = new AuthManager(vault, deps);
		this.authManagerInitialized = true;
	}

	private getAuthManager(): AuthManager {
		return this.authManager;
	}

	/**
	 * Create a bound authenticated request function for a connection.
	 * This replaces raw accessToken passing — the git provider calls
	 * request(method, path) and AuthManager handles auth headers + token refresh.
	 */
	public createRequestFn(connectionId: string): AuthenticatedRequestFn {
		const authManager = this.getAuthManager();
		return (method, path, opts) =>
			authManager.request(connectionId, method, path, opts);
	}

	// =========================================================================
	// TEMPLATES (from @prismalens/integrations package)
	// =========================================================================

	findAllTemplates(): AuthTemplate[] {
		return getAllTemplates();
	}

	findTemplateById(id: string): AuthTemplate | undefined {
		return getTemplate(id);
	}

	// =========================================================================
	// INTEGRATIONS (OAuth client creds / provider instances)
	// =========================================================================

	async createIntegration(dto: CreateIntegrationDto): Promise<Integration> {
		const template = getTemplate(dto.templateId);
		if (!template) {
			throw new NotFoundException(`Template '${dto.templateId}' not found`);
		}

		const clientIdEnc = dto.clientId
			? this.credentialsService.encrypt(dto.clientId)
			: null;
		const clientSecretEnc = dto.clientSecret
			? this.credentialsService.encrypt(dto.clientSecret)
			: null;

		// For api_key/basic templates: only one integration per template allowed
		// (multiple connections go under the single integration)
		if (template.authMode === "api_key" || template.authMode === "basic") {
			const existingForTemplate = await this.prisma.integration.findFirst({
				where: { templateId: dto.templateId },
			});
			if (existingForTemplate) {
				throw new BadRequestException(
					`A ${template.name} integration already exists. Add connections to it instead.`,
				);
			}
		}

		// Enforce unique label per template
		const existingLabel = await this.prisma.integration.findFirst({
			where: { templateId: dto.templateId, label: dto.label },
		});
		if (existingLabel) {
			throw new BadRequestException(
				`An integration named "${dto.label}" already exists for this provider`,
			);
		}

		return this.prisma.integration.create({
			data: {
				templateId: dto.templateId,
				templateVersion: template.version,
				label: dto.label,
				clientIdEnc,
				clientSecretEnc,
				scopes: JSON.stringify(dto.scopes ?? template.oauth2?.scopes ?? []),
				callbackUrl: dto.callbackUrl,
			},
		});
	}

	async findAllIntegrations(options?: {
		templateId?: string;
	}): Promise<Integration[]> {
		return this.prisma.integration.findMany({
			where: {
				...(options?.templateId && { templateId: options.templateId }),
				enabled: true,
			},
			orderBy: { createdAt: "desc" },
		});
	}

	async findIntegrationById(id: string): Promise<Integration | null> {
		return this.prisma.integration.findUnique({ where: { id } });
	}

	async updateIntegration(
		id: string,
		dto: UpdateIntegrationDto,
	): Promise<Integration | null> {
		const existing = await this.findIntegrationById(id);
		if (!existing) return null;

		const updateData: Record<string, unknown> = {};

		if (dto.label !== undefined) updateData.label = dto.label;
		if (dto.scopes !== undefined)
			updateData.scopes = JSON.stringify(dto.scopes);
		if (dto.callbackUrl !== undefined) updateData.callbackUrl = dto.callbackUrl;
		if (dto.enabled !== undefined) updateData.enabled = dto.enabled;
		if (dto.clientId !== undefined) {
			updateData.clientIdEnc = this.credentialsService.encrypt(dto.clientId);
		}
		if (dto.clientSecret !== undefined) {
			updateData.clientSecretEnc = this.credentialsService.encrypt(
				dto.clientSecret,
			);
		}

		return this.prisma.integration.update({
			where: { id },
			data: updateData,
		});
	}

	async deleteIntegration(id: string): Promise<boolean> {
		try {
			await this.prisma.$transaction(async (tx) => {
				const connections = await tx.connection.findMany({
					where: { integrationId: id },
					select: { id: true },
				});
				await releaseRepositories(
					tx,
					connections.map((c) => c.id),
				);
				await tx.integration.delete({ where: { id } });
			});
			return true;
		} catch {
			return false;
		}
	}

	getClientCredentials(integration: Integration): {
		clientId: string;
		clientSecret: string;
	} {
		const vault = this.credentialsService.getVault();
		if (!integration.clientIdEnc || !integration.clientSecretEnc) {
			throw new BadRequestException(
				"Integration does not have OAuth credentials configured",
			);
		}
		return {
			clientId: vault.decrypt(Buffer.from(integration.clientIdEnc)),
			clientSecret: vault.decrypt(Buffer.from(integration.clientSecretEnc)),
		};
	}

	// =========================================================================
	// CONNECTIONS (user tokens / API keys)
	// =========================================================================

	async createConnection(dto: CreateConnectionDto): Promise<Connection> {
		const integration = await this.findIntegrationById(dto.integrationId);
		if (!integration) {
			throw new NotFoundException("Integration not found");
		}

		// Enforce unique label per integration
		const existing = await this.prisma.connection.findFirst({
			where: { integrationId: dto.integrationId, label: dto.label },
		});
		if (existing) {
			throw new BadRequestException(
				`A connection named "${dto.label}" already exists for this integration`,
			);
		}

		const connectionConfig = normalizedConfig(
			integration.templateId,
			dto.connectionConfig,
		);
		const connection = await this.prisma.connection.create({
			data: {
				integrationId: dto.integrationId,
				label: dto.label,
				credentialsEnc: this.credentialsService.encrypt(dto.credentials),
				connectionConfigEnc: connectionConfig
					? this.credentialsService.encrypt(connectionConfig)
					: null,
				status: "ACTIVE",
			},
		});
		// The vendor only. Not the label, the template id, or anything encrypted.
		await this.telemetry.capture("integration_configured", {
			kind: integrationKindFor(integration.templateId, connectionConfig?.host),
		});
		return connection;
	}

	async findAllConnections(options?: {
		status?: string;
		integrationId?: string;
	}): Promise<ConnectionWithIntegration[]> {
		return this.prisma.connection.findMany({
			where: {
				...(options?.status && { status: options.status }),
				...(options?.integrationId && {
					integrationId: options.integrationId,
				}),
			},
			include: { integration: true },
			orderBy: { createdAt: "desc" },
		});
	}

	async findConnectionById(
		id: string,
	): Promise<ConnectionWithIntegration | null> {
		return this.prisma.connection.findFirst({
			where: { id },
			include: { integration: true },
		});
	}

	async updateConnection(
		id: string,
		dto: UpdateConnectionDto,
	): Promise<Connection | null> {
		const connection = await this.findConnectionById(id);
		if (!connection) return null;

		const updateData: Record<string, unknown> = {};

		if (dto.status !== undefined) updateData.status = dto.status;
		if (dto.credentials) {
			updateData.credentialsEnc = this.credentialsService.encrypt(
				dto.credentials,
			);
		}
		if (dto.connectionConfig) {
			updateData.connectionConfigEnc = this.credentialsService.encrypt(
				normalizedConfig(
					connection.integration.templateId,
					dto.connectionConfig,
				),
			);
		}

		return this.prisma.connection.update({
			where: { id },
			data: updateData,
		});
	}

	/**
	 * Repositories found through the connection keep their URL and resolve Auto, and
	 * picks of it are cleared, in one transaction; nothing a user typed is deleted (#673).
	 * A removed template's Integration row goes too: it holds that app's private key.
	 */
	async deleteConnection(id: string): Promise<boolean> {
		const connection = await this.findConnectionById(id);
		if (!connection) return false;

		try {
			await this.prisma.$transaction(async (tx) => {
				await releaseRepositories(tx, [id]);
				await tx.connection.delete({ where: { id } });
				if (isLegacyTemplateId(connection.integration.templateId)) {
					const others = await tx.connection.count({
						where: { integrationId: connection.integrationId },
					});
					if (others === 0)
						await tx.integration.delete({
							where: { id: connection.integrationId },
						});
				}
			});
			return true;
		} catch {
			return false;
		}
	}

	/** A git host connection's host and fingerprint, for Settings; null for any other connection. */
	gitHostInfo(
		conn: ConnectionWithIntegration,
	): { host: string; fingerprint: string } | null {
		const t = readHostToken(conn, this.credentialsService);
		return t ? { host: t.host, fingerprint: t.fingerprint } : null;
	}

	/**
	 * A token git refused (or found expired) during a save, a run or a follow-up: the
	 * connection shows it in Settings. Written once per distinct message.
	 */
	async recordGitFailure(
		connectionId: string,
		failure: { code: string; message: string },
	): Promise<void> {
		const status = failure.code === "token-expired" ? "TOKEN_EXPIRED" : "ERROR";
		const message = failure.message.slice(0, 500);
		const conn = await this.prisma.connection.findUnique({
			where: { id: connectionId },
			select: { status: true, lastErrorMessage: true },
		});
		if (!conn || (conn.status === status && conn.lastErrorMessage === message))
			return;
		await this.prisma.connection.update({
			where: { id: connectionId },
			data: {
				status,
				lastErrorMessage: message,
				lastErrorAt: new Date(),
				consecutiveErrors: { increment: 1 },
			},
		});
	}

	async connectionBaseUrl(connectionId: string): Promise<string | null> {
		const conn = await this.prisma.connection.findUnique({
			where: { id: connectionId },
			select: { connectionConfigEnc: true },
		});
		return conn ? this.baseUrlOf(conn) : null;
	}

	/** The URL a URL-only source was added with; null when it has none. */
	baseUrlOf(conn: {
		connectionConfigEnc: Uint8Array | Buffer | null;
	}): string | null {
		if (!conn.connectionConfigEnc) return null;
		try {
			const config = this.credentialsService.decrypt<Record<string, unknown>>(
				Buffer.from(conn.connectionConfigEnc),
			);
			return typeof config.baseUrl === "string" ? config.baseUrl : null;
		} catch {
			return null;
		}
	}

	async testConnection(id: string): Promise<TestConnectionResult> {
		const connection = await this.findConnectionById(id);
		if (!connection) {
			throw new NotFoundException("Connection not found");
		}
		if (isLegacyTemplateId(connection.integration.templateId))
			return {
				success: false,
				error:
					"This connection no longer works: GitHub App connections were removed. Delete it.",
			};

		try {
			const template = getTemplate(connection.integration.templateId);
			let testResult: TestConnectionResult;

			if (template?.gitHost) {
				testResult = await this.testGitHostToken(connection);
				if (testResult.untested) return testResult;
			} else if (template?.urlOnly && template.verify) {
				const base = await this.connectionBaseUrl(id);
				if (!base) {
					testResult = { success: false, error: "Connection has no baseUrl" };
				} else {
					const res = await urlOnlyRequestFn(base)(
						template.verify.method,
						template.verify.path,
					);
					testResult = res.ok
						? { success: true }
						: {
								success: false,
								error: `${template.name} answered ${res.status}`,
							};
				}
			} else {
				testResult = await this.getAuthManager().verifyConnection(id);
			}

			await this.prisma.connection.update({
				where: { id },
				data: {
					status: testResult.success ? "ACTIVE" : "ERROR",
					lastUsedAt: new Date(),
					lastErrorMessage: testResult.success
						? null
						: (testResult.error ?? null),
					lastErrorAt: testResult.success ? null : new Date(),
					consecutiveErrors: testResult.success
						? 0
						: connection.consecutiveErrors + 1,
				},
			});

			return testResult;
		} catch (error) {
			const rawMessage =
				error instanceof Error ? error.message : "Unknown error";
			const errorMessage = rawMessage.slice(0, 500);
			await this.prisma.connection.update({
				where: { id },
				data: {
					status: "ERROR",
					lastErrorMessage: errorMessage,
					lastErrorAt: new Date(),
					consecutiveErrors: connection.consecutiveErrors + 1,
				},
			});
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * A git host token's Test: `git ls-remote` against each saved repository on its host,
	 * three at a time, and for github.com its expiry and a 401 check. With no repository
	 * to try it says so and leaves the status alone, rather than showing a mistyped token green.
	 */
	private async testGitHostToken(
		connection: ConnectionWithIntegration,
	): Promise<TestConnectionResult> {
		const token = readHostToken(connection, this.credentialsService);
		if (!token)
			return { success: false, error: "This connection has no host or token." };
		const details = await this.lsRemoteMatching(token);
		const api =
			token.host === "github.com" ? await this.githubUser(token) : null;
		if (api?.expiresAt !== undefined)
			await this.prisma.connection.update({
				where: { id: connection.id },
				data: { tokenExpiresAt: api.expiresAt },
			});
		if (api?.rejected) {
			const message = `github.com rejected token "${token.label}" (fp ${token.fingerprint}). It was revoked or mistyped; replace it.`;
			return { success: false, error: message, details: [message, ...details] };
		}
		if (details.length === 0)
			return {
				success: false,
				untested: true,
				details: [
					`No repository on ${token.host} yet. Add one to a service, then test again.`,
				],
			};
		const failed = details.find((d) => !d.startsWith("ok "));
		return failed
			? { success: false, error: failed, details }
			: { success: true, details };
	}

	private async lsRemoteMatching(token: HostToken): Promise<string[]> {
		const rows = await this.prisma.repository.findMany({
			where: { sourceKind: "url" },
			select: { url: true },
			orderBy: { updatedAt: "desc" },
		});
		const targets: string[] = [];
		for (const { url } of rows) {
			if (targets.length >= TEST_REPO_LIMIT) break;
			const effective = await effectiveGitUrl(url);
			if (/^https:\/\//i.test(effective) && urlHost(effective) === token.host)
				targets.push(effective);
		}
		const display = {
			source: "connection" as const,
			label: `token ${token.label}`,
			via: token.templateId,
			fingerprint: token.fingerprint,
		};
		const cred = new GitCredential(display, token.token, { host: token.host });
		const details: string[] = [];
		for (let i = 0; i < targets.length; i += TEST_CONCURRENCY) {
			const batch = targets.slice(i, i + TEST_CONCURRENCY);
			details.push(
				...(await Promise.all(
					batch.map(async (url) => {
						try {
							await spawnGit(
								["ls-remote", "--exit-code", "--heads", "--", url],
								{
									env: await remoteGitEnv(cred.envInput(url)),
									timeoutMs: GIT_LS_REMOTE_TIMEOUT_MS,
								},
							);
							return `ok ${repoPath(url)}`;
						} catch (err) {
							// --exit-code answers 2 for a reachable repository with no branches yet.
							if (
								err instanceof GitSpawnError &&
								err.exitCode === 2 &&
								!err.stderr.trim()
							)
								return `ok ${repoPath(url)}`;
							return diagnoseGitFailure({
								stderr:
									err instanceof GitSpawnError
										? err.stderr || err.message
										: String(err),
								credential: display,
								host: token.host,
								repo: repoPath(url),
								tokenExpiresAt: token.tokenExpiresAt,
								sshAuthSockSet: !!process.env.SSH_AUTH_SOCK,
							}).message;
						}
					}),
				)),
			);
		}
		return details;
	}

	/** github.com's view of the token: refused, or when it expires (undefined when the call failed). */
	private async githubUser(
		token: HostToken,
	): Promise<{ rejected: boolean; expiresAt?: Date | null }> {
		try {
			const res = await fetch("https://api.github.com/user", {
				headers: {
					Authorization: `Bearer ${token.token}`,
					Accept: "application/vnd.github+json",
				},
				signal: AbortSignal.timeout(10_000),
			});
			if (res.status === 401) return { rejected: true };
			const raw = res.headers.get("github-authentication-token-expiration");
			const expiresAt = parseTokenExpiration(raw);
			if (raw && !expiresAt)
				this.logger.debug(`Unparsed token expiration header: ${raw}`);
			return { rejected: false, expiresAt };
		} catch (err) {
			this.logger.debug(
				`github.com token check failed: ${err instanceof Error ? err.message : String(err)}`,
			);
			return { rejected: false };
		}
	}

	// =========================================================================
	// TOKEN RESOLUTION (auth-mode-aware)
	// =========================================================================

	async resolveAccessToken(connectionId: string): Promise<string> {
		return this.getAuthManager().resolveAccessToken(connectionId);
	}

	async updateConnectionConfig(
		connectionId: string,
		config: Record<string, unknown>,
	): Promise<Connection> {
		const connection = await this.findConnectionById(connectionId);
		if (!connection) {
			throw new NotFoundException("Connection not found");
		}

		const existingConfig = connection.connectionConfigEnc
			? this.credentialsService.decrypt<Record<string, unknown>>(
					Buffer.from(connection.connectionConfigEnc),
				)
			: {};
		const mergedConfig = { ...existingConfig, ...config };

		return this.prisma.connection.update({
			where: { id: connectionId },
			data: {
				connectionConfigEnc: this.credentialsService.encrypt(mergedConfig),
			},
		});
	}

	// =========================================================================
	// SERVICE INTEGRATIONS (Per-service overrides)
	// =========================================================================

	async createServiceIntegration(
		dto: CreateServiceIntegrationDto,
	): Promise<ServiceIntegration> {
		const connection = await this.findConnectionById(dto.connectionId);
		if (!connection) {
			throw new NotFoundException("Connection not found");
		}

		const existing = await this.prisma.serviceIntegration.findUnique({
			where: {
				serviceId_connectionId: {
					serviceId: dto.serviceId,
					connectionId: dto.connectionId,
				},
			},
		});

		if (existing) {
			throw new BadRequestException(
				"A service integration override already exists for this connection",
			);
		}

		return this.prisma.serviceIntegration.create({
			data: {
				serviceId: dto.serviceId,
				connectionId: dto.connectionId,
				config: dto.config ? JSON.stringify(dto.config) : null,
				priority: dto.priority ?? 0,
				isEnabled: dto.isEnabled ?? true,
			},
		});
	}

	async updateServiceIntegrationById(
		id: string,
		data: {
			priority?: number;
			config?: Record<string, unknown>;
			isEnabled?: boolean;
		},
	): Promise<ServiceIntegration | null> {
		const existing = await this.prisma.serviceIntegration.findUnique({
			where: { id },
		});
		if (!existing) return null;

		const updateData: Record<string, unknown> = {};
		if (data.priority !== undefined) updateData.priority = data.priority;
		if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
		if (data.config !== undefined)
			updateData.config = JSON.stringify(data.config);

		return this.prisma.serviceIntegration.update({
			where: { id },
			data: updateData,
		});
	}

	async deleteServiceIntegrationById(id: string): Promise<boolean> {
		try {
			await this.prisma.serviceIntegration.delete({ where: { id } });
			return true;
		} catch {
			return false;
		}
	}

	async getServiceIntegrationsWithStatus(
		serviceId: string,
	): Promise<ServiceIntegrationWithStatus[]> {
		const activeConnections = await this.prisma.connection.findMany({
			where: { status: "ACTIVE" },
			include: { integration: true },
			take: MAX_CONNECTIONS_PER_QUERY,
		});

		const serviceOverrides = await this.prisma.serviceIntegration.findMany({
			where: { serviceId },
			include: {
				connection: {
					include: { integration: true },
				},
			},
		});

		const overridesByConnectionId = new Map(
			serviceOverrides.map((so) => [so.connectionId, so]),
		);

		const results: ServiceIntegrationWithStatus[] = [];

		for (const conn of activeConnections) {
			const template = getTemplate(conn.integration.templateId);
			const override = overridesByConnectionId.get(conn.id);
			const connectionConfig = conn.connectionConfigEnc
				? this.credentialsService.decrypt<Record<string, unknown>>(
						Buffer.from(conn.connectionConfigEnc),
					)
				: null;
			let serviceConfig: Record<string, unknown> | null = null;
			if (override?.config) {
				try {
					serviceConfig = JSON.parse(override.config) as Record<
						string,
						unknown
					>;
				} catch {
					this.logger.warn(
						`Invalid JSON in service integration config: ${override.id}`,
					);
				}
			}

			results.push({
				connectionId: conn.id,
				connectionName: conn.integration.label,
				templateId: conn.integration.templateId,
				templateName: template?.name ?? conn.integration.templateId,
				category: template?.category ?? "unknown",
				status: conn.status as
					| "ACTIVE"
					| "TOKEN_EXPIRED"
					| "REFRESH_FAILED"
					| "CREDENTIALS_INVALID"
					| "REVOKED"
					| "ERROR",
				isGlobal: true,
				hasOverride: !!override,
				overrideId: override?.id,
				globalConfig: connectionConfig,
				serviceConfig,
				effectiveConfig: serviceConfig ?? connectionConfig,
			});
		}

		return results;
	}

	async findServiceIntegrations(serviceId: string): Promise<
		(ServiceIntegration & {
			connection: ConnectionWithIntegration;
		})[]
	> {
		return this.prisma.serviceIntegration.findMany({
			where: { serviceId, isEnabled: true },
			include: {
				connection: {
					include: { integration: true },
				},
			},
			orderBy: { priority: "desc" },
		});
	}

	// =========================================================================
	// INTEGRATION CONTEXT FOR WORKER
	// =========================================================================

	async getIntegrationsForService(
		serviceId?: string,
	): Promise<IntegrationContext[]> {
		const contexts: IntegrationContext[] = [];

		const activeConnections = await this.prisma.connection.findMany({
			where: { status: "ACTIVE" },
			include: { integration: true },
			take: MAX_CONNECTIONS_PER_QUERY,
		});

		for (const conn of activeConnections) {
			const template = getTemplate(conn.integration.templateId);

			if (!template) continue;
			const credentials = this.credentialsService.decrypt<
				Record<string, unknown>
			>(Buffer.from(conn.credentialsEnc));

			const config = conn.connectionConfigEnc
				? this.credentialsService.decrypt<Record<string, unknown>>(
						Buffer.from(conn.connectionConfigEnc),
					)
				: {};

			contexts.push({
				type:
					createAdapter(conn.integration.templateId)?.name ??
					conn.integration.templateId,
				connectionId: conn.id,
				credentials,
				config,
			});
		}

		if (serviceId) {
			const serviceIntegrations = await this.findServiceIntegrations(serviceId);

			for (const si of serviceIntegrations) {
				const existingIndex = contexts.findIndex(
					(c) => c.connectionId === si.connectionId,
				);

				let serviceOverrides: Record<string, unknown> | undefined;
				if (si.config) {
					try {
						serviceOverrides = JSON.parse(si.config) as Record<string, unknown>;
					} catch {
						this.logger.warn(
							`Invalid JSON in service integration config: ${si.id}`,
						);
					}
				}

				if (existingIndex >= 0) {
					contexts[existingIndex] = {
						...contexts[existingIndex],
						serviceOverrides,
					};
				} else {
					const credentials = this.credentialsService.decrypt<
						Record<string, unknown>
					>(Buffer.from(si.connection.credentialsEnc));
					const config = si.connection.connectionConfigEnc
						? this.credentialsService.decrypt<Record<string, unknown>>(
								Buffer.from(si.connection.connectionConfigEnc),
							)
						: {};

					contexts.push({
						type:
							createAdapter(si.connection.integration.templateId)?.name ??
							si.connection.integration.templateId,
						connectionId: si.connectionId,
						credentials,
						config,
						serviceOverrides,
					});
				}
			}
		}

		return contexts;
	}

	async getIntegrationsByConnectionIds(
		connectionIds: string[],
	): Promise<IntegrationContext[]> {
		if (connectionIds.length === 0) return [];

		const connections = await this.prisma.connection.findMany({
			where: {
				id: { in: connectionIds },
				status: "ACTIVE",
			},
			include: { integration: true },
		});

		return connections.map((conn) => {
			const credentials = this.credentialsService.decrypt<
				Record<string, unknown>
			>(Buffer.from(conn.credentialsEnc));
			const config = conn.connectionConfigEnc
				? this.credentialsService.decrypt<Record<string, unknown>>(
						Buffer.from(conn.connectionConfigEnc),
					)
				: {};

			return {
				type:
					createAdapter(conn.integration.templateId)?.name ??
					conn.integration.templateId,
				connectionId: conn.id,
				credentials,
				config,
			};
		});
	}

	// =========================================================================
	// DELETION IMPACT PREVIEW
	// =========================================================================

	async getIntegrationDeletionImpact(integrationId: string) {
		const integration = await this.prisma.integration.findUnique({
			where: { id: integrationId },
			include: {
				connections: {
					include: {
						repositories: { select: { id: true, fullName: true } },
						serviceMappings: { include: { service: true } },
					},
				},
			},
		});

		if (!integration) return null;

		return this.buildDeletionImpact(integration.connections);
	}

	async getConnectionDeletionImpact(connectionId: string) {
		const connection = await this.prisma.connection.findFirst({
			where: { id: connectionId },
			include: {
				repositories: { select: { id: true, fullName: true } },
				serviceMappings: { include: { service: true } },
			},
		});

		if (!connection) return null;

		return this.buildDeletionImpact([connection]);
	}

	/** Repositories found through or pinned to the connections: after a delete they keep their URL and use Auto. */
	private async buildDeletionImpact(
		connections: Array<{
			id: string;
			integration?: { label: string } | null;
			repositories: Array<{ id: string; fullName: string }>;
			serviceMappings: Array<{
				service: { id: string; name: string };
			}>;
		}>,
	) {
		const repos = new Map<string, { id: string; fullName: string }>();
		type ImpactType = "integration_override_lost";
		const affectedMap = new Map<
			string,
			{ id: string; name: string; impact: ImpactType }
		>();

		for (const conn of connections) {
			for (const repo of [
				...conn.repositories,
				...(await pinnedRepositories(this.prisma, conn.id)),
			])
				repos.set(repo.id, { id: repo.id, fullName: repo.fullName });

			for (const sm of conn.serviceMappings) {
				if (!affectedMap.has(`${sm.service.id}:integration_override_lost`)) {
					affectedMap.set(`${sm.service.id}:integration_override_lost`, {
						id: sm.service.id,
						name: sm.service.name,
						impact: "integration_override_lost",
					});
				}
			}
		}

		return {
			connections: connections.map((c) => ({
				id: c.id,
				label: c.integration?.label ?? String(c.id).slice(0, 8),
			})),
			repositories: [...repos.values()],
			affectedServices: Array.from(affectedMap.values()),
		};
	}
}

type RepositoryClient = Pick<PrismaService, "repository">;

/** Repositories whose `metadata.credentialConnectionId` is this connection. */
async function pinnedRepositories(
	db: RepositoryClient,
	connectionId: string,
): Promise<Array<{ id: string; fullName: string; metadata: string | null }>> {
	const rows = await db.repository.findMany({
		where: { metadata: { contains: connectionId } },
		select: { id: true, fullName: true, metadata: true },
	});
	return rows.filter((r) => pickOf(r.metadata) === connectionId);
}

/** Before connections go: their discovered repositories become typed URL rows, and picks of them are cleared. */
async function releaseRepositories(
	tx: RepositoryClient,
	connectionIds: string[],
): Promise<void> {
	if (connectionIds.length === 0) return;
	await tx.repository.updateMany({
		where: { connectionId: { in: connectionIds } },
		data: { connectionId: null },
	});
	for (const id of connectionIds)
		for (const row of await pinnedRepositories(tx, id)) {
			const meta = JSON.parse(row.metadata as string) as Record<
				string,
				unknown
			>;
			delete meta.credentialConnectionId;
			await tx.repository.update({
				where: { id: row.id },
				data: { metadata: JSON.stringify(meta) },
			});
		}
}

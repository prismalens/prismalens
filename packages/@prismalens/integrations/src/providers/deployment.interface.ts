/**
 * Deployment Provider Interface
 *
 * Abstraction layer for deployment platforms (Render, Vercel, etc.).
 * Uses the same AuthenticatedRequestFn pattern as git providers.
 */
import type { DeploymentService } from "@prismalens/config/integrations";
import type { AuthenticatedRequestFn } from "./types.js";

/**
 * Deployment Provider interface
 *
 * Each provider (Render, Vercel, etc.) implements this interface
 * to provide a unified API for interacting with deployment platforms.
 */
export interface DeploymentProvider {
	readonly name: string;

	/** List all services/deployments from the platform */
	listServices(request: AuthenticatedRequestFn): Promise<DeploymentService[]>;

	/** Get a single service by its platform-specific ID */
	getService(
		request: AuthenticatedRequestFn,
		serviceId: string,
	): Promise<DeploymentService>;

	/** Test the connection */
	testConnection(request: AuthenticatedRequestFn): Promise<boolean>;
}

export type DeploymentProviderFactory = (
	providerName: string,
) => DeploymentProvider | null;

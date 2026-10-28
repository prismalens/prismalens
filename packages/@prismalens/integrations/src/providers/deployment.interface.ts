// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

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
 * Each deployment provider segment implements this interface
 * to provide a unified API for interacting with deployment platforms.
 */
export interface DeploymentProvider {
	readonly name: string;

	/** List all services/deployments from the platform */
	listServices?(request: AuthenticatedRequestFn): Promise<DeploymentService[]>;

	/** Get a single service by its platform-specific ID */
	getService?(
		request: AuthenticatedRequestFn,
		serviceId: string,
	): Promise<DeploymentService>;

	/** Test the connection */
	testConnection?(request: AuthenticatedRequestFn): Promise<boolean>;

	/** Whether this provider pulls the deploys of repositories on `host`; with `requestFor` and `listDeploymentEvents`, all a connector registers to be pulled (#855). */
	servesHost?(host: string): boolean;

	/** A request fn to this provider's API for `host`, sending `authorization` as the Authorization header. */
	requestFor?(host: string, authorization: string): AuthenticatedRequestFn;

	/** Read-only: the deploys of one repository in a window (#855). */
	listDeploymentEvents?(
		request: AuthenticatedRequestFn,
		repository: string,
		window: DeploymentWindow,
	): Promise<DeploymentEvent[]>;
}

/** One deploy as a platform reports it, in the shape the push endpoint records (#854). */
export interface DeploymentEvent {
	version: string;
	environment: string;
	status: "succeeded" | "failed" | "started";
	/** The commit deployed. */
	sha: string;
	actor: string | null;
	url: string | null;
	at: string;
}

/** The span a read must cover, normally an incident's what-changed window. */
export interface DeploymentWindow {
	since: Date;
	until: Date;
}

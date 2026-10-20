// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * GitHub Deployments, read-only (#854): each deployment with its latest status,
 * mapped to the shape `prismalens deploy` pushes.
 */
import { providerHttpError } from "../../engine/provider-http-error.js";
import type {
	DeploymentEvent,
	DeploymentEventSource,
} from "../deployment.interface.js";
import type { AuthenticatedRequestFn } from "../types.js";

interface GitHubDeployment {
	id: number;
	sha: string;
	ref: string;
	environment: string;
	created_at: string;
	creator: { login: string } | null;
}

interface GitHubDeploymentStatus {
	state: string;
	target_url?: string | null;
	log_url?: string | null;
	created_at: string;
}

const STATUS: Record<string, DeploymentEvent["status"] | undefined> = {
	success: "succeeded",
	failure: "failed",
	error: "failed",
	queued: "started",
	pending: "started",
	in_progress: "started",
};
const SHA = /^[0-9a-f]{40}$/i;
const VERSIONISH = /^v?\d/;

async function get<T>(
	request: AuthenticatedRequestFn,
	path: string,
): Promise<T> {
	const response = await request("GET", path);
	if (!response.ok)
		throw providerHttpError({
			operation: "GitHub Deployments request",
			provider: "github",
			response,
		});
	return response.json() as Promise<T>;
}

export class GitHubDeploymentsSegment implements DeploymentEventSource {
	async listDeploymentEvents(
		request: AuthenticatedRequestFn,
		repository: string,
		limit = 30,
	): Promise<DeploymentEvent[]> {
		const base = `/repos/${repository}/deployments`;
		const deployments = await get<GitHubDeployment[]>(
			request,
			`${base}?per_page=${limit}`,
		);
		const events: DeploymentEvent[] = [];
		for (const d of deployments) {
			const [latest] = await get<GitHubDeploymentStatus[]>(
				request,
				`${base}/${d.id}/statuses?per_page=1`,
			);
			const status = latest ? STATUS[latest.state] : undefined;
			if (!latest || !status) continue;
			events.push({
				version: VERSIONISH.test(d.ref) && !SHA.test(d.ref) ? d.ref : d.sha,
				environment: d.environment,
				status,
				sha: d.sha,
				actor: d.creator?.login ?? null,
				url: latest.target_url || latest.log_url || null,
				at: latest.created_at ?? d.created_at,
			});
		}
		return events;
	}
}

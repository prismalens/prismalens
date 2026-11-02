// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * GitHub Deployments, read-only (#854): each deployment with its latest status,
 * mapped to the shape `POST /webhooks/deploy` takes.
 */
import { providerHttpError } from "../../engine/provider-http-error.js";
import type {
	DeploymentEvent,
	DeploymentProvider,
	DeploymentWindow,
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

/** Deleted since it was listed; any other failure (auth, rate limit, 5xx) still throws. */
const GONE = new Set([404, 410]);

async function get<T>(
	request: AuthenticatedRequestFn,
	path: string,
): Promise<T>;
async function get<T>(
	request: AuthenticatedRequestFn,
	path: string,
	goneIsNull: true,
): Promise<T | null>;
async function get<T>(
	request: AuthenticatedRequestFn,
	path: string,
	goneIsNull = false,
): Promise<T | null> {
	const response = await request("GET", path);
	if (goneIsNull && GONE.has(response.status)) return null;
	if (!response.ok)
		throw providerHttpError({
			operation: "GitHub Deployments request",
			provider: "github",
			response,
		});
	return response.json() as Promise<T>;
}

const PER_PAGE = 100;
const MAX_PAGES = 10;
// A deploy created shortly before the window can still finish inside it.
const LEAD_MS = 60 * 60 * 1000;

export class GitHubDeploymentsSegment implements DeploymentProvider {
	readonly name = "github";

	servesHost(host: string): boolean {
		return host === "github.com";
	}

	requestFor(_host: string, authorization: string): AuthenticatedRequestFn {
		return (method, path, options) =>
			fetch(`https://api.github.com${path}`, {
				method,
				headers: {
					Accept: "application/vnd.github+json",
					"X-GitHub-Api-Version": "2022-11-28",
					...options?.headers,
					Authorization: authorization,
				},
				body: options?.body,
				signal: options?.signal ?? AbortSignal.timeout(30_000),
			});
	}

	async listDeploymentEvents(
		request: AuthenticatedRequestFn,
		repository: string,
		window: DeploymentWindow,
	): Promise<DeploymentEvent[]> {
		const base = `/repos/${repository}/deployments`;
		const from = window.since.getTime() - LEAD_MS;
		const to = window.until.getTime();
		const deployments: GitHubDeployment[] = [];
		// GitHub lists deployments newest first; page back until the window's start is passed.
		for (let page = 1; page <= MAX_PAGES; page++) {
			const batch = await get<GitHubDeployment[]>(
				request,
				`${base}?per_page=${PER_PAGE}&page=${page}`,
			);
			for (const d of batch) {
				const at = Date.parse(d.created_at);
				if (at >= from && at <= to) deployments.push(d);
			}
			const oldest = batch.at(-1);
			if (batch.length < PER_PAGE || !oldest) break;
			if (Date.parse(oldest.created_at) < from) break;
		}
		const events: DeploymentEvent[] = [];
		for (const d of deployments) {
			// GitHub marks a superseded deploy's newest status `inactive`; its earlier success is the one that shipped.
			const statuses = await get<GitHubDeploymentStatus[]>(
				request,
				`${base}/${d.id}/statuses?per_page=10`,
				true,
			);
			if (!statuses) continue;
			const latest = statuses.find((s) => s.state !== "inactive");
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

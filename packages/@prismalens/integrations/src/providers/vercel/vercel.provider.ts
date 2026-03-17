/**
 * Vercel Provider Implementation
 *
 * Implements the DeploymentProvider interface for Vercel.
 * Uses Vercel REST API: https://vercel.com/docs/rest-api
 */
import type { DeploymentService } from "@prismalens/config/integrations";
import type { DeploymentProvider } from "../deployment.interface.js";
import type { AuthenticatedRequestFn } from "../types.js";

// Vercel API response types
interface VercelProject {
	id: string;
	name: string;
	framework: string | null;
	link?: {
		type: string; // "github" | "gitlab" | "bitbucket"
		repo: string; // "org/repo"
	} | null;
	latestDeployments?: Array<{
		id: string;
		url: string;
		readyState: string; // "READY" | "ERROR" | "BUILDING" | "CANCELED" | "QUEUED"
		target: string | null; // "production" | "preview" | null
		createdAt: number;
		meta?: {
			githubCommitRef?: string;
			gitlabCommitRef?: string;
			bitbucketCommitRef?: string;
		};
	}>;
	updatedAt: number;
	createdAt: number;
}

interface VercelProjectsResponse {
	projects: VercelProject[];
	pagination: {
		count: number;
		next: number | null;
	};
}

async function json<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Vercel API error: ${response.status} - ${errorText}`);
	}
	return response.json() as Promise<T>;
}

/**
 * Map Vercel deployment state to a normalized status.
 */
function mapVercelStatus(project: VercelProject): string {
	const latest = project.latestDeployments?.[0];
	if (!latest) return "unknown";

	switch (latest.readyState) {
		case "READY":
			return "live";
		case "ERROR":
			return "error";
		case "BUILDING":
			return "building";
		case "CANCELED":
			return "canceled";
		case "QUEUED":
			return "queued";
		default:
			return latest.readyState.toLowerCase();
	}
}

function mapProject(project: VercelProject): DeploymentService {
	const latest = project.latestDeployments?.[0];
	const branch =
		latest?.meta?.githubCommitRef ??
		latest?.meta?.gitlabCommitRef ??
		latest?.meta?.bitbucketCommitRef;

	return {
		id: project.id,
		name: project.name,
		type: project.framework ?? "static_site",
		status: mapVercelStatus(project),
		url: latest?.url ? `https://${latest.url}` : undefined,
		repo: project.link?.repo
			? `https://${project.link.type === "github" ? "github.com" : project.link.type === "gitlab" ? "gitlab.com" : "bitbucket.org"}/${project.link.repo}`
			: undefined,
		branch,
		project: project.name,
		environment: latest?.target ?? undefined,
		createdAt: new Date(project.createdAt).toISOString(),
		updatedAt: new Date(project.updatedAt).toISOString(),
	};
}

export class VercelProvider implements DeploymentProvider {
	readonly name = "vercel";

	/**
	 * List all projects from Vercel.
	 * Uses offset-based pagination — iterates until no more pages.
	 */
	async listServices(
		request: AuthenticatedRequestFn,
	): Promise<DeploymentService[]> {
		const results: DeploymentService[] = [];
		let offset = 0;

		while (true) {
			const path =
				offset > 0
					? `/v9/projects?limit=100&offset=${offset}`
					: "/v9/projects?limit=100";

			const response = await request("GET", path);
			const data = await json<VercelProjectsResponse>(response);

			if (data.projects.length === 0) break;

			for (const project of data.projects) {
				results.push(mapProject(project));
			}

			if (data.pagination.next === null) break;
			offset = data.pagination.next;
		}

		return results;
	}

	/**
	 * Get a single project by Vercel project ID.
	 */
	async getService(
		request: AuthenticatedRequestFn,
		serviceId: string,
	): Promise<DeploymentService> {
		const response = await request(
			"GET",
			`/v9/projects/${encodeURIComponent(serviceId)}`,
		);
		const project = await json<VercelProject>(response);
		return mapProject(project);
	}

	/**
	 * Test the connection by calling the user endpoint.
	 */
	async testConnection(request: AuthenticatedRequestFn): Promise<boolean> {
		try {
			const response = await request("GET", "/v2/user");
			return response.ok;
		} catch {
			return false;
		}
	}
}

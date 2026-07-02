/**
 * Render Provider Implementation
 *
 * Implements the DeploymentProvider interface for Render.
 * Uses Render API v1: https://docs.render.com/api
 */
import type { DeploymentService } from "@prismalens/config/integrations";
import type { DeploymentProvider } from "../deployment.interface.js";
import type { AuthenticatedRequestFn } from "../types.js";

// Render API response types
interface RenderServiceItem {
	service: {
		id: string;
		name: string;
		type: string; // web_service, private_service, background_worker, cron_job, static_site
		slug: string;
		suspended: string; // "suspended" | "not_suspended"
		serviceDetails?: {
			url?: string;
			region?: string;
			buildCommand?: string;
			startCommand?: string;
		};
		repo?: string;
		branch?: string;
		createdAt?: string;
		updatedAt?: string;
	};
	cursor: string;
}

interface RenderProjectEnvironment {
	id: string;
	name: string;
	projectId: string;
	serviceIds?: string[];
}

interface RenderProject {
	id: string;
	name: string;
	environments?: RenderProjectEnvironment[];
}

interface RenderProjectItem {
	project: RenderProject;
	cursor: string;
}

interface ProjectContext {
	project: string;
	environment?: string;
}

async function json<T>(response: Response): Promise<T> {
	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(`Render API error: ${response.status} - ${errorText}`);
	}
	return response.json() as Promise<T>;
}

/**
 * Map Render service types to a normalized status.
 */
function mapRenderStatus(service: RenderServiceItem["service"]): string {
	if (service.suspended === "suspended") return "suspended";
	return "live";
}

function mapService(
	item: RenderServiceItem,
	context?: ProjectContext,
): DeploymentService {
	const svc = item.service;
	return {
		id: svc.id,
		name: svc.name,
		type: svc.type,
		status: mapRenderStatus(svc),
		url: svc.serviceDetails?.url,
		repo: svc.repo,
		branch: svc.branch,
		region: svc.serviceDetails?.region,
		project: context?.project,
		environment: context?.environment,
		createdAt: svc.createdAt,
		updatedAt: svc.updatedAt,
	};
}

export class RenderProvider implements DeploymentProvider {
	readonly name = "render";

	/**
	 * List all services from Render.
	 * Enriches with project/environment context when available.
	 * Uses cursor-based pagination — iterates until response is empty.
	 */
	async listServices(
		request: AuthenticatedRequestFn,
	): Promise<DeploymentService[]> {
		// Best-effort: fetch project context for enrichment
		const projectMap = await this.fetchProjectMap(request);

		const results: DeploymentService[] = [];
		let cursor: string | undefined;

		while (true) {
			const path = cursor
				? `/v1/services?limit=100&cursor=${encodeURIComponent(cursor)}`
				: "/v1/services?limit=100";

			const response = await request("GET", path);
			const items = await json<RenderServiceItem[]>(response);

			if (items.length === 0) break;

			for (const item of items) {
				const context = projectMap.get(item.service.id);
				results.push(mapService(item, context));
			}

			cursor = items[items.length - 1]?.cursor;
			if (!cursor) break;
		}

		return results;
	}

	/**
	 * Get a single service by Render service ID.
	 */
	async getService(
		request: AuthenticatedRequestFn,
		serviceId: string,
	): Promise<DeploymentService> {
		const response = await request(
			"GET",
			`/v1/services/${encodeURIComponent(serviceId)}`,
		);
		const item = await json<RenderServiceItem["service"]>(response);
		return mapService({ service: item, cursor: "" });
	}

	/**
	 * Test the connection by calling the owners endpoint.
	 */
	async testConnection(request: AuthenticatedRequestFn): Promise<boolean> {
		try {
			const response = await request("GET", "/v1/owners");
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Fetch project/environment context for all services.
	 * Returns a map of serviceId -> { project, environment }.
	 * Gracefully returns empty map on failure.
	 */
	private async fetchProjectMap(
		request: AuthenticatedRequestFn,
	): Promise<Map<string, ProjectContext>> {
		const map = new Map<string, ProjectContext>();

		try {
			let cursor: string | undefined;

			while (true) {
				const path = cursor
					? `/v1/projects?limit=100&cursor=${encodeURIComponent(cursor)}`
					: "/v1/projects?limit=100";

				const response = await request("GET", path);
				const items = await json<RenderProjectItem[]>(response);

				if (items.length === 0) break;

				for (const item of items) {
					const proj = item.project;
					if (!proj.environments) continue;

					for (const env of proj.environments) {
						if (!env.serviceIds) continue;
						for (const serviceId of env.serviceIds) {
							map.set(serviceId, {
								project: proj.name,
								environment: env.name,
							});
						}
					}
				}

				cursor = items[items.length - 1]?.cursor;
				if (!cursor) break;
			}
		} catch (error) {
			// Projects API may not be available or user may have no projects.
			// Graceful fallback — services will be listed without project context.
			console.warn(
				"[RenderProvider] fetchProjectMap failed (non-blocking):",
				error,
			);
		}

		return map;
	}
}

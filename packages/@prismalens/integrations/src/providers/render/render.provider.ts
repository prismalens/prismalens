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
function mapRenderStatus(
	service: RenderServiceItem["service"],
): string {
	if (service.suspended === "suspended") return "suspended";
	return "live";
}

function mapService(item: RenderServiceItem): DeploymentService {
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
		createdAt: svc.createdAt,
		updatedAt: svc.updatedAt,
	};
}

export class RenderProvider implements DeploymentProvider {
	readonly name = "render";

	/**
	 * List all services from Render.
	 * Uses cursor-based pagination — iterates until response is empty.
	 */
	async listServices(
		request: AuthenticatedRequestFn,
	): Promise<DeploymentService[]> {
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
				results.push(mapService(item));
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
}

import type {
	AlertContext,
	AlertFetchRequest,
	AlertFetchResponse,
	ChangeEventContext,
	DataProvider,
	IncidentContext,
	SimilarIncidentMatch,
	SimilarIncidentRequest,
	SimilarIncidentResponse,
} from "@prismalens/agents";
import type {
	AlertsService,
	AlertWithRelations,
} from "../../modules/alerts/alerts.service.js";
import type {
	IncidentsService,
	IncidentWithRelations,
} from "../../modules/incidents/incidents.service.js";
import {
	safeParseJsonArray,
	safeParseJsonObject,
	safeParseJsonRecord,
} from "./json-utils.js";

/**
 * DataProvider implementation for direct mode.
 * Uses NestJS services directly to fetch data from the database.
 */
export class DirectDataProvider implements DataProvider {
	constructor(
		private readonly alertsService: AlertsService,
		private readonly incidentsService: IncidentsService,
	) {}

	/**
	 * Fetch alerts based on criteria
	 */
	async fetchAlerts(request: AlertFetchRequest): Promise<AlertFetchResponse> {
		const alerts = await this.alertsService.findAll({
			incidentId: request.incidentId,
			serviceId: request.serviceId,
			limit: request.limit ?? 100,
		});

		return {
			alerts: alerts.map((alert) => this.mapAlertToContext(alert)),
			hasMore: alerts.length >= (request.limit ?? 100),
		};
	}

	/**
	 * Fetch a single incident with full details
	 */
	async fetchIncident(incidentId: string): Promise<IncidentContext | null> {
		const incident = await this.incidentsService.findById(incidentId);
		return incident ? this.mapIncidentToContext(incident) : null;
	}

	/**
	 * Fetch change events near the incident time window.
	 * Stub: returns empty until ChangeEventsService is available.
	 */
	async fetchChangeEvents(
		_incidentId: string,
		_timeRange?: { start: string; end: string },
	): Promise<ChangeEventContext[]> {
		return [];
	}

	/**
	 * Fetch similar past incidents for pattern matching
	 */
	async fetchSimilarIncidents(
		request: SimilarIncidentRequest,
	): Promise<SimilarIncidentResponse> {
		// Fetch resolved/closed incidents from the same service
		const incidents = await this.incidentsService.findAll({
			serviceId: request.serviceId,
			limit: request.limit ?? 10,
		});

		// Filter to only resolved/closed and exclude current incident
		const similar = incidents
			.filter(
				(i) =>
					i.id !== request.incidentId &&
					["resolved", "closed"].includes(i.status),
			)
			.map((incident) => this.mapToSimilarIncident(incident));

		return { incidents: similar };
	}

	/**
	 * Map database Alert to AlertContext
	 */
	private mapAlertToContext(alert: AlertWithRelations): AlertContext {
		const labels = safeParseJsonRecord(alert.labels);
		const tags = safeParseJsonArray(alert.tags);
		const rawPayload = safeParseJsonObject(alert.rawPayload);

		return {
			alertId: alert.id,
			title: alert.title,
			description: alert.description ?? undefined,
			severity: alert.severity as AlertContext["severity"],
			status: alert.status as AlertContext["status"],
			source: alert.source ?? undefined,
			sourceUrl: alert.sourceUrl ?? undefined,
			serviceId: alert.serviceId ?? undefined,
			serviceName: alert.service?.name ?? undefined,
			labels,
			tags,
			triggeredAt: alert.triggeredAt?.toISOString(),
			rawPayload,
		};
	}

	/**
	 * Map database Incident to IncidentContext
	 */
	private mapIncidentToContext(
		incident: IncidentWithRelations,
	): IncidentContext {
		const tags = safeParseJsonArray(incident.tags);

		return {
			incidentId: incident.id,
			number: incident.number,
			title: incident.title,
			description: incident.description ?? undefined,
			severity: incident.severity as IncidentContext["severity"],
			status: incident.status as IncidentContext["status"],
			priority: incident.priority as IncidentContext["priority"],
			serviceId: incident.serviceId ?? undefined,
			serviceName: incident.service?.name ?? undefined,
			correlationReason: incident.correlationReason ?? undefined,
			alertCount: incident.alertCount ?? incident._count?.alerts ?? 0,
			triggeredAt: incident.triggeredAt.toISOString(),
			acknowledgedAt: incident.acknowledgedAt?.toISOString(),
			resolvedAt: incident.resolvedAt?.toISOString(),
			tags,
			customerImpact: incident.customerImpact ?? undefined,
		};
	}

	/**
	 * Map database Incident to SimilarIncidentMatch.
	 * Includes description, tags, and severity for similarity scoring.
	 */
	private mapToSimilarIncident(
		incident: IncidentWithRelations,
	): SimilarIncidentMatch {
		const tags = safeParseJsonArray(incident.tags);

		return {
			incidentId: incident.id,
			number: incident.number,
			title: incident.title,
			description: incident.description ?? undefined,
			severity: incident.severity ?? undefined,
			tags: tags && tags.length > 0 ? tags : undefined,
			serviceId: incident.serviceId ?? undefined,
			serviceName: incident.service?.name ?? undefined,
			similarity: 0, // Computed by pre-gathering's calculateIncidentSimilarity
			resolution: incident.status === "resolved" ? "Resolved" : undefined,
			rootCause: undefined,
			timeToResolve: incident.timeToResolve ?? undefined,
			resolvedAt: incident.resolvedAt?.toISOString(),
		};
	}
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { Severity } from "../../shared/enums/index.js";
import { AlertMappingService } from "../alert-mapping/alert-mapping.service.js";
import type { Alert } from "../alerts/alerts.service.js";
import { AlertsService } from "../alerts/alerts.service.js";
import { CorrelationService } from "../correlation/correlation.service.js";
import type { Event } from "../events/events.service.js";
import { EventsService } from "../events/events.service.js";
import {
	GenericWebhookDto,
	GithubWebhookDto,
	RenderWebhookDto,
} from "./dto/index.js";

export interface WebhookResult {
	event: Event;
	alert: Alert;
	incidentId?: string;
	incidentNumber?: number;
	correlationReason?: string;
	isNewIncident: boolean;
	mappedServiceId?: string;
}

@Injectable()
export class WebhooksService {
	private readonly logger = new Logger(WebhooksService.name);

	constructor(
		@Inject(forwardRef(() => AlertsService))
		private readonly alertsService: AlertsService,
		private readonly eventsService: EventsService,
		@Inject(forwardRef(() => CorrelationService))
		private readonly correlationService: CorrelationService,
		private readonly alertMappingService: AlertMappingService,
	) {}

	async processGenericWebhook(dto: GenericWebhookDto): Promise<WebhookResult> {
		// 1. Create immutable event record
		const event = await this.eventsService.create({
			source: dto.source ?? "webhook",
			sourceEventId: dto.sourceEventId,
			eventType: "alert",
			payload: dto.rawPayload ?? {
				title: dto.title,
				description: dto.description,
			},
			eventTime: dto.eventTime,
		});

		this.logger.log(`Created event ${event.id} from generic webhook`);

		// 3. Resolve service using alert mapping rules
		const mappedService = await this.alertMappingService.resolveServiceForAlert(
			{
				source: dto.source ?? "generic",
				labels: dto.labels,
				tags: dto.tags,
				title: dto.title,
				description: dto.description,
			},
		);

		// 4. Create alert with resolved serviceId
		const alert = await this.alertsService.create({
			title: dto.title,
			description: dto.description,
			severity: dto.severity ?? Severity.medium,
			source: dto.source ?? "webhook",
			sourceUrl: dto.sourceUrl,
			sourceAlertId: dto.sourceEventId,
			tags: dto.tags,
			labels: dto.labels,
			serviceId: mappedService?.id,
			rawPayload: dto.rawPayload,
		});

		// 5. Link event to alert
		await this.eventsService.markProcessed(event.id, alert.id);

		// 6. Correlate alert to incident
		const correlationResult =
			await this.correlationService.correlateAlert(alert);

		return {
			event,
			alert,
			incidentId: correlationResult.incidentId,
			incidentNumber: correlationResult.incidentNumber,
			correlationReason: correlationResult.reason,
			isNewIncident: correlationResult.isNewIncident,
			mappedServiceId: mappedService?.id,
		};
	}

	async processGithubWebhook(dto: GithubWebhookDto): Promise<WebhookResult> {
		// 1. Create immutable event record
		const event = await this.eventsService.create({
			source: "github",
			sourceEventId: this.extractGithubEventId(dto),
			eventType: this.determineGithubEventType(dto),
			payload: dto as unknown as Record<string, unknown>,
		});

		this.logger.log(`Created event ${event.id} from GitHub webhook`);

		// 2. Extract alert info from GitHub event
		const alertInfo = this.extractGithubAlertInfo(dto);

		// 3. Create alert
		const alert = await this.alertsService.create({
			title: alertInfo.title,
			description: alertInfo.description,
			severity: alertInfo.severity,
			source: "github",
			sourceUrl: alertInfo.sourceUrl,
			sourceAlertId: alertInfo.externalId,
			rawPayload: dto as unknown as Record<string, unknown>,
		});

		// 4. Link event to alert
		await this.eventsService.markProcessed(event.id, alert.id);

		// 5. Correlate alert to incident
		const correlationResult =
			await this.correlationService.correlateAlert(alert);

		return {
			event,
			alert,
			incidentId: correlationResult.incidentId,
			incidentNumber: correlationResult.incidentNumber,
			correlationReason: correlationResult.reason,
			isNewIncident: correlationResult.isNewIncident,
		};
	}

	async processRenderWebhook(dto: RenderWebhookDto): Promise<WebhookResult> {
		// 1. Create immutable event record
		const event = await this.eventsService.create({
			source: "render",
			sourceEventId: dto.deploy?.id ?? dto.service?.id,
			eventType: "deployment",
			payload: dto as unknown as Record<string, unknown>,
		});

		this.logger.log(`Created event ${event.id} from Render webhook`);

		// 2. Extract alert info from Render event
		const alertInfo = this.extractRenderAlertInfo(dto);

		// 3. Create alert
		const alert = await this.alertsService.create({
			title: alertInfo.title,
			description: alertInfo.description,
			severity: alertInfo.severity,
			source: "render",
			sourceAlertId: alertInfo.externalId,
			rawPayload: dto as unknown as Record<string, unknown>,
		});

		// 4. Link event to alert
		await this.eventsService.markProcessed(event.id, alert.id);

		// 5. Correlate alert to incident
		const correlationResult =
			await this.correlationService.correlateAlert(alert);

		return {
			event,
			alert,
			incidentId: correlationResult.incidentId,
			incidentNumber: correlationResult.incidentNumber,
			correlationReason: correlationResult.reason,
			isNewIncident: correlationResult.isNewIncident,
		};
	}

	private extractGithubEventId(dto: GithubWebhookDto): string | undefined {
		if (dto.alert) return `github-alert-${dto.alert.number}`;
		if (dto.issue)
			return `github-issue-${dto.repository?.full_name}-${dto.issue.number}`;
		if (dto.pull_request)
			return `github-pr-${dto.repository?.full_name}-${dto.pull_request.number}`;
		return undefined;
	}

	private determineGithubEventType(dto: GithubWebhookDto): string {
		if (dto.alert) return "security_alert";
		if (dto.issue) return "issue";
		if (dto.pull_request) return "pull_request";
		return "unknown";
	}

	private extractGithubAlertInfo(dto: GithubWebhookDto): {
		title: string;
		description?: string;
		severity: Severity;
		sourceUrl?: string;
		externalId?: string;
	} {
		if (dto.alert) {
			return {
				title: `GitHub Security Alert: ${dto.alert.summary ?? "Unknown"}`,
				description: `Security alert in ${dto.repository?.full_name ?? "unknown repo"}`,
				severity: this.mapGithubSeverity(dto.alert.severity),
				sourceUrl: dto.alert.html_url,
				externalId: `github-alert-${dto.alert.number}`,
			};
		}

		if (dto.issue) {
			return {
				title: `GitHub Issue: ${dto.issue.title}`,
				description: dto.issue.body,
				severity: this.inferSeverityFromLabels(dto.issue.labels),
				sourceUrl: dto.issue.html_url,
				externalId: `github-issue-${dto.repository?.full_name}-${dto.issue.number}`,
			};
		}

		if (dto.pull_request) {
			return {
				title: `GitHub PR: ${dto.pull_request.title}`,
				description: dto.pull_request.body,
				severity: Severity.info,
				sourceUrl: dto.pull_request.html_url,
				externalId: `github-pr-${dto.repository?.full_name}-${dto.pull_request.number}`,
			};
		}

		return {
			title: `GitHub Event: ${dto.action ?? "unknown"}`,
			description: `Event from ${dto.repository?.full_name ?? "unknown repo"}`,
			severity: Severity.info,
		};
	}

	private extractRenderAlertInfo(dto: RenderWebhookDto): {
		title: string;
		description: string;
		severity: Severity;
		externalId: string;
	} {
		const serviceName = dto.service?.name ?? "unknown";
		const deployStatus = dto.deploy?.status ?? dto.type ?? "unknown";

		let title: string;
		let severity: Severity = Severity.info;

		if (deployStatus === "deploy_failed" || deployStatus === "failed") {
			title = `Render Deploy Failed: ${serviceName}`;
			severity = Severity.high;
		} else if (deployStatus === "deactivated") {
			title = `Render Service Deactivated: ${serviceName}`;
			severity = Severity.high;
		} else if (deployStatus === "suspended") {
			title = `Render Service Suspended: ${serviceName}`;
			severity = Severity.critical;
		} else {
			title = `Render Event: ${serviceName} - ${deployStatus}`;
			severity = Severity.low;
		}

		return {
			title,
			description: `Service: ${serviceName}, Status: ${deployStatus}`,
			severity,
			externalId: dto.deploy?.id
				? `render-deploy-${dto.deploy.id}`
				: `render-${dto.service?.id ?? "unknown"}`,
		};
	}

	private mapGithubSeverity(severity: string | undefined): Severity {
		switch (severity?.toLowerCase()) {
			case "critical":
				return Severity.critical;
			case "high":
				return Severity.high;
			case "medium":
			case "moderate":
				return Severity.medium;
			case "low":
				return Severity.low;
			default:
				return Severity.medium;
		}
	}

	private inferSeverityFromLabels(labels?: Array<{ name: string }>): Severity {
		if (!labels) return Severity.medium;

		const labelNames = labels.map((l) => l.name.toLowerCase());

		if (
			labelNames.some((l) => l.includes("critical") || l.includes("urgent"))
		) {
			return Severity.critical;
		}
		if (labelNames.some((l) => l.includes("high") || l.includes("important"))) {
			return Severity.high;
		}
		if (labelNames.some((l) => l.includes("low") || l.includes("minor"))) {
			return Severity.low;
		}
		return Severity.medium;
	}
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { Prisma } from "@prismalens/database";
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

/**
 * How long an event that carries an idempotency key but no alert is assumed to
 * belong to a delivery that is still being processed.
 *
 * `Event.idempotencyKey` is unique, so a second delivery of the same key cannot
 * insert its own event — it has to decide what the existing, unlinked event
 * means. Within the grace window it is treated as a concurrent in-flight
 * delivery and rejected with CONFLICT so the sender retries and picks up the
 * cached result. Past the window the original attempt is assumed to have died
 * between event creation and `markProcessed`, and processing resumes on that
 * same event rather than blocking the delivery forever.
 */
const IN_FLIGHT_GRACE_MS = 30_000;

/** What a lookup by idempotency key says the caller should do next. */
type IdempotentDelivery =
	/** Already fully processed — return the cached result verbatim. */
	| { kind: "replay"; result: WebhookResult }
	/** A previous attempt died mid-flight — continue with its event record. */
	| { kind: "resume"; event: Event }
	/** Never seen — ingest normally. */
	| { kind: "fresh" };

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

	/**
	 * Resolve what a delivery carrying `idempotencyKey` should do: replay a
	 * cached result, resume an abandoned event, or ingest fresh.
	 *
	 * @throws ORPCError CONFLICT when a concurrent delivery of the same key is
	 * still in flight.
	 */
	private async resolveIdempotentDelivery(
		idempotencyKey: string,
	): Promise<IdempotentDelivery> {
		const existingEvent =
			await this.eventsService.findByIdempotencyKey(idempotencyKey);
		if (!existingEvent) {
			return { kind: "fresh" };
		}

		if (existingEvent.alertId) {
			const alert = await this.alertsService.findById(existingEvent.alertId);
			if (alert) {
				return {
					kind: "replay",
					result: {
						event: existingEvent,
						alert,
						incidentId: alert.incidentId ?? undefined,
						incidentNumber: alert.incident?.number,
						correlationReason:
							"Idempotent replay of a previously processed webhook delivery",
						isNewIncident: false,
					},
				};
			}
		}

		const ageMs = Date.now() - existingEvent.receivedAt.getTime();
		if (ageMs < IN_FLIGHT_GRACE_MS) {
			throw new ORPCError("CONFLICT", {
				message:
					"A webhook delivery with this idempotency key is still being processed. Retry the delivery.",
			});
		}

		this.logger.warn(
			`Resuming abandoned event ${existingEvent.id} for idempotency key ${idempotencyKey} (age ${ageMs}ms)`,
		);
		return { kind: "resume", event: existingEvent };
	}

	/**
	 * Obtain the event record to process this delivery against, honouring the
	 * idempotency key both on the read path and on a lost insert race (P2002 on
	 * the unique `idempotencyKey`).
	 */
	private async ingestEvent(
		idempotencyKey: string | undefined,
		createEvent: () => Promise<Event>,
	): Promise<{ replay: WebhookResult } | { event: Event }> {
		if (idempotencyKey) {
			const delivery = await this.resolveIdempotentDelivery(idempotencyKey);
			if (delivery.kind === "replay") return { replay: delivery.result };
			if (delivery.kind === "resume") return { event: delivery.event };
		}

		try {
			return { event: await createEvent() };
		} catch (error) {
			const lostRace =
				idempotencyKey !== undefined &&
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002";
			if (!lostRace) throw error;

			// A concurrent delivery of the same key won the insert; defer to it.
			const delivery = await this.resolveIdempotentDelivery(idempotencyKey);
			if (delivery.kind === "replay") return { replay: delivery.result };
			if (delivery.kind === "resume") return { event: delivery.event };
			throw error;
		}
	}

	async processGenericWebhook(
		dto: GenericWebhookDto,
		idempotencyKey?: string,
	): Promise<WebhookResult> {
		// 1. Create immutable event record
		const ingested = await this.ingestEvent(idempotencyKey, () =>
			this.eventsService.create({
				source: dto.source ?? "webhook",
				sourceEventId: dto.sourceEventId,
				idempotencyKey,
				eventType: "alert",
				payload: dto.rawPayload ?? {
					title: dto.title,
					description: dto.description,
				},
				eventTime: dto.eventTime,
			}),
		);
		if ("replay" in ingested) return ingested.replay;
		const event = ingested.event;

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

	async processRenderWebhook(
		dto: RenderWebhookDto,
		idempotencyKey?: string,
	): Promise<WebhookResult> {
		// 1. Create immutable event record
		const ingested = await this.ingestEvent(idempotencyKey, () =>
			this.eventsService.create({
				source: "render",
				sourceEventId: dto.deploy?.id ?? dto.service?.id,
				idempotencyKey,
				eventType: "deployment",
				payload: dto as unknown as Record<string, unknown>,
			}),
		);
		if ("replay" in ingested) return ingested.replay;
		const event = ingested.event;

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

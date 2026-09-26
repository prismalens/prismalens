// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { ORPCError } from "@orpc/nest";
import { httpUrlOrNull, type PrometheusAlert } from "@prismalens/contracts";
import { Prisma } from "@prismalens/database";
import { Severity } from "../../shared/enums/index.js";
import { AlertMappingService } from "../alert-mapping/alert-mapping.service.js";
import type { Alert } from "../alerts/alerts.service.js";
import { AlertsService } from "../alerts/alerts.service.js";
import { IncidentCorrelationService } from "../alerts/incident-correlation.service.js";
import type { Event } from "../events/events.service.js";
import { EventsService } from "../events/events.service.js";
import type { StatusNote } from "../incidents/incidents.service.js";
import { GenericWebhookDto, RenderWebhookDto } from "./dto/index.js";

export interface WebhookResult {
	event: Event;
	alert: Alert;
	incidentId?: string;
	incidentNumber?: number;
	correlationReason?: string;
	isNewIncident: boolean;
	mappedServiceId?: string;
}

export interface ProcessPrometheusAlertResult {
	alertId: string | null;
	isNew: boolean;
}

export function mapPrometheusLabelToSeverity(
	severityLabel?: string,
): Severity | undefined {
	switch (severityLabel?.toLowerCase()) {
		case "critical":
			return Severity.critical;
		case "high":
		case "warning":
			return Severity.high;
		case "medium":
			return Severity.medium;
		case "low":
			return Severity.low;
		case "info":
			return Severity.info;
		default:
			return undefined;
	}
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

/**
 * Caps on the sender-supplied text that reaches the investigation prompt
 * (#633 edge 13): `title`, `description` and label *values*, and nothing else.
 * The description carries Alertmanager annotations verbatim, so one noisy rule
 * must not store megabytes of them.
 *
 * Two fields are deliberately **not** capped, which an earlier version of this
 * comment implied they were (#664 review):
 *
 * - `rawPayload` is the provider's original delivery, kept so a request can be
 *   replayed and debugged. Truncating it would produce invalid JSON, which is
 *   worse than storing it whole — a payload you cannot parse is not a record.
 * - `tags` is matched against alert-mapping rules to resolve a service.
 *   Truncating a tag could stop a rule matching and silently misroute an
 *   alert, which costs more than the bytes it saves.
 *
 * Neither is unbounded: the global 1 MB JSON body limit is what bounds the
 * worst case for both, and for the whole delivery.
 */
export const MAX_TITLE_CHARS = 500;
export const MAX_DESCRIPTION_CHARS = 8_000;
export const MAX_LABEL_VALUE_CHARS = 1_000;

export function capText(
	text: string | undefined,
	max: number,
): string | undefined {
	if (text === undefined || text.length <= max) return text;
	return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

function capLabels(
	labels: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!labels) return labels;
	return Object.fromEntries(
		Object.entries(labels).map(([k, v]) => [
			k,
			capText(v, MAX_LABEL_VALUE_CHARS) ?? v,
		]),
	);
}

/**
 * How long a `resolved` delivery for an alert we never saw fire is remembered
 * (#633 edge 10). Alertmanager can deliver the resolution before a retried
 * firing; without this the late firing opens an incident nothing ever resolves.
 */
export const EARLY_RESOLUTION_TTL_MS = 15 * 60_000;

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
	/** `fingerprint|startsAt` of resolutions that arrived before their firing, with expiry. */
	private readonly earlyResolutions = new Map<string, number>();

	constructor(
		@Inject(forwardRef(() => AlertsService))
		private readonly alertsService: AlertsService,
		private readonly eventsService: EventsService,
		@Inject(forwardRef(() => IncidentCorrelationService))
		private readonly incidentCorrelation: IncidentCorrelationService,
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

	/**
	 * Alertmanager sends a `resolved` delivery for an alert that has just
	 * stopped firing. Routing it through `processGenericWebhook` would hand a
	 * resolution to the dedup layer as if it were a firing, and #231's flap
	 * window would reopen the very alert being resolved (#593).
	 *
	 * An unknown fingerprint resolves nothing: we never saw it fire, so there is
	 * no episode to close.
	 */
	async resolvePrometheusAlert(
		fingerprint: string | undefined,
		idempotencyKey?: string,
		startsAt?: string,
		/** Set when no resolved delivery exists and prismalens inferred it (#605). */
		inferred?: { source: string; note: StatusNote },
	): Promise<Alert | null> {
		if (!fingerprint) {
			this.logger.warn(
				"Prometheus resolved delivery carried no fingerprint; nothing to resolve",
			);
			return null;
		}

		// The lookup comes before ingestEvent on purpose. An Event row that never
		// reaches markProcessed keeps a null alertId, and resolveIdempotentDelivery
		// reads that as in-flight and throws CONFLICT on a retry inside the grace
		// window — so ingesting for a fingerprint we cannot act on would break the
		// idempotency it was added to provide.
		// Membership-aware: `Alert.externalId` only holds the id of the source
		// alert that created the row, so keying the guard on it would miss every
		// other member of a deduped group and never reach resolveSourceAlert,
		// leaving the group stuck triggered (#595).
		const existing =
			await this.alertsService.findAlertBySourceAlert(fingerprint);
		if (!existing) {
			if (startsAt) this.rememberEarlyResolution(fingerprint, startsAt);
			this.logger.log(
				`Prometheus resolved delivery for unknown fingerprint ${fingerprint}; remembered in case its firing arrives late`,
			);
			return null;
		}

		// From here a resolution will happen, so the delivery gets the same
		// immutable Event row and idempotency handling as every other path (#593).
		const ingested = await this.ingestEvent(idempotencyKey, () =>
			this.eventsService.create({
				source: inferred?.source ?? "prometheus",
				sourceEventId: fingerprint,
				idempotencyKey,
				eventType: "alert",
				payload: {
					status: "resolved",
					fingerprint,
					...(inferred && { reason: inferred.note.reason }),
				},
			}),
		);
		if ("replay" in ingested) return ingested.replay.alert;
		const event = ingested.event;

		const resolved = await this.alertsService.resolveSourceAlert(fingerprint);

		if (resolved) {
			await this.eventsService.markProcessed(event.id, resolved.id);
			// A resolved delivery resolves the alert and, when no firing alert
			// remains on it, the incident too (#608, C5 on #337).
			if (resolved.incidentId) {
				await this.incidentCorrelation.resolveIncidentIfNoFiringAlerts(
					resolved.incidentId,
					inferred?.note,
				);
			}
		}
		return resolved;
	}

	private rememberEarlyResolution(fingerprint: string, startsAt: string): void {
		const now = Date.now();
		for (const [key, expires] of this.earlyResolutions) {
			if (expires <= now) this.earlyResolutions.delete(key);
		}
		this.earlyResolutions.set(
			`${fingerprint}|${startsAt}`,
			now + EARLY_RESOLUTION_TTL_MS,
		);
	}

	/**
	 * True while a firing's own episode (same fingerprint and `startsAt`) has
	 * already been resolved. A new episode has a later `startsAt` and is
	 * untouched. This only READS: the record is dropped by
	 * {@link clearEarlyResolution} once the resolution actually happened, so a
	 * failed or retried delivery can still be resolved (#664 review).
	 */
	hasEarlyResolution(fingerprint: string, startsAt: string): boolean {
		const key = `${fingerprint}|${startsAt}`;
		const expires = this.earlyResolutions.get(key);
		if (expires === undefined) return false;
		if (expires <= Date.now()) {
			this.earlyResolutions.delete(key);
			return false;
		}
		return true;
	}

	/** Forget an early resolution that has been applied. */
	clearEarlyResolution(fingerprint: string, startsAt: string): void {
		this.earlyResolutions.delete(`${fingerprint}|${startsAt}`);
	}

	/**
	 * Process a single Prometheus alert, either from a webhook delivery,
	 * an Alertmanager pull, or a Prometheus catch-up query (#605).
	 */
	async processPrometheusAlert(
		alert: PrometheusAlert,
		opts: {
			idempotencyKey?: string;
			source: "prometheus" | "alertmanager-pull" | "prometheus-catchup";
			autoInvestigate: boolean;
		},
	): Promise<ProcessPrometheusAlertResult> {
		// A `resolved` delivery closes an episode; it must never reach
		// the dedup layer, which would read it as a refire and reopen
		// the alert inside the flap window (#593).
		if (alert.status === "resolved") {
			const resolved = await this.resolvePrometheusAlert(
				alert.fingerprint,
				opts.idempotencyKey,
				alert.startsAt,
			);
			return { alertId: resolved?.id ?? null, isNew: false };
		}

		const genericDto: GenericWebhookDto = {
			title: alert.labels?.alertname ?? "Prometheus Alert",
			description: alert.annotations?.description ?? alert.annotations?.summary,
			severity: mapPrometheusLabelToSeverity(alert.labels?.severity),
			source: opts.source,
			// Alertmanager's link back to the firing expression (#592).
			sourceUrl: httpUrlOrNull(alert.generatorURL) ?? undefined,
			labels: alert.labels,
			sourceEventId: alert.fingerprint,
		};
		// Decided BEFORE the alert is created, because it decides
		// whether creating it may dispatch a run (#664 review).
		// `hasEarlyResolution` only reads, so asking early is safe.
		const resolutionAlreadyArrived = Boolean(
			alert.fingerprint &&
				this.hasEarlyResolution(alert.fingerprint, alert.startsAt),
		);
		const autoInvestigate = opts.autoInvestigate && !resolutionAlreadyArrived;
		const result = await this.processGenericWebhook(
			genericDto,
			opts.idempotencyKey,
			// The alert and its incident are still recorded — the
			// resolve path below looks the alert up by fingerprint —
			// but an episode that is already over starts no run.
			{ autoInvestigate },
		);

		// Its resolution already came, out of order (#633 edge 10).
		// The record is cleared only once the alert is really
		// resolved, so a failure here leaves it for the retry.
		if (alert.fingerprint && resolutionAlreadyArrived) {
			const resolved = await this.resolvePrometheusAlert(
				alert.fingerprint,
				opts.idempotencyKey === undefined
					? undefined
					: `${opts.idempotencyKey}:resolved`,
			);
			if (resolved) {
				this.clearEarlyResolution(alert.fingerprint, alert.startsAt);
			}
		}

		const isReplay =
			result.correlationReason ===
			"Idempotent replay of a previously processed webhook delivery";
		const isNew = !isReplay && result.alert.occurrenceCount === 1;

		return {
			alertId: result.alert.id,
			isNew,
		};
	}

	async processGenericWebhook(
		dto: GenericWebhookDto,
		idempotencyKey?: string,
		options: { autoInvestigate?: boolean } = {},
	): Promise<WebhookResult> {
		dto = {
			...dto,
			title: capText(dto.title, MAX_TITLE_CHARS) ?? dto.title,
			description: capText(dto.description, MAX_DESCRIPTION_CHARS),
			labels: capLabels(dto.labels),
		};
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
			sourceUrl: httpUrlOrNull(dto.sourceUrl) ?? undefined,
			sourceAlertId: dto.sourceEventId,
			tags: dto.tags,
			labels: dto.labels,
			serviceId: mappedService?.id,
			rawPayload: dto.rawPayload,
		});

		// 5. Link event to alert
		await this.eventsService.markProcessed(event.id, alert.id);

		// 6. Correlate alert to incident. `autoInvestigate` is forwarded, not
		// interpreted: it only decides whether the auto-trigger hears about this.
		const correlationResult = await this.incidentCorrelation.correlateAlert(
			alert,
			options,
		);

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
			await this.incidentCorrelation.correlateAlert(alert);

		return {
			event,
			alert,
			incidentId: correlationResult.incidentId,
			incidentNumber: correlationResult.incidentNumber,
			correlationReason: correlationResult.reason,
			isNewIncident: correlationResult.isNewIncident,
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
}

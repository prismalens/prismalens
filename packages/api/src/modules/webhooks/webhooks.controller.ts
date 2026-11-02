// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	Controller,
	forwardRef,
	Inject,
	Logger,
	UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Implement, implement } from "@orpc/nest";
import type { PrometheusAlert } from "@prismalens/contracts";
import { webhooksContract } from "@prismalens/contracts";
import { Public } from "../../core/auth/public.decorator.js";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { TelemetryService } from "../../core/telemetry/telemetry.service.js";
import { WEBHOOK_LAST_DELIVERY_KEY } from "../../shared/constants/routes.js";
import { AlertPullService } from "../alerts/alert-pull.service.js";
import {
	ALERT_MAPPERS,
	type AlertSource,
	confirmSnsSubscription,
	type Payload,
} from "./alert-sources/index.js";
import type { GenericWebhookDto, RenderWebhookDto } from "./dto/index.js";
import { RenderWebhookSignatureGuard } from "./render-webhook-signature.guard.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhookThrottleGuard } from "./webhook-throttle.guard.js";
import { WebhookResult, WebhooksService } from "./webhooks.service.js";

@Public()
@Controller()
@UseGuards(WebhookThrottleGuard, WebhookSignatureGuard)
@Throttle({
	short: { ttl: 1000, limit: 20 },
	medium: { ttl: 60000, limit: 600 },
})
export class WebhooksController {
	private readonly logger = new Logger(WebhooksController.name);

	constructor(
		private readonly webhooksService: WebhooksService,
		private readonly telemetry: TelemetryService,
		@Inject(forwardRef(() => AlertPullService))
		private readonly alertPull: AlertPullService,
		private readonly prisma: PrismaService,
	) {}

	@Implement({
		generic: webhooksContract.generic,
		prometheus: webhooksContract.prometheus,
		grafana: webhooksContract.grafana,
		datadog: webhooksContract.datadog,
		sentry: webhooksContract.sentry,
		pagerduty: webhooksContract.pagerduty,
		cloudwatch: webhooksContract.cloudwatch,
		azureMonitor: webhooksContract.azureMonitor,
		newrelic: webhooksContract.newrelic,
	})
	webhooks() {
		return {
			// POST /webhooks/generic - Receive generic webhook
			generic: implement(webhooksContract.generic).handler(
				async ({ input, context }) => {
					this.logger.log("Received generic webhook");
					await this.telemetry.captureFirstWebhook("generic");
					const idempotencyKey = this.idempotencyKeyFrom(context);

					const result = await this.webhooksService.processGenericWebhook(
						input as unknown as GenericWebhookDto,
						idempotencyKey,
					);

					return this.formatResponse(result);
				},
			),

			// POST /webhooks/{grafana,datadog,sentry,pagerduty,cloudwatch,azure-monitor,newrelic} (#79)
			grafana: this.alertSourceHandler("grafana", webhooksContract.grafana),
			datadog: this.alertSourceHandler("datadog", webhooksContract.datadog),
			sentry: this.alertSourceHandler("sentry", webhooksContract.sentry),
			pagerduty: this.alertSourceHandler(
				"pagerduty",
				webhooksContract.pagerduty,
			),
			cloudwatch: this.alertSourceHandler(
				"cloudwatch",
				webhooksContract.cloudwatch,
			),
			azureMonitor: this.alertSourceHandler(
				"azure-monitor",
				webhooksContract.azureMonitor,
			),
			newrelic: this.alertSourceHandler("newrelic", webhooksContract.newrelic),

			// POST /webhooks/prometheus - Receive Prometheus AlertManager webhook
			prometheus: implement(webhooksContract.prometheus).handler(
				async ({ input, context }) => {
					this.logger.log(
						`Received Prometheus webhook with ${input.alerts?.length ?? 0} alerts`,
					);
					// Once per install, ever — never the alert, never per alert, and
					// never a timestamp that would leak this install's alert cadence.
					await this.telemetry.captureFirstWebhook("prometheus");
					const idempotencyKey = this.idempotencyKeyFrom(context);

					// Process each Prometheus alert through the Prometheus alert handler.
					// The delivery-level X-Idempotency-Key covers the whole batch, so
					// each alert gets its own derived key — reusing the batch key would
					// make alerts 2..n replay alert 1 and report duplicate alertIds.
					const alertIds: string[] = [];
					const alerts = input.alerts ?? [];
					for (const [index, alert] of alerts.entries()) {
						try {
							const derivedKey =
								idempotencyKey === undefined
									? undefined
									: `${idempotencyKey}:${alert.fingerprint ?? index}`;
							const result = await this.webhooksService.processPrometheusAlert(
								alert as PrometheusAlert,
								{
									idempotencyKey: derivedKey,
									source: "prometheus",
									autoInvestigate: true,
								},
							);
							if (result.alertId) alertIds.push(result.alertId);
						} catch (error) {
							this.logger.error(`Failed to process Prometheus alert: ${error}`);
						}
					}

					// Stamp what Alertmanager lists while the machine is awake, so an
					// alert it stops listing overnight can resolve by absence (#605).
					void this.alertPull.onWebhook();
					await this.rememberDelivery(alerts.length, alertIds.length);

					return {
						received: alerts.length,
						processed: alertIds.length,
						alertIds,
					};
				},
			),
		};
	}

	@UseGuards(RenderWebhookSignatureGuard)
	@Implement(webhooksContract.render)
	render() {
		return implement(webhooksContract.render).handler(
			async ({ input, context }) => {
				this.logger.log("Received Render webhook");
				await this.telemetry.captureFirstWebhook("render");
				const idempotencyKey = this.idempotencyKeyFrom(context);

				const result = await this.webhooksService.processRenderWebhook(
					input as unknown as RenderWebhookDto,
					idempotencyKey,
				);

				return this.formatResponse(result);
			},
		);
	}

	/**
	 * One handler per vendor: map the body, hand the alerts to the service. An SNS
	 * subscription handshake is answered here and carries no alert.
	 */
	private alertSourceHandler<C extends typeof webhooksContract.grafana>(
		source: AlertSource,
		contract: C,
	) {
		return implement(contract).handler(async ({ input, context }) => {
			const payload = input as Payload;
			await this.telemetry.captureFirstWebhook("generic");

			if (
				source === "cloudwatch" &&
				payload.Type === "SubscriptionConfirmation"
			) {
				const subscribeUrl = payload.SubscribeURL;
				const confirmed =
					typeof subscribeUrl === "string" &&
					(await confirmSnsSubscription(subscribeUrl).catch((error) => {
						this.logger.warn(`SNS subscription confirmation failed: ${error}`);
						return false;
					}));
				return {
					received: 0,
					processed: 0,
					alertIds: [],
					incidentIds: [],
					confirmed,
				};
			}

			const mapped = ALERT_MAPPERS[source](payload);
			const { alertIds, incidentIds } =
				await this.webhooksService.processMappedAlerts(
					source,
					mapped,
					this.idempotencyKeyFrom(context),
				);
			await this.rememberDelivery(mapped.length, alertIds.length);
			return {
				received: mapped.length,
				processed: alertIds.length,
				alertIds,
				incidentIds: [...new Set(incidentIds)],
			};
		});
	}

	/** Settings, Alert sources reads this back as "Last delivery" (study-v3 §7). Advisory. */
	private async rememberDelivery(received: number, accepted: number) {
		const value = JSON.stringify({
			at: new Date().toISOString(),
			received,
			accepted,
		});
		await this.prisma.setting
			.upsert({
				where: { key: WEBHOOK_LAST_DELIVERY_KEY },
				update: { value, type: "json" },
				create: {
					key: WEBHOOK_LAST_DELIVERY_KEY,
					value,
					type: "json",
					category: "general",
				},
			})
			.catch((err) =>
				this.logger.warn(`Could not record the last delivery: ${err}`),
			);
	}

	/**
	 * Read the delivery's X-Idempotency-Key.
	 *
	 * A blank or whitespace-only header is not a key — normalising it to
	 * `undefined` here keeps every downstream branch (replay lookup, derived
	 * batch keys, P2002 handling) from treating `""` as a real key.
	 */
	private idempotencyKeyFrom(context?: {
		request?: { headers?: Record<string, unknown> };
	}): string | undefined {
		const raw = context?.request?.headers?.["x-idempotency-key"];
		if (typeof raw !== "string") return undefined;
		const key = raw.trim();
		return key.length > 0 ? key : undefined;
	}

	private formatResponse(result: WebhookResult) {
		return {
			success: true,
			eventId: result.event.id,
			alertId: result.alert.id,
			incidentId: result.incidentId,
			incidentNumber: result.incidentNumber,
			isNewIncident: result.isNewIncident,
			correlationReason: result.correlationReason,
		};
	}
}

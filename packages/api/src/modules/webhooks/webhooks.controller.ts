// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Controller, Logger, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Implement, implement } from "@orpc/nest";
import { webhooksContract } from "@prismalens/contracts";
import { Public } from "../../core/auth/public.decorator.js";
import { Severity } from "../../shared/enums/index.js";
import type { GenericWebhookDto, RenderWebhookDto } from "./dto/index.js";
import { RenderWebhookSignatureGuard } from "./render-webhook-signature.guard.js";
import { WebhookSignatureGuard } from "./webhook-signature.guard.js";
import { WebhookResult, WebhooksService } from "./webhooks.service.js";

@Public()
@Controller()
@UseGuards(WebhookSignatureGuard, ThrottlerGuard)
@Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
export class WebhooksController {
	private readonly logger = new Logger(WebhooksController.name);

	constructor(private readonly webhooksService: WebhooksService) {}

	@Implement({
		generic: webhooksContract.generic,
		prometheus: webhooksContract.prometheus,
	})
	webhooks() {
		return {
			// POST /webhooks/generic - Receive generic webhook
			generic: implement(webhooksContract.generic).handler(
				async ({ input, context }) => {
					this.logger.log("Received generic webhook");
					const idempotencyKey = this.idempotencyKeyFrom(context);

					const result = await this.webhooksService.processGenericWebhook(
						input as unknown as GenericWebhookDto,
						idempotencyKey,
					);

					return this.formatResponse(result);
				},
			),

			// POST /webhooks/prometheus - Receive Prometheus AlertManager webhook
			prometheus: implement(webhooksContract.prometheus).handler(
				async ({ input, context }) => {
					this.logger.log(
						`Received Prometheus webhook with ${input.alerts?.length ?? 0} alerts`,
					);
					const idempotencyKey = this.idempotencyKeyFrom(context);

					// Process each Prometheus alert through the generic webhook handler.
					// The delivery-level X-Idempotency-Key covers the whole batch, so
					// each alert gets its own derived key — reusing the batch key would
					// make alerts 2..n replay alert 1 and report duplicate alertIds.
					const alertIds: string[] = [];
					const alerts = input.alerts ?? [];
					for (const [index, alert] of alerts.entries()) {
						try {
							const genericDto: GenericWebhookDto = {
								title: alert.labels?.alertname ?? "Prometheus Alert",
								description:
									alert.annotations?.description ?? alert.annotations?.summary,
								severity: this.mapPrometheusLabelToSeverity(
									alert.labels?.severity,
								),
								source: "prometheus",
								labels: alert.labels,
								sourceEventId: alert.fingerprint,
							};
							const result = await this.webhooksService.processGenericWebhook(
								genericDto,
								idempotencyKey === undefined
									? undefined
									: `${idempotencyKey}:${alert.fingerprint ?? index}`,
							);
							alertIds.push(result.alert.id);
						} catch (error) {
							this.logger.error(`Failed to process Prometheus alert: ${error}`);
						}
					}

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

	private mapPrometheusLabelToSeverity(
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

import { Controller, Logger } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { webhooksContract } from "@prismalens/contracts";
import { Severity } from "../../shared/enums/index.js";
import type { GenericWebhookDto } from "./dto/index.js";
import { WebhookResult, WebhooksService } from "./webhooks.service.js";

@Controller()
export class WebhooksController {
	private readonly logger = new Logger(WebhooksController.name);

	constructor(private readonly webhooksService: WebhooksService) {}

	@Implement(webhooksContract)
	webhooks() {
		return {
			// POST /webhooks/generic - Receive generic webhook
			generic: implement(webhooksContract.generic).handler(
				async ({ input }) => {
					this.logger.log("Received generic webhook");

					const result = await this.webhooksService.processGenericWebhook(
						input as unknown as GenericWebhookDto,
					);

					return this.formatResponse(result);
				},
			),

			// POST /webhooks/prometheus - Receive Prometheus AlertManager webhook
			prometheus: implement(webhooksContract.prometheus).handler(
				async ({ input }) => {
					this.logger.log(
						`Received Prometheus webhook with ${input.alerts?.length ?? 0} alerts`,
					);

					// Process each Prometheus alert through the generic webhook handler
					const alertIds: string[] = [];
					for (const alert of input.alerts ?? []) {
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
							const result =
								await this.webhooksService.processGenericWebhook(genericDto);
							alertIds.push(result.alert.id);
						} catch (error) {
							this.logger.error(`Failed to process Prometheus alert: ${error}`);
						}
					}

					return {
						received: input.alerts?.length ?? 0,
						processed: alertIds.length,
						alertIds,
					};
				},
			),
		};
	}

	private mapPrometheusLabelToSeverity(
		severityLabel?: string,
	): Severity | undefined {
		switch (severityLabel?.toLowerCase()) {
			case "critical":
				return Severity.CRITICAL;
			case "high":
			case "warning":
				return Severity.HIGH;
			case "medium":
				return Severity.MEDIUM;
			case "low":
				return Severity.LOW;
			case "info":
				return Severity.INFO;
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

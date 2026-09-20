// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import type { PrometheusAlert } from "@prismalens/contracts";
import { urlOnlyRequestFn } from "@prismalens/integrations";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { WebhooksService } from "../webhooks/webhooks.service.js";

export interface PullResult {
	sources: number;
	received: number;
	processed: number;
	caughtUp: number;
	errors: string[];
}

export interface GettableAlert {
	labels: Record<string, string>;
	annotations?: Record<string, string>;
	startsAt: string;
	endsAt?: string;
	generatorURL?: string;
	fingerprint?: string;
	status?: {
		state: "active" | "suppressed" | "unprocessed";
	};
}

@Injectable()
export class AlertPullService {
	private readonly logger = new Logger(AlertPullService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(forwardRef(() => IntegrationsService))
		private readonly integrationsService: IntegrationsService,
		@Inject(forwardRef(() => WebhooksService))
		private readonly webhooksService: WebhooksService,
	) {}

	async pull(): Promise<PullResult> {
		const result: PullResult = {
			sources: 0,
			received: 0,
			processed: 0,
			caughtUp: 0,
			errors: [],
		};

		let connections: Array<
			Awaited<
				ReturnType<
					typeof this.prisma.connection.findMany<{
						include: { integration: true };
					}>
				>
			>[number]
		> = [];
		try {
			connections = await this.prisma.connection.findMany({
				where: {
					status: "ACTIVE",
					integration: {
						templateId: "alertmanager",
					},
				},
				include: {
					integration: true,
				},
			});
		} catch (err) {
			result.errors.push(
				`Failed to query Alertmanager connections: ${err instanceof Error ? err.message : String(err)}`,
			);
			return result;
		}

		result.sources = connections.length;

		for (const conn of connections) {
			const label = conn.label || conn.id;
			try {
				const baseUrl = await this.integrationsService.connectionBaseUrl(
					conn.id,
				);
				if (!baseUrl) {
					result.errors.push(`${label}: Connection has no baseUrl`);
					continue;
				}

				const requestFn = urlOnlyRequestFn(baseUrl);
				let response: Response;
				try {
					response = await requestFn(
						"GET",
						"/api/v2/alerts?active=true&silenced=false&inhibited=false",
					);
				} catch (networkErr) {
					result.errors.push(
						`${label}: Network error: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`,
					);
					continue;
				}

				if (!response.ok) {
					result.errors.push(
						`${label}: HTTP ${response.status} ${response.statusText}`,
					);
					continue;
				}

				let rawAlerts: unknown;
				try {
					rawAlerts = await response.json();
				} catch (jsonErr) {
					result.errors.push(
						`${label}: Invalid JSON response: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`,
					);
					continue;
				}

				if (!Array.isArray(rawAlerts)) {
					result.errors.push(
						`${label}: Invalid response: expected an array of alerts`,
					);
					continue;
				}

				const alertList = rawAlerts as GettableAlert[];
				result.received += alertList.length;

				for (const alertItem of alertList) {
					if (alertItem.status?.state !== "active") {
						continue;
					}

					const fingerprint = alertItem.fingerprint ?? "";
					const startsAt = alertItem.startsAt;
					const prometheusAlert: PrometheusAlert = {
						status: "firing",
						labels: alertItem.labels ?? {},
						annotations: alertItem.annotations,
						startsAt,
						endsAt: alertItem.endsAt,
						generatorURL: alertItem.generatorURL,
						fingerprint: fingerprint || undefined,
					};

					try {
						const { isNew } = await this.webhooksService.processPrometheusAlert(
							prometheusAlert,
							{
								idempotencyKey: `alertmanager-pull:${fingerprint}:${startsAt}`,
								source: "alertmanager-pull",
								autoInvestigate: false,
							},
						);
						if (isNew) {
							result.processed++;
						}
					} catch (alertErr) {
						this.logger.error(
							`Failed to process pulled alert ${fingerprint}: ${alertErr}`,
						);
					}
				}
			} catch (err) {
				result.errors.push(
					`${label}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		return result;
	}
}

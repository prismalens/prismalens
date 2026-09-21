// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	forwardRef,
	Inject,
	Injectable,
	Logger,
	OnApplicationBootstrap,
} from "@nestjs/common";
import type { PrometheusAlert } from "@prismalens/contracts";
import {
	PrometheusMetricsSegment,
	type RangeSeries,
	urlOnlyRequestFn,
} from "@prismalens/integrations";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import { WebhooksService } from "../webhooks/webhooks.service.js";
import { alertmanagerFingerprint } from "./alertmanager-fingerprint.js";

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

export const ALERT_PULL_SETTING_KEY = "ALERT_PULL";
export const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AlertPullService implements OnApplicationBootstrap {
	private readonly logger = new Logger(AlertPullService.name);

	constructor(
		private readonly prisma: PrismaService,
		@Inject(forwardRef(() => IntegrationsService))
		private readonly integrationsService: IntegrationsService,
		@Inject(forwardRef(() => WebhooksService))
		private readonly webhooksService: WebhooksService,
	) {}

	/**
	 * Pull once on boot, fire-and-forget (#605). Never awaited and never blocks
	 * Nest's bootstrap: a slow or unreachable Alertmanager/Prometheus must not
	 * delay the app coming up. Skipped under CI and under the seeded e2e stack
	 * (`PRISMALENS_SEED_DEMO=1`) so tests never depend on network access.
	 */
	onApplicationBootstrap(): void {
		if (process.env.CI || process.env.PRISMALENS_SEED_DEMO === "1") {
			return;
		}
		void this.pull()
			.then((result) => {
				this.logger.log(
					`Boot pull: ${result.sources} source(s), ${result.received} received, ${result.processed} new, ${result.caughtUp} caught up, ${result.errors.length} error(s)`,
				);
			})
			.catch((err) => {
				this.logger.error(`Boot pull failed: ${err}`);
			});
	}

	/**
	 * Compute the catch-up window start time `since` based on the ALERT_PULL setting.
	 * Clamped to [now - 24h, now]. Absent or invalid -> now - 24h.
	 */
	async getCatchupSince(now: Date): Promise<Date> {
		const twentyFourHoursAgo = new Date(now.getTime() - TWENTY_FOUR_HOURS_MS);
		try {
			const row = await this.prisma.setting.findUnique({
				where: { key: ALERT_PULL_SETTING_KEY },
			});
			if (!row) return twentyFourHoursAgo;
			const parsed = JSON.parse(row.value) as { lastPulledAt?: string };
			if (typeof parsed.lastPulledAt !== "string") return twentyFourHoursAgo;
			const date = new Date(parsed.lastPulledAt);
			if (Number.isNaN(date.getTime())) return twentyFourHoursAgo;

			if (date.getTime() < twentyFourHoursAgo.getTime()) {
				return twentyFourHoursAgo;
			}
			if (date.getTime() > now.getTime()) {
				return now;
			}
			return date;
		} catch {
			return twentyFourHoursAgo;
		}
	}

	/**
	 * Update the ALERT_PULL setting with the latest pull timestamp.
	 */
	async updateLastPulledAt(now: Date): Promise<void> {
		await this.prisma.setting.upsert({
			where: { key: ALERT_PULL_SETTING_KEY },
			update: {
				value: JSON.stringify({ lastPulledAt: now.toISOString() }),
				type: "json",
			},
			create: {
				key: ALERT_PULL_SETTING_KEY,
				value: JSON.stringify({ lastPulledAt: now.toISOString() }),
				type: "json",
				category: "general",
			},
		});
	}

	/**
	 * Look up an existing open alert for this fingerprint created by a prior catch-up.
	 * Returns its startsAt and idempotencyKey if found.
	 */
	async findExistingOpenCatchupAlert(
		fingerprint: string,
	): Promise<{ startsAt: string; idempotencyKey: string } | null> {
		try {
			if (this.prisma.alert?.findFirst) {
				const alert = await this.prisma.alert.findFirst({
					where: {
						source: "prometheus-catchup",
						status: { not: "resolved" },
						OR: [
							{ externalId: fingerprint },
							{ members: { some: { sourceAlertId: fingerprint } } },
						],
					},
					orderBy: { triggeredAt: "desc" },
					include: {
						events: {
							where: {
								source: "prometheus-catchup",
								idempotencyKey: {
									startsWith: `prometheus-catchup:${fingerprint}:`,
								},
							},
							orderBy: { receivedAt: "desc" },
							take: 1,
						},
					},
				});

				if (alert?.events?.[0]?.idempotencyKey) {
					const key = alert.events[0].idempotencyKey;
					const prefix = `prometheus-catchup:${fingerprint}:`;
					if (key.startsWith(prefix)) {
						const startsAt = key.slice(prefix.length);
						return { startsAt, idempotencyKey: key };
					}
				}
			}

			if (this.prisma.event?.findFirst) {
				const event = await this.prisma.event.findFirst({
					where: {
						source: "prometheus-catchup",
						sourceEventId: fingerprint,
						idempotencyKey: {
							startsWith: `prometheus-catchup:${fingerprint}:`,
						},
						alert: {
							status: { not: "resolved" },
						},
					},
					orderBy: { receivedAt: "desc" },
				});

				if (event?.idempotencyKey) {
					const key = event.idempotencyKey;
					const prefix = `prometheus-catchup:${fingerprint}:`;
					if (key.startsWith(prefix)) {
						const startsAt = key.slice(prefix.length);
						return { startsAt, idempotencyKey: key };
					}
				}
			}

			return null;
		} catch {
			return null;
		}
	}

	async pull(now: Date = new Date()): Promise<PullResult> {
		const result: PullResult = {
			sources: 0,
			received: 0,
			processed: 0,
			caughtUp: 0,
			errors: [],
		};

		const since = await this.getCatchupSince(now);

		// 1. Query Alertmanager connections
		let alertmanagerConnections: Array<
			Awaited<
				ReturnType<
					typeof this.prisma.connection.findMany<{
						include: { integration: true };
					}>
				>
			>[number]
		> = [];
		try {
			alertmanagerConnections = await this.prisma.connection.findMany({
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
		}

		// 2. Query Prometheus connections
		let prometheusConnections: Array<
			Awaited<
				ReturnType<
					typeof this.prisma.connection.findMany<{
						include: { integration: true };
					}>
				>
			>[number]
		> = [];
		try {
			prometheusConnections = await this.prisma.connection.findMany({
				where: {
					status: "ACTIVE",
					integration: {
						templateId: "prometheus",
					},
				},
				include: {
					integration: true,
				},
			});
		} catch (err) {
			result.errors.push(
				`Failed to query Prometheus connections: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		result.sources =
			alertmanagerConnections.length + prometheusConnections.length;

		// 3. Pull from Alertmanager connections
		for (const conn of alertmanagerConnections) {
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
						result.errors.push(
							`${label}: alert ${fingerprint}: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`,
						);
					}
				}
			} catch (err) {
				result.errors.push(
					`${label}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		// 4. Catch up from Prometheus connections
		const metricsSegment = new PrometheusMetricsSegment();
		const stepSeconds = 60;
		for (const conn of prometheusConnections) {
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
				let seriesList: RangeSeries[] = [];
				try {
					seriesList = await metricsSegment.rangeQuery(requestFn, {
						expr: 'ALERTS{alertstate="firing"}',
						start: since,
						end: now,
						stepSeconds,
					});
				} catch (queryErr) {
					result.errors.push(
						`${label}: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`,
					);
					continue;
				}

				if (seriesList.length === 0) {
					continue;
				}

				// a) Query ALERTS_FOR_STATE over the same range
				let alertsForStateList: RangeSeries[] = [];
				try {
					alertsForStateList = await metricsSegment.rangeQuery(requestFn, {
						expr: "ALERTS_FOR_STATE",
						start: since,
						end: now,
						stepSeconds,
					});
				} catch (stateErr) {
					this.logger.debug(
						`ALERTS_FOR_STATE query failed for ${label}: ${stateErr}`,
					);
				}

				const alertsForStateByFp = new Map<string, RangeSeries>();
				for (const s of alertsForStateList) {
					const sLabels: Record<string, string> = {};
					for (const [k, v] of Object.entries(s.labels)) {
						if (k !== "__name__" && k !== "alertstate") {
							sLabels[k] = v;
						}
					}
					const fp = alertmanagerFingerprint(sLabels);
					alertsForStateByFp.set(fp, s);
				}

				for (const series of seriesList) {
					if (!series.values || series.values.length === 0) {
						continue;
					}

					// labels = series labels minus __name__ and alertstate
					const labels: Record<string, string> = {};
					for (const [k, v] of Object.entries(series.labels)) {
						if (k !== "__name__" && k !== "alertstate") {
							labels[k] = v;
						}
					}

					const firstSample = series.values[0];
					const lastSample = series.values[series.values.length - 1];
					const firstSampleSec = firstSample[0];
					const lastSampleSec = lastSample[0];
					const fingerprint = alertmanagerFingerprint(labels);

					const gapThresholdSec = 2 * stepSeconds;
					const episodes: Array<Array<[number, string]>> = [];
					let currentEpisode: Array<[number, string]> = [series.values[0]];

					for (let i = 1; i < series.values.length; i++) {
						const prevTime = series.values[i - 1][0];
						const currTime = series.values[i][0];
						if (currTime - prevTime > gapThresholdSec) {
							episodes.push(currentEpisode);
							currentEpisode = [series.values[i]];
						} else {
							currentEpisode.push(series.values[i]);
						}
					}
					episodes.push(currentEpisode);

					for (let epIdx = 0; epIdx < episodes.length; epIdx++) {
						const episode = episodes[epIdx];
						const isLastEpisode = epIdx === episodes.length - 1;

						const firstSample = episode[0];
						const lastSample = episode[episode.length - 1];
						const firstSampleSec = firstSample[0];
						const lastSampleSec = lastSample[0];

						let startsAt: string | undefined;
						let idempotencyKey: string | undefined;

						// a) Check ALERTS_FOR_STATE for this fingerprint
						const stateSeries = alertsForStateByFp.get(fingerprint);
						if (stateSeries?.values && stateSeries.values.length > 0) {
							const matchingSample = stateSeries.values.find(
								(s) => s[0] >= firstSampleSec && s[0] <= lastSampleSec,
							);
							if (matchingSample) {
								const activeAtSec = Number.parseFloat(matchingSample[1]);
								if (!Number.isNaN(activeAtSec) && activeAtSec > 0) {
									startsAt = new Date(activeAtSec * 1000).toISOString();
									idempotencyKey = `prometheus-catchup:${fingerprint}:${startsAt}`;
								}
							}
						}

						// b) Fallback when there is no ALERTS_FOR_STATE value:
						if (!startsAt) {
							const sinceSec = Math.floor(since.getTime() / 1000);
							const isClipped =
								Math.abs(firstSampleSec - sinceSec) <= stepSeconds;

							if (isClipped) {
								const existing =
									await this.findExistingOpenCatchupAlert(fingerprint);
								if (existing) {
									startsAt = existing.startsAt;
									idempotencyKey = existing.idempotencyKey;
								}
							}

							if (!startsAt) {
								startsAt = new Date(firstSampleSec * 1000).toISOString();
								idempotencyKey = `prometheus-catchup:${fingerprint}:${startsAt}`;
							}
						}

						const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
						const alertnameExpr = `ALERTS{alertname="${labels.alertname ?? ""}"}`;
						const generatorURL = `${cleanBaseUrl}/graph?g0.expr=${encodeURIComponent(alertnameExpr)}`;

						const prometheusAlert: PrometheusAlert = {
							status: "firing",
							labels,
							annotations: {},
							startsAt,
							generatorURL,
							fingerprint,
						};

						try {
							const { isNew } =
								await this.webhooksService.processPrometheusAlert(
									prometheusAlert,
									{
										idempotencyKey,
										source: "prometheus-catchup",
										autoInvestigate: false,
									},
								);
							if (isNew) {
								result.processed++;
							}
							result.caughtUp++;

							// Resolution handling:
							// All but the last episode are resolved;
							// The last is resolved if its last sample is older than now − 2 × step.
							const lastSampleTimeMs = lastSampleSec * 1000;
							const endedThresholdMs = now.getTime() - 2 * stepSeconds * 1000;
							const shouldResolve =
								!isLastEpisode || lastSampleTimeMs < endedThresholdMs;

							if (shouldResolve) {
								await this.webhooksService.resolvePrometheusAlert(
									fingerprint,
									`${idempotencyKey}:resolved`,
									startsAt,
								);
							}
						} catch (alertErr) {
							this.logger.error(
								`Failed to process catch-up alert ${fingerprint}: ${alertErr}`,
							);
							result.errors.push(
								`${label}: alert ${fingerprint}: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`,
							);
						}
					}
				}
			} catch (err) {
				result.errors.push(
					`${label}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}

		// 5. Update ALERT_PULL setting only after a pull with zero errors
		if (result.errors.length === 0) {
			try {
				await this.updateLastPulledAt(now);
			} catch (err) {
				this.logger.warn(
					`Failed to update ${ALERT_PULL_SETTING_KEY} setting: ${err}`,
				);
			}
		}

		return result;
	}
}

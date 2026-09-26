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
	/** Alerts resolved because no connected Alertmanager lists them any more. */
	resolvedByAbsence?: number;
	errors: string[];
}

/** One round of listing every connected Alertmanager. */
interface AlertmanagerLists {
	/** Every connection listed its alerts. */
	listed: boolean;
	/** Every connection has been up long enough to have its alerts back. */
	settled: boolean;
	byConnection: Array<{ label: string; alerts: GettableAlert[] }>;
	/** Fingerprints any connection lists, in any state. */
	present: Set<string>;
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
/**
 * Alertmanager keeps alerts in memory, so a restarted one lists nothing until
 * Prometheus resends (every evaluation, after a 1 min resend delay). Absence
 * from a younger Alertmanager proves nothing (#605).
 */
export const ALERTMANAGER_MIN_UPTIME_MS = 10 * 60 * 1000;
const STAMP_CHUNK = 500;

@Injectable()
export class AlertPullService implements OnApplicationBootstrap {
	private readonly logger = new Logger(AlertPullService.name);
	private webhookCheck: Promise<void> | null = null;
	private webhookCheckQueued = false;

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
		if (offline()) return;
		void this.pull()
			.then((result) => {
				this.logger.log(
					`Boot pull: ${result.sources} source(s), ${result.received} received, ${result.processed} new, ${result.caughtUp} caught up, ${result.resolvedByAbsence ?? 0} resolved by absence, ${result.errors.length} error(s)`,
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

	/** The startsAt and key a prior catch-up gave this fingerprint's still-open alert. */
	async findExistingOpenCatchupAlert(
		fingerprint: string,
	): Promise<{ startsAt: string; idempotencyKey: string } | null> {
		const prefix = `prometheus-catchup:${fingerprint}:`;
		const event = await this.prisma.event.findFirst({
			where: {
				source: "prometheus-catchup",
				sourceEventId: fingerprint,
				idempotencyKey: { startsWith: prefix },
				alert: { status: { not: "resolved" } },
			},
			orderBy: { receivedAt: "desc" },
		});
		const key = event?.idempotencyKey;
		if (!key?.startsWith(prefix)) return null;
		return { startsAt: key.slice(prefix.length), idempotencyKey: key };
	}

	async pull(now: Date = new Date()): Promise<PullResult> {
		const result: PullResult = {
			sources: 0,
			received: 0,
			processed: 0,
			caughtUp: 0,
			errors: [],
		};
		const catchupErrors: string[] = [];

		const since = await this.getCatchupSince(now);

		// 1. Query Alertmanager connections
		const alertmanagerConnections = await this.alertmanagerConnections(
			result.errors,
		);

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
			const errorMsg = `Failed to query Prometheus connections: ${err instanceof Error ? err.message : String(err)}`;
			result.errors.push(errorMsg);
			catchupErrors.push(errorMsg);
		}

		result.sources =
			alertmanagerConnections.length + prometheusConnections.length;

		// 3. Pull from Alertmanager connections
		const lists = await this.listAlertmanagers(alertmanagerConnections, now);
		result.errors.push(...lists.errors);
		for (const { label, alerts } of lists.byConnection) {
			result.received += alerts.length;
			for (const alertItem of alerts) {
				// Listed while silenced or inhibited still counts as present, but
				// only an active alert is worth an incident.
				if (alertItem.status?.state !== "active") continue;

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
		}
		// After ingest, so an alert this pull just created is stamped too.
		await this.stampListed(lists.present, now);

		// Fingerprints catch-up saw still firing; never resolved by absence.
		const stillFiring = new Set<string>();

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
					const errorMsg = `${label}: Connection has no baseUrl`;
					result.errors.push(errorMsg);
					catchupErrors.push(errorMsg);
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
					const errorMsg = `${label}: ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`;
					result.errors.push(errorMsg);
					catchupErrors.push(errorMsg);
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

							if (!shouldResolve) stillFiring.add(fingerprint);
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
							const errorMsg = `${label}: alert ${fingerprint}: ${alertErr instanceof Error ? alertErr.message : String(alertErr)}`;
							result.errors.push(errorMsg);
							catchupErrors.push(errorMsg);
						}
					}
				}
			} catch (err) {
				const errorMsg = `${label}: ${err instanceof Error ? err.message : String(err)}`;
				result.errors.push(errorMsg);
				catchupErrors.push(errorMsg);
			}
		}

		// 5. Resolve what every connected Alertmanager has stopped listing
		result.resolvedByAbsence = await this.resolveAbsent(
			lists,
			stillFiring,
			now,
		);

		// 6. Update ALERT_PULL setting only after catch-up completed without catch-up errors
		if (catchupErrors.length === 0) {
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

	/**
	 * After a webhook delivery, list every connected Alertmanager, stamp what it
	 * lists and resolve what it no longer lists. This is what lets an alert that
	 * fired by webhook resolve after a night with the lid closed. Never awaited by
	 * the webhook; one run at a time, at most one queued behind it.
	 */
	onWebhook(now: () => Date = () => new Date()): Promise<void> {
		if (offline()) return Promise.resolve();
		if (this.webhookCheck) {
			this.webhookCheckQueued = true;
			return this.webhookCheck;
		}
		const run = async (): Promise<void> => {
			do {
				this.webhookCheckQueued = false;
				try {
					const at = now();
					const errors: string[] = [];
					const connections = await this.alertmanagerConnections(errors);
					if (connections.length === 0) continue;
					const lists = await this.listAlertmanagers(connections, at);
					await this.stampListed(lists.present, at);
					await this.resolveAbsent(lists, new Set(), at);
				} catch (err) {
					this.logger.warn(`Alertmanager check after webhook failed: ${err}`);
				}
			} while (this.webhookCheckQueued);
		};
		this.webhookCheck = run().finally(() => {
			this.webhookCheck = null;
		});
		return this.webhookCheck;
	}

	private async alertmanagerConnections(errors: string[]) {
		try {
			return await this.prisma.connection.findMany({
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
			errors.push(
				`Failed to query Alertmanager connections: ${err instanceof Error ? err.message : String(err)}`,
			);
			return [];
		}
	}

	/** Every alert each connection holds, silenced and inhibited included, and its uptime. */
	private async listAlertmanagers(
		connections: Array<{ id: string; label: string | null }>,
		now: Date,
	): Promise<AlertmanagerLists> {
		const lists: AlertmanagerLists = {
			listed: connections.length > 0,
			settled: connections.length > 0,
			byConnection: [],
			present: new Set(),
			errors: [],
		};
		for (const conn of connections) {
			const label = conn.label || conn.id;
			const fail = (message: string) => {
				lists.errors.push(`${label}: ${message}`);
				lists.listed = false;
			};
			const baseUrl = await this.integrationsService
				.connectionBaseUrl(conn.id)
				.catch(() => null);
			if (!baseUrl) {
				fail("Connection has no baseUrl");
				continue;
			}
			const requestFn = urlOnlyRequestFn(baseUrl);

			let rawAlerts: unknown;
			try {
				const response = await requestFn("GET", "/api/v2/alerts");
				if (!response.ok) {
					fail(`HTTP ${response.status} ${response.statusText}`);
					continue;
				}
				rawAlerts = await response.json();
			} catch (err) {
				fail(
					`Network error: ${err instanceof Error ? err.message : String(err)}`,
				);
				continue;
			}
			if (!Array.isArray(rawAlerts)) {
				fail("Invalid response: expected an array of alerts");
				continue;
			}
			const alerts = rawAlerts as GettableAlert[];
			lists.byConnection.push({ label, alerts });
			for (const a of alerts)
				if (a.fingerprint) lists.present.add(a.fingerprint);

			if (!(await this.upLongEnough(requestFn, now))) lists.settled = false;
		}
		return lists;
	}

	private async upLongEnough(
		requestFn: ReturnType<typeof urlOnlyRequestFn>,
		now: Date,
	): Promise<boolean> {
		try {
			const response = await requestFn("GET", "/api/v2/status");
			if (!response.ok) return false;
			const { uptime } = (await response.json()) as { uptime?: unknown };
			const startedAt =
				typeof uptime === "string" ? new Date(uptime).getTime() : Number.NaN;
			return (
				Number.isFinite(startedAt) &&
				now.getTime() - startedAt >= ALERTMANAGER_MIN_UPTIME_MS
			);
		} catch {
			return false;
		}
	}

	private async stampListed(present: Set<string>, now: Date): Promise<void> {
		const fingerprints = [...present];
		for (let i = 0; i < fingerprints.length; i += STAMP_CHUNK) {
			await this.prisma.alertSourceAlert.updateMany({
				where: {
					sourceAlertId: { in: fingerprints.slice(i, i + STAMP_CHUNK) },
				},
				data: { lastPulledAt: now },
			});
		}
	}

	/**
	 * Resolve alerts a connected Alertmanager once listed and none lists now.
	 * Only when every connection listed and has been up long enough; an alert no
	 * connected Alertmanager ever listed (another Alertmanager, Grafana) is never
	 * a candidate.
	 */
	private async resolveAbsent(
		lists: AlertmanagerLists,
		stillFiring: Set<string>,
		now: Date,
	): Promise<number> {
		if (!lists.listed || !lists.settled) {
			if (lists.byConnection.length > 0) {
				this.logger.log(
					"Skipped resolving by absence: an Alertmanager did not answer or restarted less than 10 minutes ago",
				);
			}
			return 0;
		}
		const open = await this.prisma.alertSourceAlert.findMany({
			where: { resolvedAt: null, lastPulledAt: { not: null } },
			select: { sourceAlertId: true, alert: { select: { labels: true } } },
		});
		let resolved = 0;
		for (const member of open) {
			const fingerprint = member.sourceAlertId;
			if (lists.present.has(fingerprint) || stillFiring.has(fingerprint)) {
				continue;
			}
			const name = alertName(member.alert.labels) ?? "the alert";
			try {
				const alert = await this.webhooksService.resolvePrometheusAlert(
					fingerprint,
					`alertmanager-absent:${fingerprint}:${now.toISOString()}`,
					undefined,
					{
						source: "alertmanager-pull",
						note: {
							text: `no connected Alertmanager still lists ${name} (${fingerprint}); no resolved notification was received`,
							reason: "alertmanager-absence",
						},
					},
				);
				if (alert) resolved++;
			} catch (err) {
				this.logger.warn(
					`Failed to resolve absent alert ${fingerprint}: ${err}`,
				);
			}
		}
		return resolved;
	}
}

/** Tests and the seeded e2e stack never reach the network (#605). */
function offline(): boolean {
	return !!process.env.CI || process.env.PRISMALENS_SEED_DEMO === "1";
}

function alertName(labels: string | null): string | null {
	if (!labels) return null;
	try {
		const parsed = JSON.parse(labels) as Record<string, unknown>;
		return typeof parsed.alertname === "string" ? parsed.alertname : null;
	} catch {
		return null;
	}
}

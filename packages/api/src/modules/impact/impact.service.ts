// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * The Impact chart and the fix check (#811, research-data Q1/Q2): the firing alert's own
 * expression, re-run live on the connected Prometheus within one budget, judged in code.
 * Nothing fetched here is stored (ADR 0006 §1).
 */
import { Injectable, Logger } from "@nestjs/common";
import {
	type ExpressionState,
	type FixCheckReason,
	type FixVerdict,
	type ImpactChart,
	SERVICE_METRIC_CONFIG_KEY,
	type Threshold,
} from "@prismalens/contracts/schemas";
import {
	type AlertRule,
	type AuthenticatedRequestFn,
	createAdapter,
	type MetricsQueries,
	type QueryBudget,
	QueryBudgetExceededError,
	urlOnlyRequestFn,
} from "@prismalens/integrations";
import { PrismaService } from "../../core/prisma/prisma.service.js";
import { safeParseJsonObject } from "../../shared/utils/json-utils.js";
import { ChangeEventsService } from "../changes/change-events.service.js";
import { ConnectorResolverService } from "../integrations/connector-resolver.service.js";
import { IntegrationsService } from "../integrations/integrations.service.js";
import {
	breaches,
	expressionShape,
	graphExpr,
	httpLink,
	isAlertsSeriesExpr,
} from "./promql-shape.js";
import { exactRule, scopeSeries } from "./series-scope.js";

const HOUR_MS = 60 * 60_000;
export const CHART_WINDOW_MS = 24 * HOUR_MS;
/** One deadline for a whole chart or check: rules lookup, query and decode share it. */
export const DEADLINE_MS = 10_000;
/** 50 back means there may be more; a truncated answer could drop the alert's own series. */
export const SERIES_LIMIT = 50;
export const MAX_BYTES = 2 * 1024 * 1024;
export const PER_CONNECTION = 2;
const LOOKBACK_SECONDS = 300;
const WEEK_MS = 7 * 24 * HOUR_MS;

interface Target {
	connectionId: string;
	label: string;
	baseUrl: string;
	metrics: MetricsQueries;
	request: AuthenticatedRequestFn;
}

interface AlertRow {
	id: string;
	title: string;
	status: string;
	labels: string | null;
	sourceUrl: string | null;
	serviceId: string | null;
	dedupKey: string;
	triggeredAt: Date;
	resolvedAt: Date | null;
}

export interface Expression {
	state: ExpressionState;
	expr: string | null;
	reason: string | null;
	/** The rule on this connection whose query is the expression byte for byte. */
	rule: AlertRule | null;
	/** Prometheus did not answer the rules lookup, so `rule` says nothing. */
	lookupFailed: boolean;
}

export interface CheckOutcome {
	verdict: FixVerdict;
	value: number | null;
	threshold: Threshold | null;
	reason: FixCheckReason | null;
	message: string;
	retryable: boolean;
}

const COULD_NOT = "Could not check; the alert clears on its own.";
/** The research note's table: these may answer on Try again; a shape never will. */
const RETRYABLE = new Set<FixCheckReason>([
	"timeout",
	"error",
	"too-broad",
	"rule-not-matched",
]);

/** At most `limit` operations at once per key; a waiter gives up when its signal aborts. */
class Limiter {
	private readonly running = new Map<string, number>();
	private readonly waiting = new Map<string, Array<() => void>>();

	constructor(private readonly limit: number) {}

	async run<T>(key: string, signal: AbortSignal, fn: () => Promise<T>) {
		while ((this.running.get(key) ?? 0) >= this.limit) {
			signal.throwIfAborted();
			await new Promise<void>((resolve) => {
				const queue = this.waiting.get(key) ?? [];
				queue.push(resolve);
				this.waiting.set(key, queue);
				signal.addEventListener("abort", () => resolve(), { once: true });
			});
		}
		signal.throwIfAborted();
		this.running.set(key, (this.running.get(key) ?? 0) + 1);
		try {
			return await fn();
		} finally {
			this.running.set(key, (this.running.get(key) ?? 1) - 1);
			for (const wake of this.waiting.get(key)?.splice(0) ?? []) wake();
		}
	}
}

function labelsOf(raw: string | null): Record<string, string> {
	const obj = safeParseJsonObject(raw) ?? {};
	return Object.fromEntries(
		Object.entries(obj).filter(
			(e): e is [string, string] => typeof e[1] === "string",
		),
	);
}

function num(v: string): number | null {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[mid] as number)
		: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function failureOf(
	err: unknown,
	signal: AbortSignal,
): "timeout" | "too_broad" | "error" {
	if (err instanceof QueryBudgetExceededError) return "too_broad";
	if (signal.aborted) return "timeout";
	return "error";
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

@Injectable()
export class ImpactService {
	private readonly logger = new Logger(ImpactService.name);
	private readonly limiter = new Limiter(PER_CONNECTION);
	private readonly inFlight = new Map<string, Promise<unknown>>();
	/** Exposed so a test need not wait ten seconds. */
	deadlineMs = DEADLINE_MS;

	constructor(
		private readonly prisma: PrismaService,
		private readonly connectors: ConnectorResolverService,
		private readonly integrations: IntegrationsService,
		private readonly changes: ChangeEventsService,
	) {}

	/** Null when the incident does not exist; every failure is a state, never a throw. */
	async chart(incidentId: string): Promise<ImpactChart | null> {
		const incident = await this.incident(incidentId);
		if (!incident) return null;
		const alert = primaryAlert(incident.alerts);
		return this.shared(`chart:${alert?.id ?? incidentId}`, () =>
			this.drawChart(incident, alert),
		);
	}

	/** One observation of the firing alert's expression, judged in code (research-data Q1c). */
	async check(incidentId: string): Promise<CheckOutcome> {
		const incident = await this.incident(incidentId);
		const alerts = incident?.alerts ?? [];
		if (alerts.length > 0 && alerts.every((a) => a.status === "resolved"))
			return {
				verdict: "it_worked",
				value: null,
				threshold: null,
				reason: null,
				message: "It worked: the alert cleared.",
				retryable: false,
			};
		const alert = primaryAlert(alerts);
		if (!incident || !alert) return couldNot("expression-unknown");
		return this.shared(`check:${alert.id}`, () =>
			this.judge(alert, incident.serviceId),
		);
	}

	private shared<T>(key: string, fn: () => Promise<T>): Promise<T> {
		const pending = this.inFlight.get(key) as Promise<T> | undefined;
		if (pending) return pending;
		const op = fn().finally(() => this.inFlight.delete(key));
		this.inFlight.set(key, op);
		return op;
	}

	private incident(id: string) {
		return this.prisma.incident.findUnique({
			where: { id },
			select: {
				id: true,
				serviceId: true,
				alerts: {
					select: {
						id: true,
						title: true,
						status: true,
						labels: true,
						sourceUrl: true,
						serviceId: true,
						dedupKey: true,
						triggeredAt: true,
						resolvedAt: true,
					},
				},
			},
		});
	}

	private async judge(
		alert: AlertRow,
		incidentServiceId: string | null,
	): Promise<CheckOutcome> {
		const signal = AbortSignal.timeout(this.deadlineMs);
		const graph = graphExpr(alert.sourceUrl);
		const target = await this.target(
			alert.serviceId ?? incidentServiceId,
			graph?.base,
		);
		if (!target) return couldNot("no-connection");
		try {
			return await this.limiter.run(target.connectionId, signal, async () => {
				const expression = await this.expression(alert, target, signal);
				if (expression.lookupFailed) return couldNot("error");
				if (expression.state === "recovered_current_rule")
					return couldNot("current-rule");
				if (expression.state !== "recovered" || !expression.expr)
					return couldNot("expression-unknown");
				const shape = expressionShape(expression.expr);
				if (shape.uncheckable || !shape.threshold)
					return couldNot(shape.uncheckable ?? "unsupported-shape");
				if (!expression.rule) return couldNot("rule-not-matched");
				const samples = await target.metrics.instantQuery(
					target.request,
					{
						expr: shape.series,
						time: new Date(),
						lookbackDeltaSeconds: LOOKBACK_SECONDS,
					},
					this.budget(signal),
				);
				if (samples.length >= SERIES_LIMIT) return couldNot("too-broad");
				const scoped = scopeSeries(
					samples,
					labelsOf(alert.labels),
					expression.rule,
				);
				const only = scoped.state === "scoped" ? scoped.series[0] : undefined;
				if (!only) return couldNot("series-not-scoped");
				const value = num(only.value[1]);
				if (value === null) return couldNot("no-value");
				const firing = breaches(value, shape.threshold);
				return {
					verdict: firing ? "not_yet" : "below_threshold",
					value,
					threshold: shape.threshold,
					reason: null,
					message: firing ? "Not yet." : "Below the alert threshold.",
					retryable: false,
				};
			});
		} catch (err) {
			const kind = failureOf(err, signal);
			this.logger.warn(`Fix check on alert ${alert.id}: ${message(err)}`);
			return couldNot(
				kind === "too_broad"
					? "too-broad"
					: kind === "timeout"
						? "timeout"
						: "error",
			);
		}
	}

	private async drawChart(
		incident: NonNullable<Awaited<ReturnType<ImpactService["incident"]>>>,
		alert: AlertRow | null,
	): Promise<ImpactChart> {
		const end = new Date();
		const start = new Date(end.getTime() - CHART_WINDOW_MS);
		const stepSeconds = Math.max(60, Math.ceil(CHART_WINDOW_MS / 1000 / 300));
		const serviceId = alert?.serviceId ?? incident.serviceId;
		const serviceIds = [
			...new Set(
				[incident.serviceId, ...incident.alerts.map((a) => a.serviceId)].filter(
					(id): id is string => !!id,
				),
			),
		];
		const graph = graphExpr(alert?.sourceUrl);
		const chart: ImpactChart = {
			incidentId: incident.id,
			alertId: alert?.id ?? null,
			state: "not_configured",
			expression: { state: "not_configured", reason: null },
			metric: null,
			scope: { state: "unscoped", matched: 0 },
			series: [],
			window: { start: start.toISOString(), end: end.toISOString() },
			stepSeconds,
			now: null,
			usual: null,
			deploys: await this.changes.deploysIn(serviceIds, { start, end }),
			history: await this.history(incident.alerts.length, alert),
			linkOut: httpLink(alert?.sourceUrl),
			connection: null,
			error: null,
			capturedAt: end.toISOString(),
		};
		const target = await this.target(serviceId, graph?.base);
		if (!target || !alert) return chart;
		chart.connection = { id: target.connectionId, label: target.label };
		const signal = AbortSignal.timeout(this.deadlineMs);
		try {
			await this.limiter.run(target.connectionId, signal, async () => {
				const expression = await this.expression(alert, target, signal);
				chart.expression = {
					state: expression.state,
					reason: expression.reason,
				};
				let query = expression.expr;
				let source: "alert" | "alert_current_rule" | "service" =
					expression.state === "recovered_current_rule"
						? "alert_current_rule"
						: "alert";
				if (!query && serviceId) {
					query = await this.serviceMetric(serviceId, target.connectionId);
					source = "service";
				}
				if (!query) {
					chart.state = "expression_unknown";
					return;
				}
				const shape =
					source === "service"
						? { series: query, threshold: null }
						: expressionShape(query);
				chart.metric = {
					source,
					query: shape.series,
					threshold: shape.threshold,
				};
				const series = await target.metrics.rangeQuery(
					target.request,
					{ expr: shape.series, start, end, stepSeconds },
					this.budget(signal),
				);
				if (series.length >= SERIES_LIMIT) {
					chart.state = "too_broad";
					return;
				}
				const scoped =
					source === "alert"
						? scopeSeries(series, labelsOf(alert.labels), expression.rule)
						: scopeSeries(series, {}, null);
				chart.scope = { state: scoped.state, matched: scoped.matched };
				chart.series = scoped.series.map((s) => ({
					labels: s.labels,
					points: s.values.map(
						([t, v]) => [t, num(v)] as [number, number | null],
					),
				}));
				chart.state = "ok";
				const only = scoped.state === "scoped" ? chart.series[0] : undefined;
				if (only) {
					const values = only.points.filter(
						(p): p is [number, number] => p[1] !== null,
					);
					chart.now = values.at(-1)?.[1] ?? null;
					chart.usual = median(
						values
							.filter(([t]) => t * 1000 < alert.triggeredAt.getTime())
							.map(([, v]) => v),
					);
				}
			});
		} catch (err) {
			chart.state = failureOf(err, signal);
			chart.series = [];
			chart.error = message(err);
			this.logger.warn(`Impact chart for ${incident.id}: ${chart.error}`);
		}
		return chart;
	}

	/**
	 * Where the alert's expression comes from (research-data "Expression states"). Our catch-up writes
	 * `ALERTS{alertname="X"}`, the firing series and never the metric: then only exactly one rule
	 * named X that is loaded now, whose labels the alert carries, stands in, for the chart only.
	 */
	async expression(
		alert: AlertRow,
		target: Target,
		signal: AbortSignal,
	): Promise<Expression> {
		const graph = graphExpr(alert.sourceUrl);
		const unknown = (reason: string): Expression => ({
			state: "expression_unknown",
			expr: null,
			reason,
			rule: null,
			lookupFailed: false,
		});
		if (!graph) return unknown("The alert's sender gave no expression.");
		const lookup = () =>
			target.metrics.alertRules(
				target.request,
				alert.title,
				this.budget(signal),
			);
		if (isAlertsSeriesExpr(graph.expr, alert.title)) {
			if (!sameBase(graph.base, target.baseUrl))
				return unknown(
					"The alert came from a Prometheus that is not connected.",
				);
			let rules: AlertRule[];
			try {
				rules = await lookup();
			} catch (err) {
				if (signal.aborted) throw err;
				return {
					...unknown("Prometheus did not list its rules."),
					lookupFailed: true,
				};
			}
			const labels = labelsOf(alert.labels);
			const fits = rules.filter((r) =>
				Object.entries(r.labels).every(([k, v]) => labels[k] === v),
			);
			if (fits.length === 1 && fits[0])
				return {
					state: "recovered_current_rule",
					expr: fits[0].query,
					reason:
						"The rule as loaded now; it may have changed since this alert fired.",
					rule: null,
					lookupFailed: false,
				};
			return unknown(
				fits.length === 0
					? "The rule is no longer loaded."
					: `${fits.length} rules share this name.`,
			);
		}
		try {
			const rule = exactRule(await lookup(), graph.expr);
			return {
				state: "recovered",
				expr: graph.expr,
				reason: null,
				rule,
				lookupFailed: false,
			};
		} catch (err) {
			if (signal.aborted) throw err;
			return {
				state: "recovered",
				expr: graph.expr,
				reason: null,
				rule: null,
				lookupFailed: true,
			};
		}
	}

	/** The service's Prometheus, else any active one; a catch-up link names its own. */
	private async target(
		serviceId: string | null | undefined,
		base: string | undefined,
	): Promise<Target | null> {
		const resolved = (
			await this.connectors.resolve({ serviceId: serviceId ?? undefined })
		).filter((c) => c.templateId === "prometheus");
		let chosen:
			| { connectionId: string; label: string; baseUrl: string }
			| undefined = resolved[0];
		if (base) {
			const all = await this.prisma.connection.findMany({
				where: { status: "ACTIVE", integration: { templateId: "prometheus" } },
				include: { integration: true },
			});
			for (const conn of all) {
				const baseUrl = this.integrations.baseUrlOf(conn);
				if (baseUrl && sameBase(base, baseUrl)) {
					chosen = {
						connectionId: conn.id,
						label: conn.label || conn.integration.label || "prometheus",
						baseUrl,
					};
					break;
				}
			}
		}
		const metrics = createAdapter("prometheus")?.metrics;
		if (!chosen || !metrics) return null;
		return {
			connectionId: chosen.connectionId,
			label: chosen.label,
			baseUrl: chosen.baseUrl,
			metrics,
			request: urlOnlyRequestFn(chosen.baseUrl),
		};
	}

	/** The PromQL a service names as its own metric on this connection (Q2b); never used to judge a fix. */
	private async serviceMetric(
		serviceId: string,
		connectionId: string,
	): Promise<string | null> {
		const row = await this.prisma.serviceIntegration.findFirst({
			where: { serviceId, connectionId, isEnabled: true },
			select: { config: true },
		});
		const value = safeParseJsonObject(row?.config)?.[SERVICE_METRIC_CONFIG_KEY];
		return typeof value === "string" && value.trim() ? value.trim() : null;
	}

	private async history(alertCount: number, alert: AlertRow | null) {
		if (!alert)
			return {
				firingSince: null,
				resolvedAt: null,
				alertCount,
				refiresThisWeek: 0,
				strip: [],
			};
		const episodes = await this.prisma.alert.findMany({
			where: {
				dedupKey: alert.dedupKey,
				triggeredAt: { gte: new Date(Date.now() - WEEK_MS) },
			},
			select: { triggeredAt: true, resolvedAt: true },
			orderBy: { triggeredAt: "asc" },
		});
		return {
			firingSince: alert.triggeredAt.toISOString(),
			resolvedAt: alert.resolvedAt?.toISOString() ?? null,
			alertCount,
			refiresThisWeek: Math.max(0, episodes.length - 1),
			strip: episodes.map((e) => ({
				start: e.triggeredAt.toISOString(),
				end: e.resolvedAt?.toISOString() ?? null,
			})),
		};
	}

	private budget(signal: AbortSignal): QueryBudget {
		return { signal, limit: SERIES_LIMIT, maxBytes: MAX_BYTES, timeout: "8s" };
	}
}

/** The newest firing alert, else the newest. */
export function primaryAlert<T extends { status: string; triggeredAt: Date }>(
	alerts: T[],
): T | null {
	const newest = [...alerts].sort(
		(a, b) => b.triggeredAt.getTime() - a.triggeredAt.getTime(),
	);
	return newest.find((a) => a.status !== "resolved") ?? newest[0] ?? null;
}

function sameBase(a: string, b: string): boolean {
	return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

function couldNot(reason: FixCheckReason): CheckOutcome {
	return {
		verdict: "could_not_check",
		value: null,
		threshold: null,
		reason,
		message: COULD_NOT,
		retryable: RETRYABLE.has(reason),
	};
}

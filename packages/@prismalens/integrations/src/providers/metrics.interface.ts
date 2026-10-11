// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthenticatedRequestFn } from "./types.js";

export interface RangeSeries {
	labels: Record<string, string>;
	/** [unixSeconds, value] */
	values: Array<[number, string]>;
}

export interface InstantSample {
	labels: Record<string, string>;
	/** [unixSeconds, value] */
	value: [number, string];
}

/** An alerting rule as the metrics source has it loaded now. */
export interface AlertRule {
	name: string;
	query: string;
	labels: Record<string, string>;
}

/**
 * Bounds for a query whose expression came from outside (#811): the server is asked for at most
 * `limit` series within `timeout`, and the client aborts on `signal` or past `maxBytes` of body.
 */
export interface QueryBudget {
	signal?: AbortSignal;
	limit?: number;
	maxBytes?: number;
	/** A duration the server accepts, e.g. "8s". */
	timeout?: string;
}

/** The response was larger than the budget allowed; the caller treats it as too broad, never truncated. */
export class QueryBudgetExceededError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "QueryBudgetExceededError";
	}
}

export interface MetricsQueries {
	readonly name: string;
	testConnection(request: AuthenticatedRequestFn): Promise<boolean>;
	rangeQuery(
		request: AuthenticatedRequestFn,
		q: { expr: string; start: Date; end: Date; stepSeconds: number },
		budget?: QueryBudget,
	): Promise<RangeSeries[]>;
	instantQuery(
		request: AuthenticatedRequestFn,
		q: { expr: string; time: Date; lookbackDeltaSeconds?: number },
		budget?: QueryBudget,
	): Promise<InstantSample[]>;
	alertRules(
		request: AuthenticatedRequestFn,
		name: string,
		budget?: QueryBudget,
	): Promise<AlertRule[]>;
}

// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { AuthenticatedRequestFn } from "./types.js";

export interface RangeSeries {
	labels: Record<string, string>;
	/** [unixSeconds, value] */
	values: Array<[number, string]>;
}

export interface MetricsQueries {
	readonly name: string;
	testConnection(request: AuthenticatedRequestFn): Promise<boolean>;
	rangeQuery(
		request: AuthenticatedRequestFn,
		q: { expr: string; start: Date; end: Date; stepSeconds: number },
	): Promise<RangeSeries[]>;
}

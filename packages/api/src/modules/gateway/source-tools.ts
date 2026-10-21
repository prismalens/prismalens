// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	SourceToolContext,
	SourceToolResult,
} from "@prismalens/integrations";
import { z } from "zod";
import type { OpenedSource } from "../integrations/open-source.js";
import {
	OffOriginError,
	SourceConfigError,
	scrubSecrets,
	TRUNCATED_HEADER,
} from "../integrations/source-request.js";

export type QueryKind = "prometheus" | "alertmanager" | "loki";
export const QUERY_KINDS: readonly QueryKind[] = [
	"prometheus",
	"alertmanager",
	"loki",
];

/** A connected source the gateway can query. */
export type QuerySource = OpenedSource & { kind: QueryKind };

export const LIMITS = {
	/** Bytes read from an upstream response. */
	responseBytes: 4 * 1024 * 1024,
	/** Characters of JSON one tool result returns. */
	resultChars: 32_000,
	series: 50,
	pointsPerSeries: 200,
	alerts: 100,
	logLines: 500,
	logLineChars: 2_000,
};

export type McpToolResult = {
	content: { type: "text"; text: string }[];
	isError?: boolean;
};

/** A tool's value as MCP text: exact-value scrubbed, then capped. */
export function mcpText(
	value: unknown,
	secrets: readonly string[],
	isError = false,
): McpToolResult {
	let text = scrubSecrets(JSON.stringify(value, null, 1), [...secrets]);
	if (text.length > LIMITS.resultChars)
		text = `${text.slice(0, LIMITS.resultChars)}\n…[truncated at ${LIMITS.resultChars} characters; narrow the query]`;
	return {
		content: [{ type: "text", text }],
		...(isError ? { isError: true } : {}),
	};
}

/** Why a request failed, without upstream text that may echo a credential. */
export function failureReason(e: unknown): string {
	if (e instanceof OffOriginError)
		return "the request would leave the source's origin; PrismaLens does not send your credential there";
	if (e instanceof Error && e.name === "TimeoutError")
		return "the source did not answer in time";
	if (e instanceof SourceConfigError) return e.message;
	return "could not connect to the source";
}

export function cap<T>(
	items: T[],
	max: number,
): { items: T[]; dropped: number } {
	return {
		items: items.slice(0, max),
		dropped: Math.max(0, items.length - max),
	};
}

export const sourceArg = z
	.string()
	.trim()
	.max(200)
	.optional()
	.describe(
		"Source id or label from sources_list; defaults to the first connected one.",
	);
export const timeArg = z
	.string()
	.trim()
	.max(40)
	.regex(/^[0-9TZ:.+-]+$/, "RFC 3339 or unix seconds");

/** Unix seconds for a `timeArg` (digits, or RFC 3339); NaN when it is neither. */
export const toUnixSeconds = (t: string): number =>
	/^\d+(\.\d+)?$/.test(t) ? Number(t) : Date.parse(t) / 1000;

/** The run id lets the gateway note which connections a run met (OBJ-010). */
export type QuerySources = (
	kind: QueryKind,
	runId: string,
) => Promise<QuerySource[]>;

/** One GET against the chosen source of `kind`; the shape step trims what comes back. */
export async function querySource(
	sources: QuerySources,
	ctx: SourceToolContext,
	kind: QueryKind,
	pick: string | undefined,
	path: string,
	params: Record<string, string>,
	shape: (data: unknown) => unknown,
): Promise<SourceToolResult> {
	const all = await sources(kind, ctx.runId);
	if (!all.length)
		return {
			value: {
				status: "not-configured",
				howToConnect: `No ${kind} source is connected. Connect one in PrismaLens under Settings, Data sources.`,
			},
		};
	const src = pick
		? all.find((s) => s.id === pick || s.label === pick)
		: (all.find((s) => !s.unusable) ?? all[0]);
	if (!src)
		return {
			isError: true,
			value: {
				error: `No ${kind} source named "${pick}"`,
				sources: all.map((s) => ({ id: s.id, label: s.label })),
			},
		};
	if (!src.request || src.unusable)
		return {
			isError: true,
			value: { source: src.label, status: "unreachable", reason: src.unusable },
		};
	const secrets = src.secrets;
	const qs = new URLSearchParams(params).toString();
	try {
		const res = await src.request("GET", qs ? `${path}?${qs}` : path, {
			headers: { Accept: "application/json" },
			signal: ctx.signal,
		});
		if (res.headers.get(TRUNCATED_HEADER))
			return {
				isError: true,
				secrets,
				value: {
					source: src.label,
					error: `the response is larger than ${LIMITS.responseBytes} bytes; narrow the query or shorten the range`,
				},
			};
		if (!res.ok) {
			// The body may echo the credential in any encoding, so it is never read (#848, OBJ-001).
			await res.body?.cancel();
			return {
				isError: true,
				secrets,
				value: {
					source: src.label,
					httpStatus: res.status,
					error: `the source answered HTTP ${res.status}`,
				},
			};
		}
		const text = await res.text();
		return {
			secrets,
			value: { source: src.label, ...(shape(JSON.parse(text)) as object) },
		};
	} catch (e) {
		return {
			isError: true,
			secrets,
			value: { source: src.label, error: failureReason(e) },
		};
	}
}

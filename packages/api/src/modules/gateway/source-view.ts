// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import {
	SOURCE_CATEGORIES,
	type SourceCategory,
	type SourceCategoryView,
	type SourceStatus,
	templateCategory,
	UNSUPPORTED_KNOWLEDGE_VENDORS,
	UNSUPPORTED_SCM_VENDORS,
} from "@prismalens/contracts/schemas";
import type {
	ProxyPort,
	ProxySnapshot,
	SourceRegistry,
} from "@prismalens/integrations";
import { QUERY_KINDS, type QueryKind } from "./source-tools.js";

export type SourceItem = SourceCategoryView["sources"][number];

/** A connection a run has met, kept so its removal mid-run reads `removed` (OBJ-010). */
export interface SeenConnection {
	label: string;
	category: SourceCategory;
}

export interface RunView {
	runId: string;
	seen: Map<string, SeenConnection>;
	snapshot: ProxySnapshot;
}

export interface ConnectionRow {
	id: string;
	label: string;
	status: string;
	lastErrorAt: Date | null;
	integration: { templateId: string; label: string };
}

export interface SourceViewDeps {
	rows(): Promise<ConnectionRow[]>;
	registry: SourceRegistry;
	proxy: ProxyPort;
	/** Connected when the source's read-only verify path answers 2xx. */
	probe?(src: {
		id: string;
		label: string;
		kind: QueryKind;
	}): Promise<{ ok: true } | { ok: false; reason: string }>;
	runbookSource(runId?: string): Promise<SourceItem>;
}

const PING_TIMEOUT_MS = 2_000;

export const labelOf = (r: ConnectionRow) => r.label || r.integration.label;

/** Records every row the run meets; the map only grows until the run ends. */
export function remember(
	seen: Map<string, SeenConnection> | undefined,
	rows: readonly ConnectionRow[],
): void {
	if (!seen) return;
	for (const r of rows) {
		const category = templateCategory(r.integration.templateId);
		if (category) seen.set(r.id, { label: labelOf(r), category });
	}
}

export function howToConnect(category: SourceCategory): string {
	return category === "deploys"
		? "Send deploy events to POST /api/webhooks/deploy; see PrismaLens under Settings, Data sources."
		: "Connect one in PrismaLens under Settings, Data sources.";
}

const queryable = (t: string): t is QueryKind =>
	(QUERY_KINDS as readonly string[]).includes(t);

const unsupported = (vendor: string): SourceItem => ({
	id: vendor.toLowerCase().replace(/ /g, "-"),
	label: vendor,
	kind: "unsupported",
	status: "not-configured",
	reason: `${vendor} is not supported yet.`,
});

/** Every category with its status; the Sources page and `sources_list` read the same answer. */
export async function sourceView(
	deps: SourceViewDeps,
	run?: RunView,
	opts: { probe?: boolean } = {},
): Promise<SourceCategoryView[]> {
	const probing = opts.probe !== false;
	const rows = await deps.rows();
	remember(run?.seen, rows);
	const byId = new Map(rows.map((r) => [r.id, r]));
	const probes = new Map(
		probing && deps.probe
			? await Promise.all(
					rows
						.filter((r) => queryable(r.integration.templateId))
						.map(
							async (r) =>
								[
									r.id,
									await deps.probe?.({
										id: r.id,
										label: labelOf(r),
										kind: r.integration.templateId as QueryKind,
									}),
								] as const,
						),
				)
			: [],
	);
	const mcp = await mcpSources(deps, rows, run, probing);
	const runbooks = await deps.runbookSource(run?.runId);
	const removed = (category: SourceCategory): SourceItem[] =>
		[...(run?.seen ?? [])]
			.filter(([id, s]) => s.category === category && !byId.has(id))
			.map(([id, s]) => ({
				id,
				label: s.label,
				kind: "removed",
				status: "removed",
				reason: "This connection was removed during the run.",
			}));

	return SOURCE_CATEGORIES.map((category): SourceCategoryView => {
		const tools = deps.registry.byCategory(category);
		if (category === "knowledge")
			return {
				category,
				status: "connected",
				sources: [
					{
						id: "prismalens-investigations",
						label: "Past PrismaLens investigations",
						kind: "builtin",
						status: "connected",
					},
					runbooks,
					...UNSUPPORTED_KNOWLEDGE_VENDORS.map(unsupported),
				],
				tools,
			};
		const live =
			category === "mcp"
				? mcp
				: rows
						.filter(
							(r) => templateCategory(r.integration.templateId) === category,
						)
						.map((r): SourceItem => {
							const probed = probes.get(r.id);
							const status: SourceStatus = probed
								? probed.ok
									? "connected"
									: "unreachable"
								: r.status === "ACTIVE"
									? "connected"
									: "unreachable";
							return {
								id: r.id,
								label: labelOf(r),
								kind: r.integration.templateId,
								status,
								...(probed && !probed.ok ? { reason: probed.reason } : {}),
								...(!probed && status === "unreachable" && r.lastErrorAt
									? { lastErrorAt: r.lastErrorAt.toISOString() }
									: {}),
							};
						});
		const status: SourceStatus = live.some((s) => s.status === "connected")
			? "connected"
			: live.some((s) => s.status === "unreachable")
				? "unreachable"
				: "not-configured";
		return {
			category,
			status,
			sources: [
				...live,
				...removed(category),
				...(category === "scm" ? UNSUPPORTED_SCM_VENDORS.map(unsupported) : []),
			],
			tools,
			...(status === "not-configured"
				? { howToConnect: howToConnect(category) }
				: {}),
		};
	});
}

/** Vendor MCP connections: the run's snapshot with live status, else the saved rows. */
async function mcpSources(
	deps: SourceViewDeps,
	rows: readonly ConnectionRow[],
	run: RunView | undefined,
	probing: boolean,
): Promise<SourceItem[]> {
	const mcpRows = rows.filter(
		(r) => templateCategory(r.integration.templateId) === "mcp",
	);
	if (!run)
		return mcpRows.map((r) => ({
			id: r.id,
			label: labelOf(r),
			kind: r.integration.templateId,
			name: labelOf(r),
			status: r.status === "ACTIVE" ? "connected" : "unreachable",
		}));
	const ids = new Set(mcpRows.map((r) => r.id));
	const inRun = run.snapshot.connections.filter((c) => ids.has(c.id));
	const offered = await Promise.all(
		inRun.map(async (c): Promise<SourceItem> => {
			const live = probing
				? await deps.proxy
						.ping(run.runId, c.id, PING_TIMEOUT_MS)
						.catch(() => ({ ok: false, reason: "the server did not answer" }))
				: { ok: c.status === "connected", reason: c.reason };
			const left = (c.dropped ?? []).reduce((n, d) => n + d.count, 0);
			const reason = live.ok
				? left
					? `offered ${c.tools.length} of ${c.tools.length + left} tools (limit reached)`
					: undefined
				: (live.reason ?? "the server did not answer");
			return {
				id: c.id,
				label: labelOf(rows.find((r) => r.id === c.id) as ConnectionRow),
				kind: "mcp-server",
				name: c.name,
				description: c.description,
				toolCount: c.tools.length,
				status: live.ok ? "connected" : "unreachable",
				...(reason ? { reason } : {}),
				...(c.dropped?.length ? { dropped: c.dropped } : {}),
			};
		}),
	);
	const later = mcpRows
		.filter((r) => !run.snapshot.connections.some((c) => c.id === r.id))
		.map(
			(r): SourceItem => ({
				id: r.id,
				label: labelOf(r),
				kind: r.integration.templateId,
				name: labelOf(r),
				status: "not-configured",
				reason: "available from the next run",
			}),
		);
	return [...offered, ...later];
}
